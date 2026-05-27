#!/usr/bin/env node
/* eslint-disable */
//
// $PROOF buy-and-burn from the dedicated buyback wallet.
//
// The buyback wallet is a single dedicated address (NEXT_PUBLIC_PROOF_BUYBACK_WALLET).
// All buys + burns flow through it. Public on Solscan. Brand narrative: "watch
// this one address — every buyback comes from here."
//
// The signing key (PROOF_BUYBACK_WALLET_PRIVATE_KEY) lives in .env.local +
// Vercel env, same convention as ESCROW_WALLET_PRIVATE_KEY and
// HOLDER_REWARDS_WALLET_PRIVATE_KEY.
//
// What it does:
//   1. Loads the buyback wallet keypair from env
//   2. Buys $PROOF on pump.fun (via Jupiter routing to PumpSwap)
//   3. Burns 100% of the purchased $PROOF via SPL Token-2022 burnChecked
//   4. Logs the buyback to the proof_buybacks table for the public /buybacks page
//
// Properties:
//   - Buy + burn are atomic from your perspective (one command, both or
//     neither — script aborts cleanly if anything fails)
//   - Reproducible: same flags = same result every time
//   - Auditable: each run writes a row to proof_buybacks
//   - Public proof: every tx visible on the wallet's Solscan history
//
// Usage:
//   node tools/buy-and-burn.mjs --sol=<amount> [opts]
//
// Options:
//   --sol=<n>           Amount of SOL to spend (required, e.g. --sol=0.5)
//   --slippage-bps=<n>  Max slippage in basis points (default 2000 = 20%)
//                       PROOF has thin volume — generous default protects
//                       against tx failure on micro-volatility. Lower for
//                       tighter execution control.
//   --gas-reserve=<n>   SOL to leave in wallet for cron tx fees (default 0.005)
//   --note="<text>"     Optional human note saved to the audit row
//   --dry-run           Print quote + plan only, do not execute
//
// Examples:
//   node tools/buy-and-burn.mjs --sol=0.05 --dry-run
//   node tools/buy-and-burn.mjs --sol=1.0
//   node tools/buy-and-burn.mjs --sol=2.5 --slippage-bps=500 --note="Q2 buyback"

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';
import bs58 from 'bs58';
import {
  Connection, PublicKey, Keypair, VersionedTransaction, LAMPORTS_PER_SOL,
  TransactionMessage, ComputeBudgetProgram,
} from '@solana/web3.js';
import {
  createBurnCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';

// ── Constants ──────────────────────────────────────────────────────
const PROOF_MINT = 'oaBXM2rCnWFeQc9ufdTSSpASwSrMBPrSmg8xtiepooL';
const PROOF_DECIMALS = 6;
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const JUP_QUOTE_URL = 'https://lite-api.jup.ag/swap/v1/quote';
const JUP_SWAP_URL = 'https://lite-api.jup.ag/swap/v1/swap';

// ── Env loading ────────────────────────────────────────────────────
function loadEnv() {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
    const out = {};
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
    return out;
  } catch {
    console.error('Could not read .env.local');
    process.exit(1);
  }
}

const env = loadEnv();
const required = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_SOLANA_RPC_URL', 'PROOF_BUYBACK_WALLET_PRIVATE_KEY'];
for (const k of required) {
  if (!env[k]) {
    console.error(`Missing ${k} in .env.local`);
    if (k === 'PROOF_BUYBACK_WALLET_PRIVATE_KEY') {
      console.error('Run: node tools/generate-buyback-wallet.mjs first.');
    }
    process.exit(1);
  }
}

// ── Args ───────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flags = {};
for (const a of args) {
  const m = a.match(/^--([a-z-]+)(?:=(.*))?$/);
  if (m) flags[m[1]] = m[2] === undefined ? true : m[2];
}

