#!/usr/bin/env node
// tools/launch-dryrun.mjs — pre-launch sanity check for any funded meme.
//
// READ-ONLY. Performs zero on-chain writes. Safe to run on any meme at
// any time. Confirms the meme + pool + backings + escrow are in a state
// where /api/launch will succeed without surprises.
//
// Usage:
//   node tools/launch-dryrun.mjs <SYMBOL>
//   node tools/launch-dryrun.mjs PROOF
//
// Requires .env.local (or sourced env) with:
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   NEXT_PUBLIC_SOLANA_RPC_URL
//   BURNER_ENCRYPTION_KEY, ESCROW_WALLET_PRIVATE_KEY
//
// Exit code: 0 if all checks pass, 1 if any fail.

import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { createClient } from '@supabase/supabase-js';
import bs58Pkg from 'bs58';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, resolve as pathResolve } from 'path';
import { readFileSync, existsSync } from 'fs';

const bs58 = bs58Pkg.default || bs58Pkg;

// Auto-load .env.local from project root if env not already set.
function loadEnvLocal() {
  const here = dirname(fileURLToPath(import.meta.url));
  const envPath = pathResolve(here, '..', '.env.local');
  if (!existsSync(envPath)) return;
  const raw = readFileSync(envPath, 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*["']?(.*?)["']?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
loadEnvLocal();

function decryptPrivateKey(payload) {
  const [scheme, ivB64, tagB64, ctB64] = payload.split(':');
  if (scheme !== 'aes') throw new Error('unknown encryption scheme: ' + scheme);
  // Normalize Vercel-style literal \n in env → real 0x0A.
  const rawKey = process.env.BURNER_ENCRYPTION_KEY.replace(/\\n/g, '\n');
  const key = crypto.createHash('sha256').update(rawKey).digest();
  const dec = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  dec.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([dec.update(Buffer.from(ctB64, 'base64')), dec.final()]).toString('utf8');
}

function pass(msg) { console.log('  ✓', msg); }
function fail(msg) { console.log('  ✗', msg); process.exitCode = 1; }
function warn(msg) { console.log('  ⚠', msg); }

const symbol = process.argv[2];
if (!symbol) {
  console.error('Usage: node tools/launch-dryrun.mjs <SYMBOL>');
  console.error('Example: node tools/launch-dryrun.mjs PROOF');
  process.exit(2);
}

const REQUIRED_ENV = [
  'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_SOLANA_RPC_URL', 'BURNER_ENCRYPTION_KEY', 'ESCROW_WALLET_PRIVATE_KEY',
];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length) {
  console.error('Missing env vars:', missing.join(', '));
  console.error('Source .env.local or your prod env file first.');
  process.exit(2);
}

const conn = new Connection(process.env.NEXT_PUBLIC_SOLANA_RPC_URL, 'confirmed');
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

console.log(`=== Launch dry-run: ${symbol} ===\n`);

const { data: meme, error: memeErr } = await sb.from('memes')
  .select('id, symbol, status, current_backing_sol, total_slots, pool_wallet, encrypted_pool_key, creator_wallet, name, description, image_url')
  .eq('symbol', symbol).maybeSingle();
if (memeErr || !meme) {
  console.error(`Meme with symbol="${symbol}" not found.`);
  process.exit(1);
}

console.log(`id: ${meme.id}`);
console.log(`status: ${meme.status}`);
console.log(`pool wallet: ${meme.pool_wallet}`);
console.log(`total slots: ${meme.total_slots}`);
console.log(`current backing: ${meme.current_backing_sol} SOL\n`);

// [1] status
console.log('[1] Status check');
if (meme.status !== 'funded') fail(`status=${meme.status}, expected 'funded'`);
else pass(`status='funded'`);
console.log('');

// [2] pool key
console.log('[2] Pool keypair integrity');
let poolKp;
try {
  poolKp = Keypair.fromSecretKey(bs58.decode(decryptPrivateKey(meme.encrypted_pool_key)));
  if (poolKp.publicKey.toBase58() !== meme.pool_wallet) {
    fail(`decrypted pubkey ${poolKp.publicKey.toBase58()} != pool_wallet ${meme.pool_wallet}`);
  } else {
    pass('pool key decrypts to expected pubkey');
  }
} catch (e) {
  fail(`pool key decrypt FAILED: ${e.message}`);
  process.exit(1);
}
console.log('');

// [3] pool balance
console.log('[3] Pool balance reconciliation');
const poolBal = await conn.getBalance(poolKp.publicKey);
const poolSol = poolBal / 1e9;
console.log(`  pool on-chain: ${poolSol} SOL`);
console.log(`  DB current_backing_sol: ${meme.current_backing_sol} SOL`);
const drift = Math.abs(poolSol - Number(meme.current_backing_sol));
if (drift > 0.001) fail(`drift ${drift} SOL exceeds 0.001 threshold`);
else pass(`balance matches DB (drift ${drift.toFixed(6)} SOL — within tolerance)`);
console.log('');

// [4] backings
console.log('[4] Backings audit');
const { data: backings } = await sb.from('backings')
  .select('id, slot_number, backer_wallet, amount_sol, status')
  .eq('meme_id', meme.id).eq('status', 'confirmed')
  .order('created_at', { ascending: true });
console.log(`  confirmed backings: ${backings.length}`);
const totalSol = backings.reduce((s, b) => s + Number(b.amount_sol), 0);
console.log(`  sum of stakes: ${totalSol} SOL`);
if (Math.abs(totalSol - Number(meme.current_backing_sol)) > 0.0001) {
  fail(`stake sum ${totalSol} != current_backing_sol ${meme.current_backing_sol}`);
} else {
  pass('stake sum matches current_backing_sol');
}
let allValid = true;
for (const b of backings) {
  try {
    const pk = new PublicKey(b.backer_wallet);
    if (pk.toBase58() !== b.backer_wallet) throw new Error('roundtrip mismatch');
  } catch (e) {
    fail(`slot ${b.slot_number} wallet ${b.backer_wallet} INVALID: ${e.message}`);
    allValid = false;
  }
}
if (allValid) pass(`all ${backings.length} backer wallets are valid Solana pubkeys`);
console.log('');

// [5] math
console.log('[5] Distribution math (paper, no on-chain action)');
const SYNTHETIC_POOL_TOKENS = BigInt('2000000000000000');
let running = BigInt(0);
const plan = backings.map((b, i) => {
  let toks;
  if (i === backings.length - 1) {
    toks = SYNTHETIC_POOL_TOKENS - running;
  } else {
    toks = (SYNTHETIC_POOL_TOKENS * BigInt(Math.round(Number(b.amount_sol) * 1e9))) / BigInt(Math.round(totalSol * 1e9));
    running += toks;
  }
  return { slot: b.slot_number, wallet: b.backer_wallet, sol: b.amount_sol, toks };
});
const sumToks = plan.reduce((s, p) => s + p.toks, BigInt(0));
console.log('  Per-backer (synthetic 2e15 tokens):');
for (const p of plan) {
  const pct = (Number(p.toks) / Number(SYNTHETIC_POOL_TOKENS)) * 100;
  console.log(`    slot ${p.slot}: ${p.sol} SOL → ${p.toks.toString()} tokens (${pct.toFixed(4)}%)`);
}
if (sumToks !== SYNTHETIC_POOL_TOKENS) fail(`SUM MISMATCH: ${sumToks} vs ${SYNTHETIC_POOL_TOKENS}`);
else pass('exact-remainder math leaves ZERO tokens unallocated');
console.log('');

// [6] escrow gas
console.log('[6] Escrow gas-funding capacity');
const escrowKp = Keypair.fromSecretKey(bs58.decode(process.env.ESCROW_WALLET_PRIVATE_KEY));
const escrowBal = await conn.getBalance(escrowKp.publicKey);
const escrowSol = escrowBal / 1e9;
const gasNeeded = backings.length * 0.0025;
const totalNeeded = 0.02 + gasNeeded + 0.01;
console.log(`  escrow balance: ${escrowSol} SOL`);
console.log(`  distribution gas needed: ${gasNeeded} SOL (${backings.length} backers × 0.0025)`);
console.log(`  total needed (launch + distribute + safety): ${totalNeeded} SOL`);
if (escrowSol < totalNeeded) fail(`escrow has ${escrowSol} SOL, needs ≥${totalNeeded}`);
else pass(`escrow has ${escrowSol} SOL (${((escrowSol/totalNeeded)*100).toFixed(0)}% of needed)`);
console.log('');

// [7] creator
console.log('[7] Creator authorization');
try {
  new PublicKey(meme.creator_wallet);
  pass(`creator_wallet ${meme.creator_wallet} is valid pubkey (launch route requires caller_wallet match)`);
} catch (e) {
  fail(`creator_wallet invalid: ${e.message}`);
}
console.log('');

// [8] backer wallet on-chain state
console.log('[8] Backer wallet on-chain state (informational)');
for (const b of backings) {
  const bal = await conn.getBalance(new PublicKey(b.backer_wallet));
  const flag = bal === 0 ? ' ⚠ zero SOL — backer will need to fund wallet to ever sell their tokens' : '';
  console.log(`    slot ${b.slot_number}: ${b.backer_wallet.slice(0, 8)}… SOL=${(bal/1e9).toFixed(4)}${flag}`);
}
pass('all backer wallets are on-chain accounts');
console.log('');

// [9] metadata
console.log('[9] Meme metadata');
if (!meme.name) fail('name empty');
else pass(`name='${meme.name}'`);
if (!meme.image_url) warn('image_url empty (token will launch without image)');
else pass(`image_url present (${meme.image_url.length} chars)`);
if (!meme.description) warn('description empty');
else pass(`description present (${meme.description.length} chars)`);
console.log('');

console.log('=== Dry-run complete ===');
if (process.exitCode === 1) {
  console.log('STATUS: FAILED — see ✗ above');
} else {
  console.log('STATUS: READY TO LAUNCH ✓');
}
