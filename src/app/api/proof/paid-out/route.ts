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

    // Aggregate via JS: payouts are small (one row per holder per day) so
    // pulling them is cheap and avoids needing a SQL aggregate RPC.
    const { data: payouts, error } = await supabase
      .from('holder_distribution_payouts')
      .select('share_lamports')
      .eq('status', 'sent');
    if (error) throw error;

    const totalLamports = (payouts || []).reduce(
      (sum, p) => sum + Number(p.share_lamports || 0),
      0,
    );
    const totalPaidOutSol = totalLamports / LAMPORTS_PER_SOL;

    return NextResponse.json(
      {
        totalPaidOutSol,
        payoutCount: payouts?.length || 0,
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
