import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { authenticatePartnerRequest, logPartnerRequestOutcome } from '@/lib/partnerAuth';
import { createServerClient } from '@/lib/supabase';

// POST /api/v1/partners/sessions
// ──────────────────────────────────────────────────────────────────────
// Create a hosted-checkout session. Returns a checkout_url the partner
// redirects their user to. The user completes the submission on
// prooflaunch.fun (pays creation fee, signs with their wallet). On
// success we mark the session 'submitted' and webhook the partner.
//
// Auth: Authorization: Bearer pl_(live|test)_xxx
// Idempotency: not enforced in v1; partner_reference can be used to
//   correlate. Idempotency-Key support lands with Tier 2.

interface CreateSessionBody {
  name?: string;
  symbol?: string;
  description?: string;
  image_url?: string;
  creator_wallet?: string;
  total_slots?: number;
  min_backing_sol?: number;
  metadata?: Record<string, unknown>;
  return_url?: string;
  webhook_url?: string;
  partner_reference?: string;
}

const SESSION_TTL_HOURS = 24;
const SOLANA_PUBKEY_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const HTTPS_URL_PATTERN = /^https:\/\/[^\s]+$/i;
const MAX_TOTAL_SLOTS = 24;
const MIN_TOTAL_SLOTS = 2;

export async function POST(req: NextRequest) {
  const auth = await authenticatePartnerRequest(req);
  if (!auth.ok) return auth.response;
  const { partner, startedAt } = auth;
  const path = '/api/v1/partners/sessions';

  const respond = (status: number, body: unknown) => {
    const res = NextResponse.json(body, { status });
    logPartnerRequestOutcome({
      partner_id: partner.id,
      method: 'POST',
      path,
      status_code: status,
      ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
      user_agent: req.headers.get('user-agent'),
      request_id: req.headers.get('x-request-id'),
      duration_ms: Date.now() - startedAt,
    });
    return res;
  };

  // ── Parse + validate body ───────────────────────────────────────
  let body: CreateSessionBody;
  try {
    body = await req.json();
  } catch {
    return respond(400, { error: { code: 'invalid_json', message: 'Request body must be valid JSON.' } });
  }

  const errors: string[] = [];

  // Required: name
  const name = (body.name ?? '').trim();
  if (!name) errors.push('name is required');
  else if (name.length < 2 || name.length > 32) errors.push('name must be 2-32 characters');

  // Required: symbol
  const symbol = (body.symbol ?? '').trim().toUpperCase();
  if (!symbol) errors.push('symbol is required');
  else if (symbol.length < 2 || symbol.length > 10) errors.push('symbol must be 2-10 characters');
  else if (!/^[A-Z0-9]+$/.test(symbol)) errors.push('symbol must be alphanumeric uppercase');

  // Required: description
  const description = (body.description ?? '').trim();
  if (!description) errors.push('description is required');
  else if (description.length > 500) errors.push('description must be 500 characters or less');

  // Required: creator_wallet (must be a valid Solana pubkey)
  const creator_wallet = (body.creator_wallet ?? '').trim();
  if (!creator_wallet) errors.push('creator_wallet is required');
  else if (!SOLANA_PUBKEY_PATTERN.test(creator_wallet)) errors.push('creator_wallet must be a base58-encoded Solana pubkey');

  // Required: total_slots
  const total_slots = Number(body.total_slots);
  if (!Number.isInteger(total_slots) || total_slots < MIN_TOTAL_SLOTS || total_slots > MAX_TOTAL_SLOTS) {
    errors.push(`total_slots must be an integer between ${MIN_TOTAL_SLOTS} and ${MAX_TOTAL_SLOTS}`);
  }

  // Required: min_backing_sol
  const min_backing_sol = Number(body.min_backing_sol);
  if (!Number.isFinite(min_backing_sol) || min_backing_sol < 0.01 || min_backing_sol > 100) {
    errors.push('min_backing_sol must be a number between 0.01 and 100');
  }

  // Optional: image_url, return_url, webhook_url (must be HTTPS if present)
  const image_url = body.image_url?.trim() || null;
  if (image_url && !HTTPS_URL_PATTERN.test(image_url)) errors.push('image_url must be an https URL');

  const return_url = body.return_url?.trim() || null;
  if (return_url && !HTTPS_URL_PATTERN.test(return_url)) errors.push('return_url must be an https URL');

  const webhook_url = body.webhook_url?.trim() || partner.default_webhook_url;
  if (webhook_url && !HTTPS_URL_PATTERN.test(webhook_url)) errors.push('webhook_url must be an https URL');

  // Optional: partner_reference (any string up to 256 chars)
  const partner_reference = body.partner_reference?.trim() || null;
  if (partner_reference && partner_reference.length > 256) errors.push('partner_reference must be 256 characters or less');

  // Optional: metadata (must be a plain object)
  const metadata = (body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata))
    ? body.metadata
    : {};

  if (errors.length > 0) {
    return respond(400, { error: { code: 'validation_failed', message: errors.join('; ') } });
  }

  // ── Generate session id + persist ──────────────────────────────
  const sessionId = `pls_${randomBytes(8).toString('hex')}`;     // 16-char hex suffix
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000).toISOString();

  const supabase = createServerClient();
  const { error: insertErr } = await supabase
    .from('partner_sessions')
    .insert({
      id: sessionId,
      partner_id: partner.id,
      name,
      symbol,
      description,
      image_url,
      creator_wallet,
      total_slots,
      min_backing_sol,
      metadata,
      return_url,
      webhook_url,
      partner_reference,
      status: 'pending',
      expires_at: expiresAt,
    });

  if (insertErr) {
    console.error('[partners/sessions] insert failed:', insertErr);
    return respond(500, { error: { code: 'internal_error', message: 'Failed to create session.' } });
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://prooflaunch.fun';
  const checkoutUrl = `${baseUrl}/submit?session=${sessionId}`;

  return respond(201, {
    session_id: sessionId,
    checkout_url: checkoutUrl,
    expires_at: expiresAt,
    partner_reference,
  });
}
