import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { createServerClient } from '@/lib/supabase';

// Partner API authentication + rate limiting.
//
// Auth model: partner sends `Authorization: Bearer pl_(live|test)_<32chars>`.
// We hash the presented key (SHA-256) and look it up in partners.api_key_hash.
// We never store the raw key after issuance, so a DB leak doesn't leak keys.
//
// Rate limiting: DB-backed via partner_request_log so it survives Vercel's
// horizontally-scaled function instances. We count rows in the last 60s
// for this partner and reject if over the partner's configured limit.

export interface AuthenticatedPartner {
  id: string;
  slug: string;
  display_name: string;
  environment: 'live' | 'test';
  rev_share_bps: number;
  partner_wallet: string | null;
  default_webhook_url: string | null;
  rate_limit_per_minute: number;
  webhook_secret: string;
}

export interface AuthResult {
  ok: true;
  partner: AuthenticatedPartner;
  startedAt: number;
}

export interface AuthError {
  ok: false;
  response: NextResponse;
}

const KEY_PATTERN = /^pl_(live|test)_[A-Za-z0-9]{32}$/;

export function hashApiKey(rawKey: string): string {
  // Plain SHA-256. The key has 32 chars of entropy (~190 bits) so no salt
  // needed for collision/brute-force resistance; lookup is constant-time
  // via the unique index on api_key_hash.
  return createHash('sha256').update(rawKey).digest('hex');
}

/**
 * Authenticate a partner API request. Returns either a partner object on
 * success, or a ready-to-return NextResponse on failure (401/403/429/500).
 *
 * Always call this at the top of every /api/v1/partners/* route. It also
 * writes a row to partner_request_log on every call (success or failure)
 * for audit/rate-limit accounting.
 */
export async function authenticatePartnerRequest(
  req: NextRequest,
): Promise<AuthResult | AuthError> {
  const startedAt = Date.now();
  const path = new URL(req.url).pathname;
  const method = req.method;
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip')
    || 'unknown';
  const userAgent = req.headers.get('user-agent') || null;
  const requestId = req.headers.get('x-request-id') || null;

  const auth = req.headers.get('authorization');
  if (!auth || !auth.startsWith('Bearer ')) {
    return logAndReturn({
      partner_id: null, method, path, status_code: 401, ip, user_agent: userAgent, request_id: requestId,
      duration_ms: Date.now() - startedAt,
    }, jsonError(401, 'missing_authorization', 'Authorization: Bearer pl_(live|test)_xxxxx required.'));
  }
  const rawKey = auth.slice(7).trim();
  if (!KEY_PATTERN.test(rawKey)) {
    return logAndReturn({
      partner_id: null, method, path, status_code: 401, ip, user_agent: userAgent, request_id: requestId,
      duration_ms: Date.now() - startedAt,
    }, jsonError(401, 'malformed_key', 'API key must match pl_(live|test)_<32 chars>.'));
  }

  const hash = hashApiKey(rawKey);
  const supabase = createServerClient();

  const { data: partner, error: lookupErr } = await supabase
    .from('partners')
    .select('id, slug, display_name, environment, rev_share_bps, partner_wallet, default_webhook_url, rate_limit_per_minute, webhook_secret, enabled')
    .eq('api_key_hash', hash)
    .maybeSingle();

  if (lookupErr) {
    console.error('[partnerAuth] lookup error:', lookupErr);
    return logAndReturn({
      partner_id: null, method, path, status_code: 500, ip, user_agent: userAgent, request_id: requestId,
      duration_ms: Date.now() - startedAt,
    }, jsonError(500, 'internal_error', 'Authentication lookup failed.'));
  }
  if (!partner) {
    return logAndReturn({
      partner_id: null, method, path, status_code: 401, ip, user_agent: userAgent, request_id: requestId,
      duration_ms: Date.now() - startedAt,
    }, jsonError(401, 'invalid_key', 'API key not recognized.'));
  }
  if (!partner.enabled) {
    return logAndReturn({
      partner_id: partner.id, method, path, status_code: 403, ip, user_agent: userAgent, request_id: requestId,
      duration_ms: Date.now() - startedAt,
    }, jsonError(403, 'partner_disabled', 'Partner account is disabled. Contact support.'));
  }

  // Rate limit — count requests from this partner in the last 60s
  const windowStart = new Date(Date.now() - 60_000).toISOString();
  const { count: recentCount, error: countErr } = await supabase
    .from('partner_request_log')
    .select('id', { count: 'exact', head: true })
    .eq('partner_id', partner.id)
    .gte('created_at', windowStart);
  if (countErr) {
    console.warn('[partnerAuth] rate-limit count failed (allowing request):', countErr);
  } else if ((recentCount || 0) >= partner.rate_limit_per_minute) {
    return logAndReturn({
      partner_id: partner.id, method, path, status_code: 429, ip, user_agent: userAgent, request_id: requestId,
      duration_ms: Date.now() - startedAt,
    }, jsonError(
      429,
      'rate_limit_exceeded',
      `Rate limit ${partner.rate_limit_per_minute}/min exceeded. Retry after 60s.`,
      { 'Retry-After': '60' },
    ));
  }

  // Async update of last_seen_at — non-blocking
  supabase
    .from('partners')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', partner.id)
    .then(({ error }) => {
      if (error) console.warn('[partnerAuth] last_seen_at update failed:', error.message);
    });

  return {
    ok: true,
    partner: {
      id: partner.id,
      slug: partner.slug,
      display_name: partner.display_name,
      environment: partner.environment as 'live' | 'test',
      rev_share_bps: partner.rev_share_bps,
      partner_wallet: partner.partner_wallet,
      default_webhook_url: partner.default_webhook_url,
      rate_limit_per_minute: partner.rate_limit_per_minute,
      webhook_secret: partner.webhook_secret,
    },
    startedAt,
  };
}

/**
 * Log a final outcome for an authenticated request. Call this after sending
 * the response in the route handler to record the status_code and duration.
 * For auth failures, authenticatePartnerRequest already logs internally.
 */
export async function logPartnerRequestOutcome(args: {
  partner_id: string;
  method: string;
  path: string;
  status_code: number;
  ip?: string | null;
  user_agent?: string | null;
  request_id?: string | null;
  duration_ms: number;
}) {
  try {
    const supabase = createServerClient();
    await supabase.from('partner_request_log').insert({
      partner_id: args.partner_id,
      method: args.method,
      path: args.path,
      status_code: args.status_code,
      ip: args.ip ?? null,
      user_agent: args.user_agent ?? null,
      request_id: args.request_id ?? null,
      duration_ms: args.duration_ms,
    });
  } catch (e) {
    console.warn('[partnerAuth] request log write failed:', e instanceof Error ? e.message : e);
  }
}

// ── internals ──────────────────────────────────────────────────────

function jsonError(
  status: number,
  code: string,
  message: string,
  extraHeaders?: Record<string, string>,
): NextResponse {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'Content-Type': 'application/json', ...(extraHeaders || {}) } },
  );
}

async function logAndReturn(
  logRow: {
    partner_id: string | null;
    method: string;
    path: string;
    status_code: number;
    ip: string | null;
    user_agent: string | null;
    request_id: string | null;
    duration_ms: number;
  },
  response: NextResponse,
): Promise<AuthError> {
  try {
    const supabase = createServerClient();
    await supabase.from('partner_request_log').insert(logRow);
  } catch (e) {
    console.warn('[partnerAuth] log write failed:', e instanceof Error ? e.message : e);
  }
  return { ok: false, response };
}
