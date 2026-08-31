#!/usr/bin/env node
// airdrop-snapshot.mjs — Daily PROOF holder airdrop pipeline.
//
// Snapshots all PROOF holders, filters exclusion list, layers Streamflow-locked
// balances, computes pro-rata SOL distribution from HOLDER_REWARDS_WALLET, and
// either previews (dry-run) or broadcasts the payouts.
//
// Modes:
//   node tools/airdrop-snapshot.mjs                  → dry run, prints preview
//   node tools/airdrop-snapshot.mjs --execute        → broadcasts payouts
//   node tools/airdrop-snapshot.mjs --pool=0.5       → override pool size for testing
//
// Money path. Read carefully before --execute.

import { readFileSync } from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const {
  Connection, PublicKey, Keypair, Transaction, SystemProgram, ComputeBudgetProgram,
} = require('@solana/web3.js');
const { createClient } = require('@supabase/supabase-js');
const bs58Mod = require('bs58');
const bs58 = bs58Mod.default || bs58Mod;
const { SolanaStreamClient, ICluster } = require('@streamflow/stream');

// ── config ─────────────────────────────────────────────────────────────
const EXECUTE = process.argv.includes('--execute');
const POOL_OVERRIDE = process.argv.find(a => a.startsWith('--pool='))?.split('=')[1];

const PROOF_MINT = 'oaBXM2rCnWFeQc9ufdTSSpASwSrMBPrSmg8xtiepooL';
const MIN_PAYOUT_LAMPORTS = 1_000_000; // 0.001 SOL dust floor
const PAYOUTS_PER_TX = 18;             // SystemProgram transfers per tx
const PROOF_DECIMALS = 6;

// Wallets EXCLUDED from airdrop (DEX pools, platform wallets, burn addresses,
// founder-controlled wallets including locked-supply destinations and Streamflow senders)
const EXCLUDED_WALLETS = new Set([
  '8xLcPgxcMtYNPq2bw931hVuSYSXPCc6jRczDu64Bgm16', // PumpSwap AMM pool for PROOF
  '83u1MraLPeq3ZqGo4GKqeg5FLk6YpSR7H7GcgZc2s9Ko', // platform escrow / on-chain creator
  'CZnvVTTutAF7QTh5reQqRHE5i8J9cm1CWwaiQXi3QaXm', // PLATFORM_WALLET / slot 4
  '8wDY912FsVPxuiZhifXeMQbNt6BvLet1AV8bh74FJnvw', // founder's locked-supply wallet (Streamflow recipient)
  'EsA8NH8588FFdhUzvxPUn9bPzr8rZi9nPz5E136bLAir', // founder slot 1 wallet (Streamflow sender — locks count to recipient not sender)
  'ELFjjx7Ax5kaWnmNCJqwwPirYj5Mne4Gphy5MLzgX5SE', // PROOF Buyback wallet (Streamflow sender of locked buyback PROOF) — platform wallet, must not receive holder rewards. Missed in May 2026 rotation; was taking the largest airdrop slice until 2026-08-30.
  'DRwYbZuhD8VLvgU18TKx4jm8rZaoUudoMQQzuziGqnrx', // current platform escrow (post 2026-07-25 rotation) — defensive; old escrow is excluded above, new one must be too
  '6y87wcKcjGM2bSqXFtuqKTfEmkmQHkHu75hSGu3uAj1Z', // pre-rotation buyback wallet — defensive (dead, 0 SOL)
  '11111111111111111111111111111111',              // burn / system
  // BC PDA computed dynamically below
]);

// ── env ────────────────────────────────────────────────────────────────
const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf-8')
    .split('\n').filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const RPC = env.NEXT_PUBLIC_SOLANA_RPC_URL;
const conn = new Connection(RPC, 'confirmed');
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

if (!env.HOLDER_REWARDS_WALLET_PRIVATE_KEY) {
  console.error('✗ HOLDER_REWARDS_WALLET_PRIVATE_KEY not in .env.local');
  process.exit(1);
}
const rewardsKp = Keypair.fromSecretKey(bs58.decode(env.HOLDER_REWARDS_WALLET_PRIVATE_KEY));
if (rewardsKp.publicKey.toBase58() !== env.HOLDER_REWARDS_WALLET_ADDRESS) {
  console.error('✗ HOLDER_REWARDS_WALLET keypair/pubkey mismatch in .env.local');
  process.exit(1);
}

