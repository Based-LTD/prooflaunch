#!/usr/bin/env node
/* eslint-disable */
//
// Decrypt the PROOF token's pool_wallet keypair from the database so it
// can be:
//   1. Loaded into Phantom / 1Password for personal backup
//   2. Added to .env.local + Vercel as PROOF_BUYBACK_WALLET_PRIVATE_KEY
//      so tools/buy-and-burn.mjs can sign from it
//
// Why this wallet:
//   - It signed PROOF's createV2 + atomic launch buy on pump.fun
//   - On Solscan + DexScreener it shows as the wallet that deployed
//     PROOF, so when it buys and burns, anyone can trace the trade
//     back to the original deployer in two clicks
//   - The "watch this address" narrative is bulletproof
//
// What it does NOT do:
//   - Re-encrypt or rotate. The same encrypted secret stays in the DB.
//   - Send any on-chain transaction.
//
// One-shot script. Run, capture output, store secret securely, done.

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import bs58 from 'bs58';
import { Keypair, Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';

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
for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'BURNER_ENCRYPTION_KEY', 'NEXT_PUBLIC_SOLANA_RPC_URL']) {
  if (!env[k]) {
    console.error(`Missing ${k} in .env.local`);
    process.exit(1);
  }
}

// Vercel encrypts env vars with literal "\n" as the string "\n" — normalize.
const burnerKeyRaw = env.BURNER_ENCRYPTION_KEY.replace(/\\n/g, '\n');

// ── Decryption (mirrors src/lib/crypto.ts) ─────────────────────────
function decryptPrivateKey(encrypted) {
  if (encrypted.startsWith('enc:')) {
    return Buffer.from(encrypted.slice(4), 'base64').toString('utf-8');
  }
  if (encrypted.startsWith('aes:')) {
    const key = crypto.createHash('sha256').update(burnerKeyRaw).digest();
    const parts = encrypted.split(':');
    if (parts.length !== 4) throw new Error('Invalid encrypted key format');
    const iv = Buffer.from(parts[1], 'base64');
    const authTag = Buffer.from(parts[2], 'base64');
    const ciphertext = Buffer.from(parts[3], 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }
  throw new Error('Unknown encryption format');
}

// ── Look up PROOF ──────────────────────────────────────────────────
const PROOF_MINT = 'oaBXM2rCnWFeQc9ufdTSSpASwSrMBPrSmg8xtiepooL';
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const { data: meme, error } = await supabase
  .from('memes')
  .select('id, symbol, name, status, pool_wallet, encrypted_pool_key, launched_at')
  .eq('mint_address', PROOF_MINT)
  .maybeSingle();
if (error) { console.error('DB lookup failed:', error.message); process.exit(1); }
if (!meme) { console.error(`No meme found with mint ${PROOF_MINT}`); process.exit(1); }
if (!meme.pool_wallet || !meme.encrypted_pool_key) {
  console.error('PROOF row has no pool_wallet / encrypted_pool_key. Cannot continue.');
  process.exit(1);
}

// ── Decrypt + sanity-check ─────────────────────────────────────────
let secretB58, kp;
try {
  secretB58 = decryptPrivateKey(meme.encrypted_pool_key);
  kp = Keypair.fromSecretKey(bs58.decode(secretB58));
} catch (e) {
  console.error('Decryption failed:', e.message);
  process.exit(1);
}
if (kp.publicKey.toBase58() !== meme.pool_wallet) {
  console.error('Sanity check failed — derived pubkey does not match stored pool_wallet.');
  console.error('  Stored:  ', meme.pool_wallet);
  console.error('  Derived: ', kp.publicKey.toBase58());
  process.exit(1);
}

// ── Live balance check ─────────────────────────────────────────────
const conn = new Connection(env.NEXT_PUBLIC_SOLANA_RPC_URL, 'confirmed');
const balLamports = await conn.getBalance(kp.publicKey);
const balSol = balLamports / LAMPORTS_PER_SOL;

// ── Write to /tmp file (so the secret never echoes via redirects) ─
const outFile = '/tmp/proof-pool-wallet.txt';
const fileContent = `PROOF pool_wallet export — ${new Date().toISOString()}

Public address: ${kp.publicKey.toBase58()}
Current balance: ${balSol.toFixed(6)} SOL

Add to .env.local + Vercel env (Project → Settings → Env Vars):

NEXT_PUBLIC_PROOF_BUYBACK_WALLET=${kp.publicKey.toBase58()}
PROOF_BUYBACK_WALLET_PRIVATE_KEY=${secretB58}

For Phantom import (Settings → Add/Connect Wallet → Import Private Key):
${secretB58}

KEEP THIS FILE PRIVATE. Wipe with: rm /tmp/proof-pool-wallet.txt
`;
writeFileSync(outFile, fileContent, { mode: 0o600 });

// ── Console output (secret SCRUBBED) ───────────────────────────────
console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  PROOF pool_wallet — ${meme.symbol} (${meme.name})`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');
console.log('  Public address:');
console.log('  ', kp.publicKey.toBase58());
console.log('  https://solscan.io/account/' + kp.publicKey.toBase58());
console.log('');
console.log('  Current balance:  ' + balSol.toFixed(6) + ' SOL');
console.log('  Status:           ' + meme.status + (meme.launched_at ? '  (launched ' + meme.launched_at.slice(0, 10) + ')' : ''));
console.log('');
console.log('───────────────────────────────────────────────────────────────────');
console.log('  Secret key written to (not echoed here):');
console.log('  ', outFile);
console.log('───────────────────────────────────────────────────────────────────');
console.log('');
console.log('  cat ' + outFile + '    # read it');
console.log('');
console.log('  Then:');
console.log('   1. Copy the two env var lines into .env.local');
console.log('   2. Copy same two into Vercel project env (Production scope)');
console.log('   3. Import the same secret into Phantom (Settings → Import Private Key) for backup + manual use');
console.log('   4. Optionally save in 1Password / Bitwarden vault for disaster recovery');
console.log('   5. When confirmed safely stored: rm ' + outFile);
console.log('');
if (balLamports === 0) {
  console.log('  ⚠️  Wallet has 0 SOL. Fund it before running any buyback.');
  console.log('     Send to: ' + kp.publicKey.toBase58());
  console.log('');
}
