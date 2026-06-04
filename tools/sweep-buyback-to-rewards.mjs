#!/usr/bin/env node
//
// One-off: sweep accumulated SOL from the BUYBACK wallet (PROOF coin
// creator on pump.fun) over to the HOLDER_REWARDS wallet so the next
// daily airdrop run can fan it out to PROOF holders pro-rata.
//
// Operationally we don't want creator-fee accumulations to sit idle in
// the BUYBACK wallet — sweeping onward to the airdrop source means SOL
// gets distributed quickly and never lingers in any one wallet for long.
//
// Leaves a tiny reserve in BUYBACK for future tx fees (next pump.fun fee
// claim, etc) — don't drain to zero or future operations brick.
//
// Read-only safety pass first: prints what it WOULD do, requires
// --execute flag to actually send.
//
// Usage:
//   node tools/sweep-buyback-to-rewards.mjs            # dry-run, prints plan
//   node tools/sweep-buyback-to-rewards.mjs --execute  # actually sends

import {
  Connection, Keypair, PublicKey, SystemProgram,
  Transaction, LAMPORTS_PER_SOL, sendAndConfirmTransaction, ComputeBudgetProgram,
} from '@solana/web3.js';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import bs58 from 'bs58';

// Leave this much in the source wallet so it can still pay tx fees / rent
// for future pump.fun fee claims and incidental ops. 0.01 SOL is enough
// for ~50-100 future txs.
const RESERVE_LAMPORTS = 10_000_000; // 0.01 SOL

// Priority fee — a little extra so the sweep tx lands quickly. We're not
// in a race (no foul play detected) but landing fast still matters.
const PRIORITY_FEE_MICROLAMPORTS = 50_000;

const HOLDER_REWARDS_DEST = 'BAJH4C9TRPqVBGmc56m5bTgmed5U8wm9cf9HmQdyMmat';

// ── Env loading ────────────────────────────────────────────────────
function loadEnv() {
  const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
  const out = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}
const env = loadEnv();
const rpc = env.NEXT_PUBLIC_SOLANA_RPC_URL;
if (!rpc) { console.error('Missing NEXT_PUBLIC_SOLANA_RPC_URL'); process.exit(1); }
if (!env.PROOF_BUYBACK_WALLET_PRIVATE_KEY) { console.error('Missing PROOF_BUYBACK_WALLET_PRIVATE_KEY'); process.exit(1); }

const conn = new Connection(rpc, 'confirmed');
const sourceKp = Keypair.fromSecretKey(bs58.decode(env.PROOF_BUYBACK_WALLET_PRIVATE_KEY));
const destPk = new PublicKey(HOLDER_REWARDS_DEST);

// ── Plan ───────────────────────────────────────────────────────────
const balLamports = await conn.getBalance(sourceKp.publicKey);
const balSol = balLamports / LAMPORTS_PER_SOL;
const sweepLamports = Math.max(0, balLamports - RESERVE_LAMPORTS);
const sweepSol = sweepLamports / LAMPORTS_PER_SOL;

console.log('=== Sweep plan ===');
console.log(`source:        ${sourceKp.publicKey.toBase58()} (BUYBACK)`);
console.log(`destination:   ${destPk.toBase58()} (HOLDER_REWARDS)`);
console.log(`source balance: ${balSol.toFixed(6)} SOL`);
console.log(`reserve kept:   ${(RESERVE_LAMPORTS / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
console.log(`amount to send: ${sweepSol.toFixed(6)} SOL`);

if (sweepLamports <= 0) {
  console.log('\nNothing to sweep above the reserve. Exiting.');
  process.exit(0);
}

const execute = process.argv.includes('--execute');
if (!execute) {
  console.log('\n(dry-run — re-run with --execute to actually send)');
  process.exit(0);
}

// ── Send ──────────────────────────────────────────────────────────
console.log('\nBuilding tx…');
const tx = new Transaction();
// Priority fee bump
tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_FEE_MICROLAMPORTS }));
tx.add(SystemProgram.transfer({
  fromPubkey: sourceKp.publicKey,
  toPubkey: destPk,
  lamports: sweepLamports,
}));

const sig = await sendAndConfirmTransaction(conn, tx, [sourceKp], {
  commitment: 'confirmed',
  maxRetries: 5,
});
console.log(`\n✅ Sent: ${sig}`);
console.log(`   https://solscan.io/tx/${sig}`);

// Confirm new balances
const newSrcBal = await conn.getBalance(sourceKp.publicKey);
const newDestBal = await conn.getBalance(destPk);
console.log(`\nPost-tx balances:`);
console.log(`  source:      ${(newSrcBal / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
console.log(`  destination: ${(newDestBal / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