// Also exclude the rewards wallet itself + bonding curve PDA
EXCLUDED_WALLETS.add(rewardsKp.publicKey.toBase58());
const PUMP_BC = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const [BC_PDA] = PublicKey.findProgramAddressSync(
  [Buffer.from('bonding-curve'), new PublicKey(PROOF_MINT).toBuffer()],
  PUMP_BC,
);
EXCLUDED_WALLETS.add(BC_PDA.toBase58());

console.log('═══════════════════════════════════════════════════════════');
console.log('PROOF HOLDER AIRDROP — DAILY DISTRIBUTION');
console.log(`MODE: ${EXECUTE ? '🔴 EXECUTE — txs will broadcast' : '🟢 DRY RUN — no broadcast'}`);
console.log(`Rewards wallet: ${rewardsKp.publicKey.toBase58()}`);
console.log('═══════════════════════════════════════════════════════════\n');

// ── 1. Pool size ────────────────────────────────────────────────────────
let poolLamports;
if (POOL_OVERRIDE) {
  poolLamports = Math.floor(parseFloat(POOL_OVERRIDE) * 1e9);
  console.log(`Pool size: ${(poolLamports / 1e9).toFixed(6)} SOL (OVERRIDE)`);
} else {
  poolLamports = await conn.getBalance(rewardsKp.publicKey, 'confirmed');
  console.log(`Pool size: ${(poolLamports / 1e9).toFixed(6)} SOL (live wallet balance)`);
}
// Reserve ~0.001 SOL for gas + rent
const RESERVE_LAMPORTS = 1_000_000;
const distributableLamports = Math.max(0, poolLamports - RESERVE_LAMPORTS);
console.log(`Distributable (after gas reserve): ${(distributableLamports / 1e9).toFixed(6)} SOL\n`);

if (distributableLamports < MIN_PAYOUT_LAMPORTS) {
  console.log('⚠ Pool below dust floor. Nothing to distribute.');
  process.exit(0);
}

// ── 2. Snapshot all PROOF holders ──────────────────────────────────────
console.log('Snapshotting on-chain holders…');
const TOKEN_2022 = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const SPL = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

const holders = new Map(); // wallet → raw token amount (BigInt)
for (const prog of [TOKEN_2022, SPL]) {
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
    console.error(`  ✗ getProgramAccounts ${prog.toBase58().slice(0,12)}…: ${e.message}`);
  }
}
console.log(`  Found ${holders.size} unique wallets with non-zero PROOF`);

// ── 3. Filter exclusion list ──────────────────────────────────────────
const excludedFound = [];
for (const ex of EXCLUDED_WALLETS) {
  if (holders.has(ex)) {
    excludedFound.push({ wallet: ex, balance: holders.get(ex) });
    holders.delete(ex);
  }
}
console.log(`  Excluded ${excludedFound.length} wallets (DEX/platform/burn):`);
for (const e of excludedFound) console.log(`    ${e.wallet}  ${(Number(e.balance) / 10 ** PROOF_DECIMALS / 1e6).toFixed(2)}M PROOF`);
console.log(`  Remaining eligible wallets: ${holders.size}`);

// ── 4. Layer Streamflow-locked balances (same pattern as Genesis Roster) ─
console.log('\nChecking Streamflow locks for each holder…');
const streamClient = new SolanaStreamClient(RPC, ICluster.Mainnet, 'confirmed');
const walletList = [...holders.keys()];
const CHUNK = 25;
let lockedCount = 0;
for (let i = 0; i < walletList.length; i += CHUNK) {
  const chunk = walletList.slice(i, i + CHUNK);
  await Promise.all(chunk.map(async (wallet) => {
    try {
      const streams = await streamClient.searchStreams({ mint: PROOF_MINT, sender: wallet });
      if (!streams || streams.length === 0) return;
      const balances = await Promise.all(streams.map(async (s) => {
        try {
          const raw = (s.account)?.escrowTokens;
          if (!raw) return BigInt(0);
          const pk = typeof raw === 'string'
            ? new PublicKey(raw)
            : new PublicKey(raw.toBase58 ? raw.toBase58() : raw);
          const info = await conn.getAccountInfo(pk);
          if (!info) return BigInt(0);
          return info.data.readBigUInt64LE(64);
        } catch { return BigInt(0); }
      }));
      const totalLocked = balances.reduce((s, x) => s + x, BigInt(0));
      if (totalLocked > BigInt(0)) {
        holders.set(wallet, (holders.get(wallet) || BigInt(0)) + totalLocked);
        lockedCount++;
      }
    } catch { /* ignore — no streams for this wallet */ }
  }));
  process.stderr.write(`  scanned ${Math.min(i + CHUNK, walletList.length)}/${walletList.length}\r`);
}
process.stderr.write('\n');
console.log(`  ${lockedCount} wallets had Streamflow-locked PROOF (added to eligible balance)`);

