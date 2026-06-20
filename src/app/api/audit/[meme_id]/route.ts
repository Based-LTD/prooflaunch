import { NextRequest, NextResponse } from 'next/server';
import { Connection } from '@solana/web3.js';
import { createServerClient } from '@/lib/supabase';
import { runAudit, type AuditReport } from '@/services/audit';

// GET /api/audit/{meme_id}?fresh=1
//
// Public read-only audit. Anyone can hit this. Returns the latest
// AuditReport for the given meme. The result is the same forensic check
// the operator runs locally via tools/audit-meme.mjs — exposed here so
// the public /proof page (and any partner integrator) can render the
// receipt without needing repo access.
//
// Caching: results are cached in-memory for CACHE_TTL_MS to keep the
// page snappy and to bound RPC cost. Pass ?fresh=1 to bypass the cache
// and force a live audit. The Cache-Control header reflects this so
// CDNs / partners get sensible behavior.

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

// In-memory cache (resets on cold start, fine for V1).
const cache = new Map<string, { report: AuditReport; expiresAt: number }>();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ meme_id: string }> },
) {
  try {
    const { meme_id } = await params;
    if (!meme_id) {
      return NextResponse.json({ error: 'meme_id required' }, { status: 400 });
    }

    const fresh = request.nextUrl.searchParams.get('fresh') === '1';
    const cached = cache.get(meme_id);
    if (!fresh && cached && cached.expiresAt > Date.now()) {
      return NextResponse.json(
        { ...cached.report, cached: true, cache_age_ms: Date.now() - (cached.expiresAt - CACHE_TTL_MS) },
        { headers: { 'Cache-Control': 'public, max-age=60' } },
      );
    }

    const supabase = createServerClient();
    const conn = new Connection(RPC_URL, 'confirmed');
    const report = await runAudit(supabase, conn, meme_id);

    cache.set(meme_id, { report, expiresAt: Date.now() + CACHE_TTL_MS });

    return NextResponse.json(
      { ...report, cached: false, cache_age_ms: 0 },
      { headers: { 'Cache-Control': 'public, max-age=30' } },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'unknown error' },
      { status: 500 },
    );
  }
}
