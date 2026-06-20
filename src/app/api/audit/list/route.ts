import { NextResponse } from 'next/server';
import { Connection } from '@solana/web3.js';
import { createServerClient } from '@/lib/supabase';
import { runAudit } from '@/services/audit';

// GET /api/audit/list
//
// Returns a quick audit summary for every live meme, suitable for the
// /proof page's overview table. Each row is the same shape as
// /api/audit/{meme_id} returns. Runs all audits in parallel and uses
// the shared in-memory cache from the per-meme route (no duplication
// of RPC calls when the page renders).
//
// Caps at LIVE_LIMIT memes to keep total runtime sane on cold starts.

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const LIVE_LIMIT = 25;

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET() {
  try {
    const supabase = createServerClient();
    const { data: memes, error } = await supabase
      .from('memes')
      .select('id, symbol, name, mint_address, launched_at, visibility, status, current_backing_sol')
      .eq('status', 'live')
      .neq('visibility', 'stealth')
      .order('launched_at', { ascending: false })
      .limit(LIVE_LIMIT);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500, headers: CORS_HEADERS });
    }

    const conn = new Connection(RPC_URL, 'confirmed');
    const reports = await Promise.all(
      (memes || []).map(async (m) => {
        try {
          const r = await runAudit(supabase, conn, m.id);
          return { ...r, current_backing_sol: m.current_backing_sol, launched_at: m.launched_at };
        } catch (e) {
          return {
            meme_id: m.id, symbol: m.symbol, name: m.name, mint_address: m.mint_address,
            status: 'CRITICAL' as const,
            ran_at: new Date().toISOString(),
            findings: [{ severity: 'CRITICAL' as const, area: '!', msg: `audit threw: ${e instanceof Error ? e.message : 'unknown'}` }],
            summary: {
              rows_verified: 0, rows_phantom: 0, burn_on_chain: '0', burn_db_sum: '0',
              burn_drift_pct: null, uncollected_lamports: 0, bot_count: 0,
              backer_count: 0, total_claimable_sol: 0,
            },
            current_backing_sol: m.current_backing_sol,
            launched_at: m.launched_at,
          };
        }
      }),
    );

    // Aggregate stats. Tokens without bot stacks ("na") are counted
    // separately so the headline "clean / warn / critical" numbers
    // reflect only memes the audit actually applies to.
    const totalMemes = reports.length;
    const auditableReports = reports.filter((r) => r.status !== 'na');
    const naCount = totalMemes - auditableReports.length;
    const cleanCount = auditableReports.filter((r) => r.status === 'clean').length;
    const warnCount = auditableReports.filter((r) => r.status === 'warn').length;
    const criticalCount = auditableReports.filter((r) => r.status === 'CRITICAL').length;
    const totalPhantoms = auditableReports.reduce((s, r) => s + r.summary.rows_phantom, 0);
    const totalRowsVerified = auditableReports.reduce((s, r) => s + r.summary.rows_verified, 0);

    return NextResponse.json(
      {
        ran_at: new Date().toISOString(),
        aggregate: {
          total_memes: totalMemes,
          auditable: auditableReports.length,
          clean: cleanCount,
          warn: warnCount,
          critical: criticalCount,
          na: naCount,
          rows_verified: totalRowsVerified,
          phantoms_total: totalPhantoms,
        },
        reports,
      },
      { headers: { ...CORS_HEADERS, 'Cache-Control': 'public, max-age=60' } },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'unknown error' },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}