// ── 5. Compute pro-rata distribution with CARRY-FORWARD ─────────────────
const eligibleSupply = [...holders.values()].reduce((s, x) => s + x, BigInt(0));
console.log(`\nEligible supply: ${(Number(eligibleSupply) / 10 ** PROOF_DECIMALS / 1e6).toFixed(2)}M PROOF`);

// Load prior pending balances for all eligible wallets
const walletAddresses = [...holders.keys()];
const { data: pendingRows } = await sb
  .from('holder_pending_balances')
  .select('wallet, pending_lamports, total_accrued_lamports, total_paid_lamports, payout_count')
  .in('wallet', walletAddresses);
const priorPending = new Map();
const priorMeta = new Map();
for (const r of pendingRows || []) {
  priorPending.set(r.wallet, Number(r.pending_lamports));
  priorMeta.set(r.wallet, {
    total_accrued: Number(r.total_accrued_lamports || 0),
    total_paid: Number(r.total_paid_lamports || 0),
    payout_count: Number(r.payout_count || 0),
  });
}

const payouts = [];
const carryForwards = [];
for (const [wallet, balance] of holders) {
  const thisRound = Number((balance * BigInt(distributableLamports)) / eligibleSupply);
  if (thisRound === 0) continue;
  const accumulated = (priorPending.get(wallet) || 0) + thisRound;
  if (accumulated >= MIN_PAYOUT_LAMPORTS) {
    payouts.push({ wallet, balance, shareLamports: accumulated, accruedThisRound: thisRound });
  } else {
    carryForwards.push({ wallet, newPending: accumulated, accruedThisRound: thisRound });
  }
}

const totalPayoutLamports = payouts.reduce((s, p) => s + p.shareLamports, 0);
const totalCarryForwardLamports = carryForwards.reduce((s, c) => s + c.accruedThisRound, 0);
console.log(`\nPayouts qualifying (≥${MIN_PAYOUT_LAMPORTS / 1e9} SOL, after carry-forward): ${payouts.length}`);
console.log(`Carry-forward (accumulating in DB, will pay when balance crosses floor): ${carryForwards.length}`);
console.log(`Total payout SOL: ${(totalPayoutLamports / 1e9).toFixed(6)} SOL`);
console.log(`Total accruing (carry-forward): ${(totalCarryForwardLamports / 1e9).toFixed(6)} SOL`);
console.log(`Residual (truly tiny rounding only): ${((distributableLamports - totalPayoutLamports - totalCarryForwardLamports) / 1e9).toFixed(6)} SOL`);

// ── 6. Preview top payouts ────────────────────────────────────────────
payouts.sort((a, b) => b.shareLamports - a.shareLamports);
console.log('\n═══ TOP 15 PAYOUTS ═══');
console.log('rank  wallet                                          PROOF held       SOL payout');
for (let i = 0; i < Math.min(15, payouts.length); i++) {
  const p = payouts[i];
  const proofUi = Number(p.balance) / 10 ** PROOF_DECIMALS;
  console.log(
    `${String(i + 1).padStart(3)}   ${p.wallet}  ${proofUi.toFixed(2).padStart(15)}  ${(p.shareLamports / 1e9).toFixed(6).padStart(12)}`
  );
}

