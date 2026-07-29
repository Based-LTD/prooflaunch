import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { Connection, PublicKey, LAMPORTS_PER_SOL, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

// READ-ONLY launch-readiness endpoint. Aggregates the "would the next
// launch succeed?" signals into one green/yellow/red verdict:
//
//   - Platform escrow SOL balance (fee-claim gas)
//   - Holder-rewards SOL balance (airdrop gas)
//   - Backings stuck at status='confirmed' on live memes (unclaimed slots)
//   - Funded memes past deadline that never launched
//
// Returns HTTP 200 for green/yellow, 503 for red — an uptime monitor
// (Better Uptime, UptimeRobot, etc.) can page off the status code with
// zero extra config. Read-only, safe to hit at any frequency.
//
// GET returns JSON:
//   { status: "green"|"yellow"|"red",
//     checks: {...},
//     as_of: iso }

export const dynamic = 'force-dynamic';

interface Check {
  status: 'green' | 'yellow' | 'red';
  detail?: string;
  [k: string]: unknown;
}

function derivePub(secretB58: string | undefined): string | null {
  if (!secretB58) return null;
  try {
    return Keypair.fromSecretKey(bs58.decode(secretB58.replace(/\\n/g, '\n').trim())).publicKey.toBase58();
  } catch { return null; }
}

const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

async function checkWalletGas(
  conn: Connection,
  address: string | null,
  greenAt: number,
  yellowAt: number,
  label: string,
): Promise<Check> {
  if (!address) {
    return { status: 'red', detail: `${label}: no address configured` };
  }
  try {
    const lam = await conn.getBalance(new PublicKey(address), 'confirmed');
    const sol = lam / LAMPORTS_PER_SOL;
    const status: Check['status'] = sol >= greenAt ? 'green' : sol >= yellowAt ? 'yellow' : 'red';
    return {
      status,
      wallet: address,
      sol: Number(sol.toFixed(6)),
      threshold_green: greenAt,
      threshold_yellow: yellowAt,
      detail: status === 'red'
        ? `${label}: ${sol.toFixed(4)} SOL — CRITICAL (< ${yellowAt}); fee-claim + distribution will fail`
        : status === 'yellow'
        ? `${label}: ${sol.toFixed(4)} SOL — low, top up soon (< ${greenAt})`
        : `${label}: ${sol.toFixed(4)} SOL — healthy (≥ ${greenAt})`,
    };
  } catch (e) {
    return { status: 'red', detail: `${label}: RPC lookup failed — ${e instanceof Error ? e.message : String(e)}` };
  }
}

export async function GET(_request: NextRequest) {
  const supabase = createServerClient();
  const conn = new Connection(RPC_URL, 'confirmed');
  const checks: Record<string, Check> = {};

  // 1. Escrow wallet gas (drives every fee-claim tx)
  const escrowPub = derivePub(process.env.ESCROW_WALLET_PRIVATE_KEY);
  checks.escrow_gas = await checkWalletGas(conn, escrowPub, 0.1, 0.02, 'escrow');

  // 2. Holder-rewards wallet gas (drives daily airdrops + emergency-loan buffer)
  const rewardsPub = derivePub(process.env.HOLDER_REWARDS_WALLET_PRIVATE_KEY);
  checks.holder_rewards_gas = await checkWalletGas(conn, rewardsPub, 0.05, 0.02, 'holder-rewards');

  // 3. Stuck backings — confirmed on live memes ≥ 10 min old
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: stuck } = await supabase
    .from('backings')
    .select('id, meme_id, backer_wallet, amount_sol, slot_number, memes!inner(symbol, status, launched_at)')
    .eq('status', 'confirmed')
    .eq('memes.status', 'live')
    .lt('memes.launched_at', tenMinAgo);
  const stuckCount = stuck?.length || 0;
  const memesWithStuck = new Set((stuck || []).map(s => (s.memes as unknown as { symbol: string })?.symbol).filter(Boolean));
  checks.stuck_backings = {
    status: stuckCount === 0 ? 'green' : stuckCount < 3 ? 'yellow' : 'red',
    count: stuckCount,
    memes: [...memesWithStuck],
    detail: stuckCount === 0
      ? 'no stuck backings on any live meme'
      : `${stuckCount} backing(s) stuck at confirmed on ${memesWithStuck.size} live meme(s): ${[...memesWithStuck].join(', ')}`,
  };

  // 4. Funded memes past deadline that never launched (should have been
  //    auto-refunded by /api/process-memes cron)
  const nowIso = new Date().toISOString();
  const { data: overdue } = await supabase
    .from('memes')
    .select('id, symbol, backing_deadline, current_backing_sol')
    .eq('status', 'funded')
    .lt('backing_deadline', nowIso);
  const overdueCount = overdue?.length || 0;
  checks.overdue_funded = {
    status: overdueCount === 0 ? 'green' : 'yellow',
    count: overdueCount,
    memes: (overdue || []).map(m => m.symbol),
    detail: overdueCount === 0
      ? 'no funded memes past deadline'
      : `${overdueCount} funded meme(s) past deadline — creator hasn't clicked LAUNCH: ${(overdue || []).map(m => m.symbol).join(', ')}`,
  };

  // 5. Any launch attempts that errored in the last 24h (from launch_events)
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: recentErrors } = await supabase
    .from('launch_events')
    .select('id, meme_id, event, detail, created_at')
    .eq('event', 'reconcile_error')
    .gte('created_at', dayAgo)
    .limit(20);
  const errorCount = recentErrors?.length || 0;
  checks.recent_launch_errors_24h = {
    status: errorCount === 0 ? 'green' : errorCount < 5 ? 'yellow' : 'red',
    count: errorCount,
    detail: errorCount === 0
      ? 'no launch/distribute errors in the last 24h'
      : `${errorCount} launch_events with event=reconcile_error in last 24h`,
  };

  // Overall status = worst of any individual check
  const rank = { green: 0, yellow: 1, red: 2 };
  const worst = Object.values(checks).reduce<Check['status']>((w, c) => rank[c.status] > rank[w] ? c.status : w, 'green');
  const httpStatus = worst === 'red' ? 503 : 200;

  return NextResponse.json({
    status: worst,
    checks,
    as_of: new Date().toISOString(),
  }, { status: httpStatus });
}
