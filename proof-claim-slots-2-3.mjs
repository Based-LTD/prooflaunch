#!/usr/bin/env node
// proof-claim-slots-2-3.mjs — one-off manual claim payout for PROOF slots 2 & 3.
//
// Why: backers in Africa can't reach prooflaunch.fun (carrier-level network
// block, not our bug). Their fee credits sit in escrow with claimable_fees_sol
// set in DB. This script sends both their owed SOL directly + updates DB so
// the system stays consistent.
//
// Single tx for both transfers — atomic (either both succeed or both fail).
//
// Dry-run by default, --execute to broadcast.

import { readFileSync } from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const {
  Connection, PublicKey, Keypair, Transaction, SystemProgram, ComputeBudgetProgram,
} = require('@solana/web3.js');
const { createClient } = require('@supabase/supabase-js');
const bs58Mod = require('bs58');
const bs58 = bs58Mod.default || bs58Mod;

const EXECUTE = process.argv.includes('--execute');
const PROOF_MINT = 'oaBXM2rCnWFeQc9ufdTSSpASwSrMBPrSmg8xtiepooL';
const SLOT_2_WALLET = '88tFn44cCLvSgvcKnHDHckC8ExyjLXviDvghx45d2unu';
const SLOT_3_WALLET = 'GcqU3n56FMvkfy3uQtem7THPvBHpr2W3fGEsh9PCqab5';

const env = Object.fromEntries(
  readFileSync(new URL('./.env.local', import.meta.url), 'utf-8')
    .split('\n').filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const conn = new Connection(env.NEXT_PUBLIC_SOLANA_RPC_URL, 'confirmed');
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const escrow = Keypair.fromSecretKey(bs58.decode(env.ESCROW_WALLET_PRIVATE_KEY));

console.log('═══════════════════════════════════════════════════════════');
console.log('PROOF SLOTS 2 & 3 — MANUAL CLAIM PAYOUT');
console.log(`MODE: ${EXECUTE ? '🔴 EXECUTE — tx will broadcast' : '🟢 DRY RUN — no broadcast'}`);
console.log('═══════════════════════════════════════════════════════════\n');

// ── Pre-flight: read DB state + escrow balance ─────────────────────────
const { data: meme } = await sb.from('memes').select('id').eq('mint_address', PROOF_MINT).single();
const { data: backings } = await sb.from('backings')
  .select('id, slot_number, backer_wallet, claimable_fees_sol, total_claimed_sol')
  .eq('meme_id', meme.id)
  .in('backer_wallet', [SLOT_2_WALLET, SLOT_3_WALLET]);

const slot2 = backings.find(b => b.backer_wallet === SLOT_2_WALLET);
const slot3 = backings.find(b => b.backer_wallet === SLOT_3_WALLET);
if (!slot2 || !slot3) { console.error('✗ backing rows not found'); process.exit(1); }

const slot2ClaimableSol = Number(slot2.claimable_fees_sol);
const slot3ClaimableSol = Number(slot3.claimable_fees_sol);
const slot2Lam = Math.floor(slot2ClaimableSol * 1e9);
const slot3Lam = Math.floor(slot3ClaimableSol * 1e9);
const totalLam = slot2Lam + slot3Lam;

const escrowBalance = await conn.getBalance(escrow.publicKey, 'confirmed');

console.log('DB STATE:');
console.log(`  Slot 2 (${SLOT_2_WALLET})`);
console.log(`    claimable: ${slot2ClaimableSol.toFixed(6)} SOL  ·  already claimed: ${Number(slot2.total_claimed_sol).toFixed(6)} SOL`);
console.log(`  Slot 3 (${SLOT_3_WALLET})`);
console.log(`    claimable: ${slot3ClaimableSol.toFixed(6)} SOL  ·  already claimed: ${Number(slot3.total_claimed_sol).toFixed(6)} SOL`);
console.log();
console.log('ON-CHAIN:');
console.log(`  Escrow balance: ${(escrowBalance / 1e9).toFixed(6)} SOL`);
console.log(`  Required:       ${(totalLam / 1e9).toFixed(6)} SOL`);
console.log(`  After payout:   ${((escrowBalance - totalLam) / 1e9).toFixed(6)} SOL`);
console.log();

// ── Safety gates ────────────────────────────────────────────────────────
if (slot2ClaimableSol <= 0 || slot3ClaimableSol <= 0) {
  console.error('✗ One of the wallets has 0 claimable. Did this already run? Bailing.');
  process.exit(1);
}
if (escrowBalance < totalLam + 5000) {
  console.error('✗ Escrow has insufficient balance for payout + gas. Bailing.');
  process.exit(1);
}

console.log('PAYOUT PLAN (single atomic tx, both transfers or neither):');
console.log(`  → ${SLOT_2_WALLET}  +${slot2ClaimableSol.toFixed(6)} SOL`);
console.log(`  → ${SLOT_3_WALLET}  +${slot3ClaimableSol.toFixed(6)} SOL`);
console.log();

if (!EXECUTE) {
  console.log('🟢 DRY RUN complete. Re-run with --execute to broadcast.');
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────────────────
// EXECUTE
// ─────────────────────────────────────────────────────────────────────────
console.log('🔴 EXECUTING…\n');

const tx = new Transaction()
  .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }))
  .add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }))
  .add(SystemProgram.transfer({
    fromPubkey: escrow.publicKey,
    toPubkey: new PublicKey(SLOT_2_WALLET),
    lamports: slot2Lam,
  }))
  .add(SystemProgram.transfer({
    fromPubkey: escrow.publicKey,
    toPubkey: new PublicKey(SLOT_3_WALLET),
    lamports: slot3Lam,
  }));
tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
tx.feePayer = escrow.publicKey;

const sig = await conn.sendTransaction(tx, [escrow]);
console.log(`  tx: ${sig}`);
console.log(`  confirming…`);
await conn.confirmTransaction(sig, 'confirmed');
console.log(`  ✓ confirmed\n`);

// ── DB updates ──────────────────────────────────────────────────────────
console.log('Updating DB…');

// Slot 2: zero claimable, bump claimed
const slot2NewClaimed = Number(slot2.total_claimed_sol || 0) + slot2ClaimableSol;
const { error: e2 } = await sb.from('backings')
  .update({ claimable_fees_sol: 0, total_claimed_sol: slot2NewClaimed })
  .eq('id', slot2.id);
if (e2) console.error('  ✗ slot 2 update failed:', e2);
else console.log(`  ✓ slot 2 claimable→0, total_claimed += ${slot2ClaimableSol.toFixed(6)} (new total ${slot2NewClaimed.toFixed(6)})`);

// Slot 3: zero claimable, bump claimed
const slot3NewClaimed = Number(slot3.total_claimed_sol || 0) + slot3ClaimableSol;
const { error: e3 } = await sb.from('backings')
  .update({ claimable_fees_sol: 0, total_claimed_sol: slot3NewClaimed })
  .eq('id', slot3.id);
if (e3) console.error('  ✗ slot 3 update failed:', e3);
else console.log(`  ✓ slot 3 claimable→0, total_claimed += ${slot3ClaimableSol.toFixed(6)} (new total ${slot3NewClaimed.toFixed(6)})`);

// Audit rows
for (const [wallet, amt, slot] of [[SLOT_2_WALLET, slot2ClaimableSol, 2], [SLOT_3_WALLET, slot3ClaimableSol, 3]]) {
  const { error } = await sb.from('fee_claims').insert({
    meme_id: meme.id,
    wallet_address: wallet,
    amount_sol: amt,
    claim_tx: sig,
    status: 'completed',
    completed_at: new Date().toISOString(),
  });
  if (error) console.error(`  ✗ fee_claims insert slot ${slot}:`, error);
  else console.log(`  ✓ fee_claims audit row inserted for slot ${slot}`);
}

console.log('\n═══════════════════════════════════════════════════════════');
console.log('✓ DONE');
console.log(`  tx: https://solscan.io/tx/${sig}`);
console.log(`  Slot 2 paid: ${slot2ClaimableSol.toFixed(6)} SOL`);
console.log(`  Slot 3 paid: ${slot3ClaimableSol.toFixed(6)} SOL`);
console.log(`  Total: ${(totalLam / 1e9).toFixed(6)} SOL`);
console.log('═══════════════════════════════════════════════════════════');
