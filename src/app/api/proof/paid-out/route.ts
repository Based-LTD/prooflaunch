import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

// Live total of SOL airdropped to PROOF holders.
//
// Sums confirmed payouts (status='sent') from holder_distribution_payouts
// — i.e. the daily PROOF-holder airdrop only. Excludes per-slot backer
// fee claims (those go to backers via a different mechanism and aren't
// what we're advertising here).
//
// Cached 60s — the cron runs at most once per day, so we don't need
// sub-minute freshness, and the ticker hits this on every page load.

export const revalidate = 60;

const LAMPORTS_PER_SOL = 1_000_000_000;

export async function GET() {
  try {
    const supabase = createServerClient();

    // Aggregate via JS, PAGINATED. Supabase caps any single query at 1000
    // rows; once the table crossed 1000 payouts (~2026-08) the old
    // unpaginated version summed an arbitrary 1000-row subset, so the
    // public counter UNDERCOUNTED and even wobbled downward as inserts
    // shifted which rows came back (8.33 → 8.31 while the true total was
    // 9.27). A monotonic counter that decreases = row-cap bug.
    const PAGE = 1000;
    let totalLamports = 0;
    let payoutCount = 0;
    for (let page = 0; ; page++) {
      const { data, error } = await supabase
        .from('holder_distribution_payouts')
        .select('share_lamports')
        .eq('status', 'sent')
        .order('id', { ascending: true })
        .range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      for (const p of data) totalLamports += Number(p.share_lamports || 0);
      payoutCount += data.length;
      if (data.length < PAGE) break;
    }
    const totalPaidOutSol = totalLamports / LAMPORTS_PER_SOL;

    return NextResponse.json(
      {
        totalPaidOutSol,
        payoutCount,
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        },
      },
    );
  } catch (err) {
    console.error('proof/paid-out error:', err);
    return NextResponse.json({ totalPaidOutSol: 0, payoutCount: 0, error: 'lookup_failed' });
  }
}