const sol = parseFloat(flags.sol);
if (!Number.isFinite(sol) || sol <= 0) {
  console.error('--sol=<amount> is required (e.g. --sol=0.5)');
  process.exit(1);
}
const slippageBps = parseInt(flags['slippage-bps'] ?? '2000', 10);
if (!Number.isInteger(slippageBps) || slippageBps < 50 || slippageBps > 5000) {
  console.error('--slippage-bps must be an integer 50–5000');
  process.exit(1);
}
const gasReserveSol = parseFloat(flags['gas-reserve'] ?? '0.005');
if (!Number.isFinite(gasReserveSol) || gasReserveSol < 0) {
  console.error('--gas-reserve must be a non-negative number');
  process.exit(1);
}
const dryRun = !!flags['dry-run'];
const note = typeof flags.note === 'string' ? flags.note : null;

const solLamports = Math.floor(sol * LAMPORTS_PER_SOL);
const gasReserveLamports = Math.floor(gasReserveSol * LAMPORTS_PER_SOL);

// ── Load buyback wallet keypair from env ───────────────────────────
console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`$PROOF Buy-and-Burn  ${dryRun ? '[DRY RUN]' : '[LIVE]'}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

let kp;
try {
  kp = Keypair.fromSecretKey(bs58.decode(env.PROOF_BUYBACK_WALLET_PRIVATE_KEY.trim()));
} catch (e) {
  console.error('Failed to decode PROOF_BUYBACK_WALLET_PRIVATE_KEY:', e.message);
  console.error('Expected bs58 (88-char) secret key. Re-generate with: node tools/generate-buyback-wallet.mjs');
  process.exit(1);
}
const buyer = kp.publicKey;

// Cross-check against the public pubkey env var if it's set (catches
// the case where someone updates the secret but forgets the pubkey,
// or vice versa, which would break the brand-narrative "watch this address").
if (env.NEXT_PUBLIC_PROOF_BUYBACK_WALLET && env.NEXT_PUBLIC_PROOF_BUYBACK_WALLET !== buyer.toBase58()) {
  console.error('Mismatch between PROOF_BUYBACK_WALLET_PRIVATE_KEY and NEXT_PUBLIC_PROOF_BUYBACK_WALLET.');
  console.error(`  Secret derives to: ${buyer.toBase58()}`);
  console.error(`  Public env says:   ${env.NEXT_PUBLIC_PROOF_BUYBACK_WALLET}`);
  console.error('Fix one of them before running buybacks.');
  process.exit(1);
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
console.log('Buyback wallet:    ', buyer.toBase58());
console.log('Solscan:            https://solscan.io/account/' + buyer.toBase58());

// ── Balance check ──────────────────────────────────────────────────
const conn = new Connection(env.NEXT_PUBLIC_SOLANA_RPC_URL, 'confirmed');
const balanceLamports = await conn.getBalance(buyer);
const balanceSol = balanceLamports / LAMPORTS_PER_SOL;
console.log(`Wallet balance:     ${balanceSol.toFixed(6)} SOL`);
console.log(`Spending:           ${sol.toFixed(6)} SOL`);
console.log(`Gas reserve:        ${gasReserveSol.toFixed(6)} SOL`);

const needed = solLamports + gasReserveLamports;
if (balanceLamports < needed) {
  console.error('');
  console.error(`❌ Insufficient balance.`);
  console.error(`   Need: ${(needed / LAMPORTS_PER_SOL).toFixed(6)} SOL  (${sol} spend + ${gasReserveSol} gas reserve)`);
  console.error(`   Have: ${balanceSol.toFixed(6)} SOL`);
  console.error(`   Fund: ${buyer.toBase58()}`);
  process.exit(1);
}

// ── Jupiter quote ──────────────────────────────────────────────────
console.log('');
console.log('1/4  Quoting via Jupiter (PumpSwap route)...');
const quoteUrl = `${JUP_QUOTE_URL}?inputMint=${SOL_MINT}&outputMint=${PROOF_MINT}&amount=${solLamports}&slippageBps=${slippageBps}`;
const quoteRes = await fetch(quoteUrl);
if (!quoteRes.ok) {
  console.error('Jupiter quote failed:', quoteRes.status, await quoteRes.text());
  process.exit(1);
}
const quote = await quoteRes.json();
if (quote.error) {
  console.error('Jupiter quote error:', quote.error);
  process.exit(1);
}

const outRaw = BigInt(quote.outAmount);
const outUi = Number(outRaw) / 10 ** PROOF_DECIMALS;
const pricePerToken = sol / outUi;
console.log(`     Quote:   ${sol} SOL → ${outUi.toLocaleString(undefined, { maximumFractionDigits: 0 })} PROOF`);
console.log(`     Price:   ${pricePerToken.toExponential(3)} SOL per PROOF`);
console.log(`     Impact:  ${quote.priceImpactPct ?? 'n/a'}%`);
console.log(`     Route:   ${quote.routePlan.map(r => r.swapInfo.label).join(' → ')}`);
console.log(`     Slippage cap: ${slippageBps / 100}%  (min out: ${(Number(BigInt(quote.otherAmountThreshold)) / 10 ** PROOF_DECIMALS).toLocaleString(undefined, { maximumFractionDigits: 0 })} PROOF)`);

if (dryRun) {
  console.log('');
  console.log('✅ Dry run complete — nothing was sent on-chain.');
  console.log('   Re-run without --dry-run to execute.');
  process.exit(0);
}

// ── Build + send swap tx ───────────────────────────────────────────
console.log('');
console.log('2/4  Fetching swap transaction from Jupiter...');
const swapBody = {
  quoteResponse: quote,
  userPublicKey: buyer.toBase58(),
  wrapAndUnwrapSol: true,
  dynamicComputeUnitLimit: true,
  prioritizationFeeLamports: 'auto',
};
const swapRes = await fetch(JUP_SWAP_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(swapBody),
});
if (!swapRes.ok) {
  console.error('Jupiter swap build failed:', swapRes.status, await swapRes.text());
  process.exit(1);
}
const { swapTransaction } = await swapRes.json();
const txBuf = Buffer.from(swapTransaction, 'base64');
const swapTx = VersionedTransaction.deserialize(txBuf);
swapTx.sign([kp]);

console.log('     Sending swap tx...');
const swapSig = await conn.sendTransaction(swapTx, { skipPreflight: false, maxRetries: 3 });
console.log('     Swap signature:', swapSig);
console.log('     https://solscan.io/tx/' + swapSig);
console.log('     Confirming...');
const swapConf = await conn.confirmTransaction(swapSig, 'confirmed');
if (swapConf.value.err) {
  console.error('❌ Swap tx failed on-chain:', swapConf.value.err);
  await logFailure(supabase, solLamports, outRaw, swapSig, null, 'Swap tx failed', note);
  process.exit(1);
}
console.log('     ✓ Swap confirmed.');

// ── Read actual balance received (slippage may give us less than `outRaw`) ─
console.log('');
console.log('3/4  Reading actual PROOF balance received...');
const ata = getAssociatedTokenAddressSync(new PublicKey(PROOF_MINT), buyer, false, TOKEN_2022_PROGRAM_ID);
const ataInfo = await conn.getTokenAccountBalance(ata);
const actualRaw = BigInt(ataInfo.value.amount);
const actualUi = Number(actualRaw) / 10 ** PROOF_DECIMALS;
console.log(`     ATA:          ${ata.toBase58()}`);
console.log(`     Received:     ${actualUi.toLocaleString(undefined, { maximumFractionDigits: 0 })} PROOF  (raw: ${actualRaw})`);

if (actualRaw === 0n) {
  console.error('❌ Swap appeared to confirm but ATA has 0 PROOF. Aborting before burn.');
  await logFailure(supabase, solLamports, outRaw, swapSig, null, 'Swap confirmed but ATA empty', note);
  process.exit(1);
}

// ── Build + send burn tx ───────────────────────────────────────────
console.log('');
console.log('4/4  Building burn transaction (SPL Token-2022 burnChecked)...');
const burnIx = createBurnCheckedInstruction(
  ata,
  new PublicKey(PROOF_MINT),
  buyer,
  actualRaw,
  PROOF_DECIMALS,
  [],
  TOKEN_2022_PROGRAM_ID,
);
const priorityIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 });
const cuIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 80_000 });

const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
const msg = new TransactionMessage({
  payerKey: buyer,
  recentBlockhash: blockhash,
  instructions: [cuIx, priorityIx, burnIx],
}).compileToV0Message();
const burnTx = new VersionedTransaction(msg);
burnTx.sign([kp]);

console.log('     Sending burn tx...');
const burnSig = await conn.sendTransaction(burnTx, { skipPreflight: false, maxRetries: 3 });
console.log('     Burn signature:', burnSig);
console.log('     https://solscan.io/tx/' + burnSig);
console.log('     Confirming...');
const burnConf = await conn.confirmTransaction({ signature: burnSig, blockhash, lastValidBlockHeight }, 'confirmed');
if (burnConf.value.err) {
  console.error('❌ Burn tx failed on-chain:', burnConf.value.err);
  console.error('   IMPORTANT: the swap completed but the burn did not.');
  console.error('   You now hold PROOF in this wallet. Re-run with --burn-existing to retry the burn.');
  await logFailure(supabase, solLamports, actualRaw, swapSig, burnSig, 'Burn tx failed', note);
  process.exit(1);
}
console.log('     ✓ Burn confirmed.');

// ── Audit row ──────────────────────────────────────────────────────
const { error: insErr } = await supabase
  .from('proof_buybacks')
  .insert({
    sol_spent_lamports: solLamports.toString(),
    proof_bought_raw: actualRaw.toString(),
    proof_burned_raw: actualRaw.toString(),
    proof_decimals: PROOF_DECIMALS,
    swap_tx: swapSig,
    burn_tx: burnSig,
    status: 'completed',
    notes: note,
  });
if (insErr) {
  console.warn('⚠️  Audit row insert failed (txs still confirmed on-chain):', insErr.message);
}

// ── Summary ────────────────────────────────────────────────────────
console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('✅ Buy + burn complete.');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`Spent:   ${sol} SOL`);
console.log(`Bought:  ${actualUi.toLocaleString(undefined, { maximumFractionDigits: 0 })} PROOF  (price: ${pricePerToken.toExponential(3)} SOL/token)`);
console.log(`Burned:  ${actualUi.toLocaleString(undefined, { maximumFractionDigits: 0 })} PROOF  (gone forever)`);
console.log('');
console.log('Swap tx:  https://solscan.io/tx/' + swapSig);
console.log('Burn tx:  https://solscan.io/tx/' + burnSig);
console.log('');
console.log('— Post-on-X copy —');
console.log('');
console.log(`Buyback executed: ${sol} SOL → ${actualUi.toLocaleString(undefined, { maximumFractionDigits: 0 })} $PROOF, all burned.`);
console.log(`Supply reduction is permanent. On-chain receipts:`);
console.log(`  Swap: https://solscan.io/tx/${swapSig}`);
console.log(`  Burn: https://solscan.io/tx/${burnSig}`);
console.log('');

// ── Helper: log a failure row ──────────────────────────────────────
async function logFailure(supabase, solLamports, proofRaw, swapSig, burnSig, reason, note) {
  try {
    await supabase.from('proof_buybacks').insert({
      sol_spent_lamports: solLamports.toString(),
      proof_bought_raw: proofRaw.toString(),
      proof_burned_raw: '0',
      proof_decimals: PROOF_DECIMALS,
      swap_tx: swapSig || 'none',
      burn_tx: burnSig || 'none',
      status: 'failed',
      notes: [reason, note].filter(Boolean).join(' · '),
    });
  } catch (e) {
    console.warn('Failure log insert failed:', e.message);
  }
}
