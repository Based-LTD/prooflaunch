import { NextRequest, NextResponse } from 'next/server';
import { Connection } from '@solana/web3.js';
import { createServerClient } from '@/lib/supabase';
import { runAudit, type AuditReport } from '@/services/audit';

// GET /api/audit/{identifier}?fresh=1
//
// Public read-only audit. Anyone can hit this. {identifier} can be:
//   - A meme_id UUID (e.g. "8b71b9a4-1258-423b-b10f-334dc41a7ce3")
//   - A Solana mint address (base58, 32-44 chars — what partners
//     typically know about a token)
//   - A symbol like "GO" (case-insensitive fallback)
//
// We resolve to the internal meme_id first, then run the audit. This
// way partner integrations (e.g. Pump Tracks displaying an audit badge
// for one of its launches) only need the mint they already have.
//
// Caching: results are cached in-memory for CACHE_TTL_MS to keep the
// page snappy and to bound RPC cost. Pass ?fresh=1 to bypass the cache
// and force a live audit. The Cache-Control header reflects this so
// CDNs / partners get sensible behavior.
//
// CORS: Access-Control-Allow-Origin: * so partner frontends can call
// from any domain. The response is read-only and contains no secrets,
// so unrestricted CORS is the right default.

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// In-memory cache, keyed by the resolved meme_id (so multiple lookup
// keys for the same meme share the cache entry).
const cache = new Map<string, { report: AuditReport; expiresAt: number }>();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

async function resolveMemeId(
  supabase: ReturnType<typeof createServerClient>,
  raw: string,
): Promise<string | null> {
  if (UUID_RE.test(raw)) return raw;
  if (BASE58_RE.test(raw)) {
    const { data } = await supabase
      .from('memes')
      .select('id')
      .eq('mint_address', raw)
      .maybeSingle();
    return data?.id ?? null;
  }
  // Symbol fallback (case-insensitive). Cap at live launches so we
  // don't pull a pre-launch row that has nothing to audit.
  const { data } = await supabase
    .from('memes')
    .select('id')
    .ilike('symbol', raw)
    .eq('status', 'live')
    .order('launched_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ meme_id: string }> },
) {
  try {
    const { meme_id: identifier } = await params;
    if (!identifier) {
      return NextResponse.json(
        { error: 'identifier required (meme_id, mint address, or symbol)' },
        { status: 400, headers: CORS_HEADERS },
      );
    }

    const supabase = createServerClient();
    const memeId = await resolveMemeId(supabase, identifier);
    if (!memeId) {
      return NextResponse.json(
        { error: `no meme found for identifier "${identifier}"` },
        { status: 404, headers: CORS_HEADERS },
      );
    }

    const fresh = request.nextUrl.searchParams.get('fresh') === '1';
    const cached = cache.get(memeId);
    if (!fresh && cached && cached.expiresAt > Date.now()) {
      return NextResponse.json(
        { ...cached.report, cached: true, cache_age_ms: Date.now() - (cached.expiresAt - CACHE_TTL_MS) },
        { headers: { ...CORS_HEADERS, 'Cache-Control': 'public, max-age=60' } },
      );
    }

    const conn = new Connection(RPC_URL, 'confirmed');
    const report = await runAudit(supabase, conn, memeId);

    cache.set(memeId, { report, expiresAt: Date.now() + CACHE_TTL_MS });

    return NextResponse.json(
      { ...report, cached: false, cache_age_ms: 0 },
      { headers: { ...CORS_HEADERS, 'Cache-Control': 'public, max-age=30' } },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'unknown error' },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}
