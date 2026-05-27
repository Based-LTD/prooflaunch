#!/usr/bin/env node
/* eslint-disable */
//
// Snapshot of all UNCLAIMED creator fees on pump.fun, broken down per meme.
//
// For each live meme we derive the creator-vault PDA from its creator pubkey
// (sub-escrow for Phase 2 launches, shared platform escrow for pre-Phase-2)
// and check the vault's balance + the creator's own SOL balance.
//
// Read-only — sends NO transactions. Just shows what's available to claim.
//
// Usage:  node tools/pull-fee-snapshot.mjs

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';
import { Connection, PublicKey, LAMPORTS_PER_SOL, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

// ── Env ────────────────────────────────────────────────────────────
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
for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_SOLANA_RPC_URL', 'ESCROW_WALLET_PRIVATE_KEY']) {
  if (!env[k]) { console.error(`Missing ${k}`); process.exit(1); }
}

const PUMP_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
function deriveCreatorVault(creator) {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('creator-vault'), creator.toBuffer()],
    PUMP_PROGRAM_ID,
  );
  return pda;
}

// ── Derive shared escrow pubkey from its private key ───────────────
const sharedEscrowKey = env.ESCROW_WALLET_PRIVATE_KEY.replace(/\\n/g, '\n').trim();
const sharedEscrow = Keypair.fromSecretKey(bs58.decode(sharedEscrowKey)).publicKey;

// ── Load live memes ────────────────────────────────────────────────
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const conn = new Connection(env.NEXT_PUBLIC_SOLANA_RPC_URL, 'confirmed');

const { data: memes, error } = await supabase
  .from('memes')
  .select('id, symbol, name, mint_address, creator_subescrow_pubkey, partner_id, launched_at')
  .eq('status', 'live')
  .order('launched_at', { ascending: true });
if (error) { console.error(error); process.exit(1); }

console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  Unclaimed creator-fee snapshot — pump.fun creator vaults + sub-escrow balances');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');
console.log('  Shared platform escrow pubkey:');
console.log('  ', sharedEscrow.toBase58());
console.log('  https://solscan.io/account/' + sharedEscrow.toBase58());
console.log('');

const sharedVault = deriveCreatorVault(sharedEscrow);
const sharedVaultBal = await conn.getBalance(sharedVault);
const sharedEscrowBal = await conn.getBalance(sharedEscrow);
console.log('  Shared creator-vault PDA:    ' + sharedVault.toBase58());
console.log('  Vault balance (unclaimed):   ' + (sharedVaultBal / LAMPORTS_PER_SOL).toFixed(6) + ' SOL');
console.log('  Shared escrow balance:       ' + (sharedEscrowBal / LAMPORTS_PER_SOL).toFixed(6) + ' SOL');
console.log('  (pre-Phase-2 memes\' fees all funnel through this vault; PROOF is the main one)');
console.log('');

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  Per-meme breakdown');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');
console.log('  SYMBOL     Type                Vault unclaimed    Sub-escrow balance');
console.log('  ──────     ────                ────────────────    ──────────────────');

let totalVault = 0;
let totalSubEscrow = 0;
const memeRows = [];

for (const m of memes) {
  let creator, vault, vaultBal, subEscrowBal, type;
  if (m.creator_subescrow_pubkey) {
    type = 'Phase 2 (per-coin)';
    creator = new PublicKey(m.creator_subescrow_pubkey);
    vault = deriveCreatorVault(creator);
    vaultBal = await conn.getBalance(vault);
    subEscrowBal = await conn.getBalance(creator);
  } else {
    type = 'pre-P2 (shared)  ';
    creator = sharedEscrow;
    vault = sharedVault;
    vaultBal = 0;       // shared with all pre-P2 memes; counted once above
    subEscrowBal = 0;
  }
  totalVault += vaultBal;
  totalSubEscrow += subEscrowBal;
  memeRows.push({ symbol: m.symbol, type, vaultBal, subEscrowBal, creator, mint: m.mint_address });
  const sym = m.symbol.padEnd(10);
  const v = (vaultBal / LAMPORTS_PER_SOL).toFixed(6).padStart(12);
  const s = (subEscrowBal / LAMPORTS_PER_SOL).toFixed(6).padStart(12);
  console.log(`  ${sym} ${type}     ${v} SOL    ${s} SOL`);
}

console.log('');
console.log('  ──────────────────────────────────────────────────────────────────────────');
console.log('  Totals across Phase 2 memes:');
console.log('    Unclaimed vault balances:   ' + (totalVault / LAMPORTS_PER_SOL).toFixed(6) + ' SOL');
console.log('    Sub-escrow standing balances: ' + (totalSubEscrow / LAMPORTS_PER_SOL).toFixed(6) + ' SOL');
console.log('  Pre-Phase-2 shared vault:      ' + (sharedVaultBal / LAMPORTS_PER_SOL).toFixed(6) + ' SOL');
console.log('  Shared escrow standing:        ' + (sharedEscrowBal / LAMPORTS_PER_SOL).toFixed(6) + ' SOL');
console.log('');
const grandTotal = totalVault + totalSubEscrow + sharedVaultBal + sharedEscrowBal;
console.log('  GRAND TOTAL POTENTIALLY CLAIMABLE: ' + (grandTotal / LAMPORTS_PER_SOL).toFixed(6) + ' SOL');
console.log('');
console.log('  Notes:');
console.log('    - Vault unclaimed = sitting at pump.fun creator-vault PDA, waiting on collectCreatorFee tx');
console.log('    - Sub-escrow balance = already collected, sitting in our wallet awaiting distribution');
console.log('    - Standard split per distribution: 90% backers (hold-weighted) / 5% platform / 5% PROOF airdrop');
console.log('    - Each sub-escrow needs ~0.001 SOL gas reserve, so net distributable is slightly less');
console.log('');
