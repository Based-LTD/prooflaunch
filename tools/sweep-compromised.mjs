#!/usr/bin/env node
//
// Emergency sweep — moves SOL out of every compromised wallet whose
// private key was in .env.local on a malware-infected machine.
//
// Sources (private keys from .env.local — derived publics):
//   • PROOF_BUYBACK_WALLET_PRIVATE_KEY → ELFjjx7A… (~0.34 SOL today)
//   • ESCROW_WALLET_PRIVATE_KEY         → 83u1MraL… (~0.65 SOL today)
//   • HOLDER_REWARDS_WALLET_PRIVATE_KEY → BAJH4C9T… (~0.006 SOL today)
//
// Destination: a single fresh wallet you control, generated on a clean
// device (phone) and supplied via --to <address>. Funds are consolidated
// there so you can re-airdrop / re-deploy operations from a clean key.
//
// Each compromised wallet keeps a small SOL reserve so any in-flight txs
// (cron runs that might still execute before we update Vercel env) don't
// fail in a way that leaves DB state inconsistent. The reserve is just
// enough for one or two more txs — not a usable balance.
//
// SPL tokens are REPORTED but NOT swept here. SPL sweeps require creating
// associated token accounts on the destination, transferring, then closing
// the source ATA to reclaim rent — adds a lot of complexity and the
// compromised wallets are mostly SOL-only in practice. If any of them
// show SPL balances, we'll do a second-pass script.
//
// Usage:
//   node tools/sweep-compromised.mjs --to <ADDRESS>           # dry-run
//   node tools/sweep-compromised.mjs --to <ADDRESS> --execute # actually send

import {
  Connection, Keypair, PublicKey, SystemProgram,
  Transaction, LAMPORTS_PER_SOL, sendAndConfirmTransaction, ComputeBudgetProgram,
} from '@solana/web3.js';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import bs58 from 'bs58';

const RESERVE_LAMPORTS = 5_000_000;        // 0.005 SOL — enough for ~10-20 more txs
const PRIORITY_FEE_MICROLAMPORTS = 100_000; // bumped — we're potentially racing the attacker

const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022_PROGRAM = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

// ── CLI args ──────────────────────────────────────────────────────
const args = process.argv.slice(2);
const toIdx = args.indexOf('--to');
const destAddr = toIdx >= 0 ? args[toIdx + 1] : null;
const execute = args.includes('--execute');

if (!destAddr) {
  console.error('USAGE: node tools/sweep-compromised.mjs --to <destination_address> [--execute]');
  console.error('You MUST generate the destination wallet on a clean device (phone) — never type its seed on this laptop.');
  process.exit(1);
}

// Validate destination address
let destPk;
try {
  destPk = new PublicKey(destAddr);
} catch {
  console.error(`Invalid destination address: ${destAddr}`);
  process.exit(1);
}

// Sanity: refuse to sweep TO one of the compromised wallets (typo guard)
const compromisedAddrs = new Set([
  'ELFjjx7Ax5kaWnmNCJqwwPirYj5Mne4Gphy5MLzgX5SE',
  '83u1MraLPeq3ZqGo4GKqeg5FLk6YpSR7H7GcgZc2s9Ko',
  'BAJH4C9TRPqVBGmc56m5bTgmed5U8wm9cf9HmQdyMmat',
  'DSC72WnEczr1uuZPWrhNw5VrRy99oa4TtriTXusABNnx',
]);
if (compromisedAddrs.has(destAddr)) {
  console.error(`REFUSED: destination ${destAddr} is one of the COMPROMISED wallets. Wrong direction.`);
  process.exit(1);
}

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
const rpc = env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const conn = new Connection(rpc, 'confirmed');

// ── Sources ────────────────────────────────────────────────────────
const sources = [];
for (const [name, envKey] of [
  ['BUYBACK',       'PROOF_BUYBACK_WALLET_PRIVATE_KEY'],
  ['ESCROW',        'ESCROW_WALLET_PRIVATE_KEY'],
  ['HOLDER_REWARDS','HOLDER_REWARDS_WALLET_PRIVATE_KEY'],
]) {
  const v = env[envKey];
  if (!v) {
    console.warn(`(skipping ${name} — ${envKey} not in .env.local)`);
    continue;
  }
  try {
    const kp = Keypair.fromSecretKey(bs58.decode(v));
    sources.push({ name, kp });
  } catch (e) {
    console.error(`Failed to decode ${envKey}: ${e.message}`);
  }
}

console.log(`Destination: ${destPk.toBase58()}`);
console.log(`RPC: ${rpc.replace(/(api-key=)[^&]+/, '$1***')}`);
console.log(`Sources: ${sources.length}\n`);

// ── Plan + execute per source ──────────────────────────────────────
let totalSentLamports = 0;

for (const s of sources) {
  console.log(`━━━ ${s.name} (${s.kp.publicKey.toBase58().slice(0, 8)}…${s.kp.publicKey.toBase58().slice(-4)}) ━━━`);
  const bal = await conn.getBalance(s.kp.publicKey);
  const sweep = Math.max(0, bal - RESERVE_LAMPORTS);
  console.log(`  balance:  ${(bal / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
  console.log(`  reserve:  ${(RESERVE_LAMPORTS / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
  console.log(`  to sweep: ${(sweep / LAMPORTS_PER_SOL).toFixed(6)} SOL`);

  // Check SPL tokens — report only
  for (const prog of [TOKEN_PROGRAM, TOKEN_2022_PROGRAM]) {
    const accts = await conn.getParsedTokenAccountsByOwner(s.kp.publicKey, { programId: prog });
    const withBalance = accts.value.filter(a => Number(a.account.data.parsed.info.tokenAmount.uiAmount) > 0);
    if (withBalance.length > 0) {
      console.log(`  ⚠ SPL tokens (${prog.toBase58() === TOKEN_PROGRAM.toBase58() ? 'Token' : 'Token-2022'}):`);
      for (const a of withBalance) {
        const info = a.account.data.parsed.info;
        console.log(`    ${info.mint.slice(0, 8)}… = ${info.tokenAmount.uiAmount}`);
      }
    }
  }

  if (sweep <= 0) {
    console.log(`  → skipping (nothing above reserve)\n`);
    continue;
  }

  if (!execute) {
    console.log(`  → would send ${(sweep / LAMPORTS_PER_SOL).toFixed(6)} SOL (dry-run)\n`);
    totalSentLamports += sweep;
    continue;
  }

  // Execute
  try {
    const tx = new Transaction();
    tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_FEE_MICROLAMPORTS }));
    tx.add(SystemProgram.transfer({
      fromPubkey: s.kp.publicKey,
      toPubkey: destPk,
      lamports: sweep,
    }));
    const sig = await sendAndConfirmTransaction(conn, tx, [s.kp], {
      commitment: 'confirmed',
      maxRetries: 5,
    });
    console.log(`  ✅ sent — ${sig}`);
    console.log(`     https://solscan.io/tx/${sig}\n`);
    totalSentLamports += sweep;
  } catch (e) {
    console.error(`  ❌ FAILED: ${e.message}\n`);
  }
}

console.log(`━━━ Summary ━━━`);
console.log(`Total ${execute ? 'sent' : 'would send'}: ${(totalSentLamports / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
if (!execute) console.log(`\n(re-run with --execute to actually send)`);
