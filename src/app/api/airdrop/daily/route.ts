import { NextRequest, NextResponse } from 'next/server';
import {
  Connection, PublicKey, Keypair, Transaction, SystemProgram, ComputeBudgetProgram,
} from '@solana/web3.js';
import { createServerClient } from '@/lib/supabase';
import { KNOWN_PDA_PROGRAMS } from '@/lib/holderFilter';
import { authorizeCron } from '@/lib/cronAuth';
import { simulateAndSend, adaptivePriorityFeeIx } from '@/lib/rpcHelpers';
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
// Reserve calibration history:
//   - 1M lamports (0.001 SOL): original. Too small — 2026-07-11/12
//     batches ran out of fee budget partway through, later batches
//     simulate-failed.
//   - 20M (0.02 SOL): overcorrection ab9de52. HRW naturally sits at
//     ~0.02-0.05 SOL at low fee-volume periods; the 20M reserve
//     starved distributions to zero (2026-07-14/15/16: all skipped
//     or 0-holder rounds).
//   - 5M (0.005 SOL): current. Covers ~25 batches × 200k lamports
//     max priority fee per tx — enough headroom for a bad congestion
//     day without swallowing the whole distributable pool when the
//     wallet is small.
const RESERVE_LAMPORTS = 5_000_000;     // 0.005 SOL
// Per-batch reserve required BEFORE we attempt each tx — this is a
// gate: if the pool balance drops below (batch payout + this margin),
// we skip the batch cleanly rather than simulate-failing. Sized to
// realistic per-tx max fee (200k priority + 5k tx = ~205k).
const PER_BATCH_FEE_RESERVE_LAMPORTS = 250_000; // 0.00025 SOL
const PAYOUTS_PER_TX = 18;
// Number of send attempts per batch. First attempt uses whatever
// blockhash is live. If it fails (transient RPC issue, blockhash
// aged, priority fee spike since simulate), we backoff briefly and
// retry once with a fresh blockhash + fresh priority-fee sample.
const BATCH_ATTEMPTS = 2;
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
  'ELFjjx7Ax5kaWnmNCJqwwPirYj5Mne4Gphy5MLzgX5SE', // PROOF Buyback wallet (Streamflow sender of locked buyback PROOF) — platform wallet, must not receive holder rewards. Missed in May 2026 rotation; was taking the largest airdrop slice until 2026-08-30.
  'DRwYbZuhD8VLvgU18TKx4jm8rZaoUudoMQQzuziGqnrx', // current platform escrow (post 2026-07-25 rotation) — defensive; old escrow excluded above
  '6y87wcKcjGM2bSqXFtuqKTfEmkmQHkHu75hSGu3uAj1Z', // pre-rotation buyback wallet — defensive (dead, 0 SOL)
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

// Was paused 2026-06-27 — 2026-06-30. Research (deep-research run on
// 2026-06-28) confirmed the realistic SEC enforcement floor for small
// Solana launchpads sits orders of magnitude above prooflaunch's
// sub-$100k lifetime revenue / ~100-user scale. Pump.fun at $1B+
// revenue has zero SEC enforcement; the Feb 2025 SEC memecoin staff
// statement undercut the securities theory in the Aguilar class
// action against them. Resumed full distribution after research-
// informed pivot. Flag left in place as a kill switch — flip to true
// to pause again if anything signal-level changes.
const AIRDROP_PAUSED_FOR_LEGAL_REVIEW = false;