if (!EXECUTE) {
  console.log('\n🟢 DRY RUN complete. Nothing was broadcast.');
  console.log(`   To execute: node tools/airdrop-snapshot.mjs --execute`);
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────────────────
// EXECUTE PATH
// ─────────────────────────────────────────────────────────────────────────
const today = new Date().toISOString().slice(0, 10);
console.log(`\n🔴 EXECUTING airdrop for epoch ${today}…`);

// 1. Insert distribution row (idempotency gate — UNIQUE on epoch_date)
const { data: distRow, error: distErr } = await sb.from('holder_distributions').insert({
  distributed_at: new Date().toISOString(),
  epoch_date: today,
  total_sol_lamports: totalPayoutLamports,
  holder_count: payouts.length,
  eligible_supply_tokens: Number(eligibleSupply) / 10 ** PROOF_DECIMALS,
  status: 'in_progress',
}).select().single();
if (distErr) {
  if (distErr.code === '23505') {
    console.error(`✗ Already distributed for ${today} (epoch_date unique violation). Exiting safely.`);
    process.exit(1);
  }
  console.error('✗ Failed to create distribution row:', distErr);
  process.exit(1);
}
console.log(`  distribution_id: ${distRow.id}`);

// 2. Insert pending payout rows
const payoutRows = payouts.map(p => ({
  distribution_id: distRow.id,
  wallet: p.wallet,
  proof_balance: Number(p.balance) / 10 ** PROOF_DECIMALS,
  share_lamports: p.shareLamports,
  status: 'pending',
}));
const { error: insertErr } = await sb.from('holder_distribution_payouts').insert(payoutRows);
if (insertErr) {
  console.error('✗ Failed to insert payout rows:', insertErr);
  await sb.from('holder_distributions').update({ status: 'failed' }).eq('id', distRow.id);
  process.exit(1);
}
console.log(`  ${payoutRows.length} payout rows queued`);

// 3. Broadcast batched transfers
const batches = [];
for (let i = 0; i < payouts.length; i += PAYOUTS_PER_TX) {
  batches.push(payouts.slice(i, i + PAYOUTS_PER_TX));
}
console.log(`  Broadcasting ${batches.length} batches of ≤${PAYOUTS_PER_TX} transfers…`);

let successCount = 0, failCount = 0;
for (let b = 0; b < batches.length; b++) {
  const batch = batches[b];
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
    // Update payout rows
    const ids = batch.map(p => p.wallet);
    await sb.from('holder_distribution_payouts')
      .update({ status: 'sent', tx_sig: sig })
      .eq('distribution_id', distRow.id)
      .in('wallet', ids);
    successCount += batch.length;
    console.log(`  ✓ batch ${b + 1}/${batches.length} (${batch.length} payouts) sig=${sig.slice(0, 16)}…`);
  } catch (e) {
    console.error(`  ✗ batch ${b + 1} failed: ${e.message}`);
    failCount += batch.length;
  }
}

// 4. Carry-forward DB writes: reset pending for payouts, accumulate for carry-forwards
const pendingNow = new Date().toISOString();
const upserts = [];
for (const p of payouts) {
  const meta = priorMeta.get(p.wallet) || { total_accrued: 0, total_paid: 0, payout_count: 0 };
  upserts.push({
    wallet: p.wallet,
    pending_lamports: 0,
    last_updated: pendingNow,
    total_accrued_lamports: meta.total_accrued + p.accruedThisRound,
    total_paid_lamports: meta.total_paid + p.shareLamports,
    payout_count: meta.payout_count + 1,
  });
}
for (const c of carryForwards) {
  const meta = priorMeta.get(c.wallet) || { total_accrued: 0, total_paid: 0, payout_count: 0 };
  upserts.push({
    wallet: c.wallet,
    pending_lamports: c.newPending,
    last_updated: pendingNow,
    total_accrued_lamports: meta.total_accrued + c.accruedThisRound,
    total_paid_lamports: meta.total_paid,
    payout_count: meta.payout_count,
  });
}
if (upserts.length > 0) {
  const { error } = await sb.from('holder_pending_balances').upsert(upserts, { onConflict: 'wallet' });
  if (error) console.error(`  ⚠ pending balances upsert failed: ${error.message}`);
  else console.log(`  ✓ pending balances updated (${payouts.length} reset, ${carryForwards.length} accumulated)`);
}

// 5. Finalize
await sb.from('holder_distributions')
  .update({ status: failCount === 0 ? 'completed' : 'partial' })
  .eq('id', distRow.id);

console.log('\n═══════════════════════════════════════════════════════════');
console.log(`✓ DONE — ${successCount} sent, ${failCount} failed`);
console.log(`  Distribution: ${distRow.id}`);
console.log(`  Paid out: ${(totalPayoutLamports / 1e9).toFixed(6)} SOL across ${payouts.length} wallets`);
console.log(`  Carrying forward: ${(totalCarryForwardLamports / 1e9).toFixed(6)} SOL across ${carryForwards.length} wallets (will pay when each crosses floor)`);
console.log('═══════════════════════════════════════════════════════════');
