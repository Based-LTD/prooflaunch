import { NextRequest, NextResponse } from 'next/server';
import {
  Connection, PublicKey, Keypair, Transaction, SystemProgram, ComputeBudgetProgram,
} from '@solana/web3.js';
import { createServerClient } from '@/lib/supabase';
import { getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { SolanaStreamClient, ICluster } from '@streamflow/stream';
import bs58 from 'bs58';
import crypto from 'crypto';

// Daily PROOF-holder airdrop cron.
//
// Schedule: hourly (vercel.json "0 * * * *"). Each fire computes today's
// "lucky hour" deterministically from the UTC date (sha256 → byte 0 → mod 24)
// and only the matching hour actually runs the distribution. Other hours
// no-op. Net effect: one distribution per day at a different hour each day,
// surprising to outside observers without revealing the algorithm publicly.
//
// Idempotency: holder_distributions.epoch_date UNIQUE guarantees one
// distribution per UTC date even if the lucky-hour check is bypassed or a
// retry happens.

export const maxDuration = 300; // 5 min — needs Vercel Pro+

const PROOF_MINT = 'oaBXM2rCnWFeQc9ufdTSSpASwSrMBPrSmg8xtiepooL';
const PROOF_DECIMALS = 6;
const MIN_PAYOUT_LAMPORTS = 1_000_000; // 0.001 SOL dust floor
const RESERVE_LAMPORTS = 1_000_000;     // leave ~0.001 SOL for gas in rewards wallet
const PAYOUTS_PER_TX = 18;
const TOKEN_2022 = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const SPL_TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const PUMP_BC = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');

// Wallets EXCLUDED from airdrop (DEX pools, platform wallets, founder wallets,
// burn addresses). MUST mirror tools/airdrop-snapshot.mjs.
const EXCLUDED_WALLETS = new Set<string>([
  '8xLcPgxcMtYNPq2bw931hVuSYSXPCc6jRczDu64Bgm16', // PumpSwap AMM pool for PROOF
  '83u1MraLPeq3ZqGo4GKqeg5FLk6YpSR7H7GcgZc2s9Ko', // platform escrow / on-chain creator
  'CZnvVTTutAF7QTh5reQqRHE5i8J9cm1CWwaiQXi3QaXm', // PLATFORM_WALLET (slot 4)
  '8wDY912FsVPxuiZhifXeMQbNt6BvLet1AV8bh74FJnvw', // founder locked-supply (Streamflow recipient)
  'EsA8NH8588FFdhUzvxPUn9bPzr8rZi9nPz5E136bLAir', // founder slot 1 (Streamflow sender)
  '11111111111111111111111111111111',              // burn / system
]);

// Compute today's "lucky hour" deterministically. Same input (UTC date) →
// same output, but each day picks a different hour. Outside observers can't
// predict without knowing this algorithm.
function todaysLuckyHour(date: Date): number {
  const utcDate = date.toISOString().slice(0, 10); // "YYYY-MM-DD"
  const hash = crypto.createHash('sha256').update(utcDate).digest();
  return hash[0] % 24;
}

interface AirdropResult {
  status: 'distributed' | 'skipped_wrong_hour' | 'skipped_already_done' | 'skipped_pool_too_small' | 'error';
  message: string;
  distribution_id?: string;
  total_paid_sol?: number;
  wallet_count?: number;
  carry_forward_count?: number;
  current_hour?: number;
  lucky_hour?: number;
  successCount?: number;
  failCount?: number;
}

async function runAirdrop(force: boolean = false): Promise<AirdropResult> {
  const now = new Date();
  const currentHour = now.getUTCHours();
  const luckyHour = todaysLuckyHour(now);

  if (!force && currentHour !== luckyHour) {
    return {
      status: 'skipped_wrong_hour',
      message: `Today's lucky hour is ${luckyHour}; current hour is ${currentHour}. No-op.`,
      current_hour: currentHour,
      lucky_hour: luckyHour,
    };
  }

  const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
  if (!rpcUrl) return { status: 'error', message: 'NEXT_PUBLIC_SOLANA_RPC_URL not set' };
  const conn = new Connection(rpcUrl, 'confirmed');
  const supabase = createServerClient();

  // Rewards wallet keypair
  const rewardsKey = process.env.HOLDER_REWARDS_WALLET_PRIVATE_KEY;
  if (!rewardsKey) return { status: 'error', message: 'HOLDER_REWARDS_WALLET_PRIVATE_KEY not set' };
  const rewardsKp = Keypair.fromSecretKey(bs58.decode(rewardsKey));
  if (rewardsKp.publicKey.toBase58() !== process.env.HOLDER_REWARDS_WALLET_ADDRESS) {
    return { status: 'error', message: 'HOLDER_REWARDS_WALLET key/pubkey mismatch' };
  }
  EXCLUDED_WALLETS.add(rewardsKp.publicKey.toBase58());

  // Add the BC PDA dynamically
  const [bcPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('bonding-curve'), new PublicKey(PROOF_MINT).toBuffer()],
    PUMP_BC,
  );
  EXCLUDED_WALLETS.add(bcPda.toBase58());

  // Pool size
  const poolLamports = await conn.getBalance(rewardsKp.publicKey, 'confirmed');
  const distributableLamports = Math.max(0, poolLamports - RESERVE_LAMPORTS);
  if (distributableLamports < MIN_PAYOUT_LAMPORTS) {
    return {
      status: 'skipped_pool_too_small',
      message: `Pool ${(poolLamports / 1e9).toFixed(6)} SOL below dust floor. No-op.`,
    };
  }

  // Snapshot holders (Token-2022 + SPL via getProgramAccounts)
  const holders = new Map<string, bigint>();
  for (const prog of [TOKEN_2022, SPL_TOKEN]) {
    try {
      const accts = await conn.getProgramAccounts(prog, {
        commitment: 'confirmed',
        filters: [{ memcmp: { offset: 0, bytes: PROOF_MINT } }],
      });
      for (const a of accts) {
        const data = a.account.data;
        if (data.length < 72) continue;
        const amount = data.readBigUInt64LE(64);
        if (amount === BigInt(0)) continue;
        const owner = new PublicKey(data.slice(32, 64)).toBase58();
        holders.set(owner, (holders.get(owner) || BigInt(0)) + amount);
      }
    } catch (e) {
      // SPL might 429 on large datasets; PROOF is T22-only so non-fatal
      console.warn(`getProgramAccounts ${prog.toBase58()}: ${e instanceof Error ? e.message : e}`);
    }
  }

  // Filter exclusions
  for (const ex of EXCLUDED_WALLETS) holders.delete(ex);

  // Layer Streamflow-locked balances (search by sender — same pattern as Roster)
  const streamClient = new SolanaStreamClient(rpcUrl, ICluster.Mainnet, 'confirmed');
  const walletList = [...holders.keys()];
  const CHUNK = 25;
  for (let i = 0; i < walletList.length; i += CHUNK) {
    const chunk = walletList.slice(i, i + CHUNK);
    await Promise.all(chunk.map(async (wallet) => {
      try {
        const streams = await streamClient.searchStreams({ mint: PROOF_MINT, sender: wallet });
        if (!streams || streams.length === 0) return;
        const balances = await Promise.all(streams.map(async (s) => {
          try {
            const raw = (s.account as { escrowTokens?: unknown })?.escrowTokens;
            if (!raw) return BigInt(0);
            const pk = typeof raw === 'string'
              ? new PublicKey(raw)
              : new PublicKey((raw as { toBase58?: () => string }).toBase58 ? (raw as { toBase58: () => string }).toBase58() : raw as never);
            const info = await conn.getAccountInfo(pk);
            if (!info) return BigInt(0);
            return info.data.readBigUInt64LE(64);
          } catch { return BigInt(0); }
        }));
        const totalLocked = balances.reduce((s, x) => s + x, BigInt(0));
        if (totalLocked > BigInt(0)) {
          holders.set(wallet, (holders.get(wallet) || BigInt(0)) + totalLocked);
        }
      } catch { /* no streams for this wallet — ignore */ }
    }));
  }

  // Compute pro-rata payouts with CARRY-FORWARD ACCUMULATOR:
  //   1. Read each wallet's prior pending_lamports from DB
  //   2. Add today's pro-rata share to it
  //   3. If accumulated balance >= dust floor → schedule payout + reset to 0
  //   4. Else → just bump pending_lamports (no payout this round)
  // Net effect: every holder gets paid eventually, in proportion to their
  // PROOF, averaged over however many days it takes to cross floor.
  const eligibleSupply = [...holders.values()].reduce((s, x) => s + x, BigInt(0));
  if (eligibleSupply === BigInt(0)) {
    return { status: 'error', message: 'Eligible supply is zero — no holders' };
  }

  // Load existing pending balances for all eligible wallets in one query
  const walletAddresses = [...holders.keys()];
  const { data: pendingRows } = await supabase
    .from('holder_pending_balances')
    .select('wallet, pending_lamports')
    .in('wallet', walletAddresses);
  const priorPending = new Map<string, number>();
  for (const r of pendingRows || []) priorPending.set(r.wallet, Number(r.pending_lamports));

  // For every eligible holder: compute share, add to their pending, decide payout
  const payouts: { wallet: string; balance: bigint; shareLamports: number; accruedThisRoundLamports: number }[] = [];
  const carryForwards: { wallet: string; newPendingLamports: number; accruedThisRoundLamports: number }[] = [];
  for (const [wallet, balance] of holders) {
    const thisRoundShareLamports = Number((balance * BigInt(distributableLamports)) / eligibleSupply);
    if (thisRoundShareLamports === 0) continue; // truly zero — skip (no row needed)
    const accumulated = (priorPending.get(wallet) || 0) + thisRoundShareLamports;
    if (accumulated >= MIN_PAYOUT_LAMPORTS) {
      payouts.push({ wallet, balance, shareLamports: accumulated, accruedThisRoundLamports: thisRoundShareLamports });
    } else {
      carryForwards.push({ wallet, newPendingLamports: accumulated, accruedThisRoundLamports: thisRoundShareLamports });
    }
  }

  if (payouts.length === 0 && carryForwards.length === 0) {
    return { status: 'skipped_pool_too_small', message: 'No qualifying shares (pool exhausted by rounding?)' };
  }

  const totalPayoutLamports = payouts.reduce((s, p) => s + p.shareLamports, 0);

  // Insert distribution row — UNIQUE on epoch_date prevents same-day re-runs
  const today = now.toISOString().slice(0, 10);
  const { data: distRow, error: distErr } = await supabase.from('holder_distributions').insert({
    distributed_at: now.toISOString(),
    epoch_date: today,
    total_sol_lamports: totalPayoutLamports,
    holder_count: payouts.length,
    eligible_supply_tokens: Number(eligibleSupply) / 10 ** PROOF_DECIMALS,
    status: 'in_progress',
  }).select().single();

  if (distErr) {
    if (distErr.code === '23505') {
      return {
        status: 'skipped_already_done',
        message: `Already distributed for ${today} (epoch unique violation).`,
      };
    }
    return { status: 'error', message: `Failed to create distribution row: ${distErr.message}` };
  }

  // Queue payout rows
  const { error: insertErr } = await supabase.from('holder_distribution_payouts').insert(
    payouts.map(p => ({
      distribution_id: distRow.id,
      wallet: p.wallet,
      proof_balance: Number(p.balance) / 10 ** PROOF_DECIMALS,
      share_lamports: p.shareLamports,
      status: 'pending',
    })),
  );
  if (insertErr) {
    await supabase.from('holder_distributions').update({ status: 'failed' }).eq('id', distRow.id);
    return { status: 'error', message: `Failed to queue payout rows: ${insertErr.message}` };
  }

  // Broadcast in batches
  let successCount = 0, failCount = 0;
  for (let b = 0; b < payouts.length; b += PAYOUTS_PER_TX) {
    const batch = payouts.slice(b, b + PAYOUTS_PER_TX);
    const tx = new Transaction()
      .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }))
      .add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }));
    for (const p of batch) {
      tx.add(SystemProgram.transfer({
        fromPubkey: rewardsKp.publicKey,
        toPubkey: new PublicKey(p.wallet),
        lamports: p.shareLamports,
      }));
    }
    try {
      tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
      tx.feePayer = rewardsKp.publicKey;
      const sig = await conn.sendTransaction(tx, [rewardsKp]);
      await conn.confirmTransaction(sig, 'confirmed');
      const ids = batch.map(p => p.wallet);
      await supabase.from('holder_distribution_payouts')
        .update({ status: 'sent', tx_sig: sig })
        .eq('distribution_id', distRow.id)
        .in('wallet', ids);
      successCount += batch.length;
    } catch (e) {
      console.error(`batch ${b / PAYOUTS_PER_TX + 1} failed:`, e instanceof Error ? e.message : e);
      failCount += batch.length;
    }
  }

  // Carry-forward DB writes:
  //   - For wallets that got paid: reset pending → 0, bump lifetime paid + payout_count
  //   - For wallets that carry-forward: set pending → accumulated balance
  // We use upsert (PK = wallet) so first-time wallets get a row created.
  const pendingNow = new Date().toISOString();
  const upserts: Array<{
    wallet: string; pending_lamports: number; last_updated: string;
    total_accrued_lamports: number; total_paid_lamports: number; payout_count: number;
  }> = [];

  for (const p of payouts) {
    const priorRow = pendingRows?.find(r => r.wallet === p.wallet);
    const priorTotalAccrued = priorRow ? Number((priorRow as { total_accrued_lamports?: number }).total_accrued_lamports || 0) : 0;
    const priorTotalPaid = priorRow ? Number((priorRow as { total_paid_lamports?: number }).total_paid_lamports || 0) : 0;
    const priorPayoutCount = priorRow ? Number((priorRow as { payout_count?: number }).payout_count || 0) : 0;
    upserts.push({
      wallet: p.wallet,
      pending_lamports: 0,                              // paid this round, reset
      last_updated: pendingNow,
      total_accrued_lamports: priorTotalAccrued + p.accruedThisRoundLamports,
      total_paid_lamports: priorTotalPaid + p.shareLamports,
      payout_count: priorPayoutCount + 1,
    });
  }
  for (const c of carryForwards) {
    const priorRow = pendingRows?.find(r => r.wallet === c.wallet);
    const priorTotalAccrued = priorRow ? Number((priorRow as { total_accrued_lamports?: number }).total_accrued_lamports || 0) : 0;
    const priorTotalPaid = priorRow ? Number((priorRow as { total_paid_lamports?: number }).total_paid_lamports || 0) : 0;
    const priorPayoutCount = priorRow ? Number((priorRow as { payout_count?: number }).payout_count || 0) : 0;
    upserts.push({
      wallet: c.wallet,
      pending_lamports: c.newPendingLamports,           // still below floor, accumulate
      last_updated: pendingNow,
      total_accrued_lamports: priorTotalAccrued + c.accruedThisRoundLamports,
      total_paid_lamports: priorTotalPaid,              // no payout this round
      payout_count: priorPayoutCount,
    });
  }
  if (upserts.length > 0) {
    const { error: pendingErr } = await supabase
      .from('holder_pending_balances')
      .upsert(upserts, { onConflict: 'wallet' });
    if (pendingErr) console.error('pending balances upsert failed:', pendingErr.message);
  }

  // Finalize
  await supabase.from('holder_distributions')
    .update({ status: failCount === 0 ? 'completed' : 'partial' })
    .eq('id', distRow.id);

  return {
    status: 'distributed',
    message: `${successCount} sent, ${failCount} failed; ${carryForwards.length} accumulating`,
    distribution_id: distRow.id,
    total_paid_sol: totalPayoutLamports / 1e9,
    wallet_count: payouts.length,
    carry_forward_count: carryForwards.length,
    successCount,
    failCount,
  };
}

// Vercel cron fires GET hourly; check x-vercel-cron header OR allow manual
// trigger via Bearer auth (same pattern as /api/fees/process).
export async function GET(request: NextRequest) {
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const authHeader = request.headers.get('authorization');
  const expectedKey = process.env.CRON_SECRET || 'prooflaunch-fees';
  const force = new URL(request.url).searchParams.get('force') === '1';

  if (!isVercelCron && authHeader !== `Bearer ${expectedKey}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await runAirdrop(force);
    return NextResponse.json(result);
  } catch (e) {
    console.error('Airdrop cron error:', e);
    return NextResponse.json(
      { status: 'error', message: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  // Same as GET — included for symmetry with manual cron triggers
  return GET(request);
}