async function runAirdrop(force: boolean = false): Promise<AirdropResult> {
  const now = new Date();
  const currentHour = now.getUTCHours();
  const luckyHour = todaysLuckyHour(now);

  if (AIRDROP_PAUSED_FOR_LEGAL_REVIEW) {
    return {
      status: 'skipped_wrong_hour',
      message: 'Holder airdrop is paused pending legal review of the distribution mechanism. Accumulating fees remain in HOLDER_REWARDS_WALLET; see /roadmap for resumption paths.',
      current_hour: currentHour,
      lucky_hour: luckyHour,
    };
  }

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

  // Filter known DeFi PDAs. Curated denylist of program IDs whose PDAs
  // hold tokens on behalf of users but can't be airdropped to (no human
  // claim path). Same approach Jito / MNDE / BONK distributions use —
  // err on the side of including legit holders (multisigs like Squads,
  // governance treasuries like Realms, any wallet whose owner isn't on
  // the list) and only exclude confirmed DeFi venues. Refresh quarterly.
  //
  // IMPORTANT: Jupiter Wallet (jup.ag's mobile/extension wallet) is a
  // self-custody EOA — its addresses are System-Program owned, same as
  // Phantom/Backpack/Solflare/Ledger. NOT filtered.
  //
  // Edge case: brand-new wallets that received PROOF but never received
  // SOL have NO on-chain SOL account yet (info === null). These are
  // valid — keep them; the airdrop transfer itself creates the account.
  const candidateWallets = [...holders.keys()];
  if (candidateWallets.length > 0) {
    const BATCH = 100;
    const allInfos: (Awaited<ReturnType<typeof conn.getAccountInfo>>)[] = [];
    for (let i = 0; i < candidateWallets.length; i += BATCH) {
      const batch = candidateWallets.slice(i, i + BATCH).map((w) => new PublicKey(w));
      const infos = await conn.getMultipleAccountsInfo(batch, 'confirmed');
      allInfos.push(...infos);
    }
    let droppedPdas = 0;
    for (let i = 0; i < candidateWallets.length; i++) {
      const info = allInfos[i];
      if (!info) continue;
      if (KNOWN_PDA_PROGRAMS.has(info.owner.toBase58())) {
        holders.delete(candidateWallets[i]);
        droppedPdas++;
      }
    }
    if (droppedPdas > 0) {
      console.log(`[airdrop] filtered ${droppedPdas} PDA holder(s) on known DeFi programs`);
    }
  }

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
  // prorateRemainder: the un-paid portion when total accumulated payouts exceed
  // the actual pool. Set by the prorate step below (defaults to 0 pre-prorate).
  // On upsert, this remainder becomes the wallet's new pending_lamports so the
  // scaled-down share carries forward to the next round.
  const payouts: { wallet: string; balance: bigint; shareLamports: number; accruedThisRoundLamports: number; prorateRemainder: number }[] = [];
  const carryForwards: { wallet: string; newPendingLamports: number; accruedThisRoundLamports: number }[] = [];
  for (const [wallet, balance] of holders) {
    const thisRoundShareLamports = Number((balance * BigInt(distributableLamports)) / eligibleSupply);
    if (thisRoundShareLamports === 0) continue; // truly zero — skip (no row needed)
    const accumulated = (priorPending.get(wallet) || 0) + thisRoundShareLamports;
    if (accumulated >= MIN_PAYOUT_LAMPORTS) {
      payouts.push({ wallet, balance, shareLamports: accumulated, accruedThisRoundLamports: thisRoundShareLamports, prorateRemainder: 0 });
    } else {
      carryForwards.push({ wallet, newPendingLamports: accumulated, accruedThisRoundLamports: thisRoundShareLamports });
    }
  }

  if (payouts.length === 0 && carryForwards.length === 0) {
    return { status: 'skipped_pool_too_small', message: 'No qualifying shares (pool exhausted by rounding?)' };
  }

  // PRORATE GUARD: sum of (this-round-share + prior-pending) can exceed
  // the actual distributable pool. This happens when prior rounds failed
  // and pending balances accumulated across many holders — over N failed
  // rounds, pending stacks up but the wallet's SOL doesn't. If we ship
  // the full accumulated payouts as-is, later batches simulate-fail with
  // insufficient funds and the whole round dies (2026-07-18..22: half of
  // daily runs partial with 0-13 pending each).
  //
  // Fix: if sum(payouts) > distributable, scale every payout down by
  // the same factor. The remainder stays in each wallet's pending
  // balance (via the downstream upsert), gets picked up on the next
  // round when fresh SOL has come in from fee collection.
  //
  // Preserves fairness — everyone still gets their proportional share,
  // just paid across more rounds instead of one. And guarantees every
  // batch tx fits the wallet, so no more silent-partial-round failures.
  const totalOwedLamports = payouts.reduce((s, p) => s + p.shareLamports, 0);
  console.log(`[airdrop] pool=${distributableLamports} owed=${totalOwedLamports} payouts=${payouts.length} carry-fwd=${carryForwards.length}`);
  if (totalOwedLamports > distributableLamports) {
    const scaleNum = distributableLamports;
    const scaleDen = totalOwedLamports;
    console.warn(`[airdrop] prorating: owed ${totalOwedLamports} > distributable ${distributableLamports} → scale ${(scaleNum/scaleDen*100).toFixed(1)}%. Remainder stays as pending for next round.`);
    for (const p of payouts) {
      const scaled = Math.floor(p.shareLamports * scaleNum / scaleDen);
      // prorateRemainder is what goes BACK to pending on upsert (the un-
      // paid portion that carries forward). shareLamports becomes what
      // actually gets sent in the batch tx.
      p.prorateRemainder = p.shareLamports - scaled;
      p.shareLamports = scaled;
    }
    // After scaling, some wallets may fall below MIN_PAYOUT dust floor.
    // Move them out of payouts + into carryForwards so their tiny
    // scaled share just accumulates instead of eating a tx fee.
    const stillPayable = payouts.filter((p) => p.shareLamports >= MIN_PAYOUT_LAMPORTS);
    const droppedToDust = payouts.filter((p) => p.shareLamports < MIN_PAYOUT_LAMPORTS);
    for (const p of droppedToDust) {
      // Full accumulated stays pending (their pre-prorate accumulated
      // = the shareLamports + prorateRemainder they had before scaling).
      const fullAccumulated = p.shareLamports + p.prorateRemainder;
      carryForwards.push({ wallet: p.wallet, newPendingLamports: fullAccumulated, accruedThisRoundLamports: 0 });
    }
    payouts.length = 0;
    payouts.push(...stillPayable);
    console.log(`[airdrop] after prorate: ${payouts.length} payouts (${droppedToDust.length} dropped to dust)`);
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

  // Broadcast in batches. Track per-wallet success so failed batches
  // don't get their pending_lamports zeroed downstream — silent loss
  // bug we hit 2026-06-23..27 (three fully-failed rounds silently
  // marked wallets as paid). Also uses per-batch pre-flight balance
  // check + retry-with-backoff — see 2026-07-11/12 which lost the
  // whole round to a transient dip that would've recovered on retry.
  let successCount = 0, failCount = 0;
  const paidWallets = new Set<string>();
  const batchFailures: Array<{ batch: number; attempts: string[] }> = [];

  for (let b = 0; b < payouts.length; b += PAYOUTS_PER_TX) {
    const batch = payouts.slice(b, b + PAYOUTS_PER_TX);
    const batchIdx = b / PAYOUTS_PER_TX + 1;
    const batchSumLamports = batch.reduce((s, p) => s + p.shareLamports, 0);

    // Pre-flight: verify wallet has enough for this batch's payouts
    // PLUS a fee margin. If not, skip cleanly rather than simulate-fail.
    // The pending balances stay intact (correctness fix from 9f3a6f9)
    // so these wallets get paid on the next successful airdrop.
    const currentBal = await conn.getBalance(rewardsKp.publicKey, 'confirmed');
    const needed = batchSumLamports + PER_BATCH_FEE_RESERVE_LAMPORTS;
    if (currentBal < needed) {
      const msg = `insufficient wallet balance: ${currentBal} lamports available, ${needed} needed (batch payout ${batchSumLamports} + fee reserve ${PER_BATCH_FEE_RESERVE_LAMPORTS})`;
      console.error(`[airdrop] batch ${batchIdx} pre-flight skip: ${msg}`);
      failCount += batch.length;
      batchFailures.push({ batch: batchIdx, attempts: ['pre-flight: ' + msg] });
      continue;
    }

    // Attempt loop: fresh priority fee + fresh blockhash on each try.
    let landedSig: string | null = null;
    const attemptErrors: string[] = [];
    for (let attempt = 1; attempt <= BATCH_ATTEMPTS; attempt++) {
      try {
        // Re-sample priority fee per attempt — mempool congestion can
        // change between the pre-flight check and now.
        const priorityIx = await adaptivePriorityFeeIx(conn, { fallback: 50_000 });
        const tx = new Transaction()
          .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }))
          .add(priorityIx);
        for (const p of batch) {
          tx.add(SystemProgram.transfer({
            fromPubkey: rewardsKp.publicKey,
            toPubkey: new PublicKey(p.wallet),
            lamports: p.shareLamports,
          }));
        }
        tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
        tx.feePayer = rewardsKp.publicKey;
        // SOL-029: simulate before send.
        const sig = await simulateAndSend(conn, tx, [rewardsKp], { label: `airdrop:${b}:${attempt}` });
        await conn.confirmTransaction(sig, 'confirmed');
        landedSig = sig;
        break;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        attemptErrors.push(`attempt ${attempt}: ${msg}`);
        console.error(`[airdrop] batch ${batchIdx} attempt ${attempt}/${BATCH_ATTEMPTS} failed: ${msg}`);
        if (attempt < BATCH_ATTEMPTS) {
          // Brief backoff for transient conditions (blockhash aging,
          // RPC hiccup, priority spike since simulate).
          await new Promise(r => setTimeout(r, 500));
        }
      }
    }

    if (landedSig) {
      const ids = batch.map(p => p.wallet);
      await supabase.from('holder_distribution_payouts')
        .update({ status: 'sent', tx_sig: landedSig })
        .eq('distribution_id', distRow.id)
        .in('wallet', ids);
      successCount += batch.length;
      for (const p of batch) paidWallets.add(p.wallet);
    } else {
      failCount += batch.length;
      batchFailures.push({ batch: batchIdx, attempts: attemptErrors });
    }
  }

  // Surface a compact summary of batch failures at the top of the log —
  // easier to grep in Vercel than scrolling through per-attempt errors.
  if (batchFailures.length > 0) {
    console.error(`[airdrop] ${batchFailures.length} batch(es) failed after retries:`,
      JSON.stringify(batchFailures.slice(0, 5)));
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
    // Failed batches — leave the DB row untouched so pending_lamports
    // stays intact and the next airdrop tick retries with the same
    // accumulated balance. Small tradeoff: this round's accrual
    // increment doesn't get folded into total_accrued_lamports (stat
    // undercount), which is acceptable — the SOL is still in the
    // rewards wallet and will be paid on a successful retry.
    if (!paidWallets.has(p.wallet)) continue;
    const priorRow = pendingRows?.find(r => r.wallet === p.wallet);
    const priorTotalAccrued = priorRow ? Number((priorRow as { total_accrued_lamports?: number }).total_accrued_lamports || 0) : 0;
    const priorTotalPaid = priorRow ? Number((priorRow as { total_paid_lamports?: number }).total_paid_lamports || 0) : 0;
    const priorPayoutCount = priorRow ? Number((priorRow as { payout_count?: number }).payout_count || 0) : 0;
    upserts.push({
      wallet: p.wallet,
      // Pre-prorate: 0 (fully paid). Post-prorate: the un-paid remainder
      // that carries forward to next round. Same code path, different
      // value depending on whether prorate scaled this payout down.
      pending_lamports: p.prorateRemainder,
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
  const auth = authorizeCron(request);
  if (!auth.ok) return auth.response;

  const force = new URL(request.url).searchParams.get('force') === '1';

  try {
    const result = await runAirdrop(force);
    return NextResponse.json(result);
  } catch (e) {
    console.error('Airdrop cron error:', e);
    return NextResponse.json(
      { status: 'error', message: 'Internal server error' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  // Same as GET — included for symmetry with manual cron triggers
  return GET(request);
}
