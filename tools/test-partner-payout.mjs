#!/usr/bin/env node
// E2E test of partner rev-share payout, using a stealth meme as the
// harness. Plan:
//   1. Attach partner_id to the target meme
//   2. Fund its sub-escrow with N lamports from the platform escrow
//      (simulates accrued fees)
//   3. Fire /api/fees/process to trigger the drain + payout
//   4. Verify partner_payouts row + partner_wallet balance delta
//
// Idempotent in the sense that step 1 is a noop if partner_id is
// already set. Step 2 will add more to the sub-escrow each run.

import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import bs58 from 'bs58';
import {
  Connection, PublicKey, Keypair, Transaction, SystemProgram, LAMPORTS_PER_SOL,
} from '@solana/web3.js';

const MEME_SYMBOL = process.argv[2] || 'BOTTEST';
const PARTNER_ID = process.argv[3] || 'cb16aafd-1b3d-40df-b3fa-758d6c3b67b9'; // pump-tracks
const FUND_LAMPORTS = Number(process.argv[4] || 10_000_000); // 0.01 SOL default

const env = readFileSync('.env.local', 'utf-8');
const g = (k) => {
  const raw = env.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1];
  if (!raw) return undefined;
  return raw.replace(/^["']|["']$/g, '');
};
const gBs58 = (k) => g(k)?.replace(/\\n/g, '').trim();

const sb = createClient(g('NEXT_PUBLIC_SUPABASE_URL'), g('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const conn = new Connection(g('NEXT_PUBLIC_SOLANA_RPC_URL') || 'https://api.mainnet-beta.solana.com', 'confirmed');

// ── Load partner + meme + escrow ─────────────────────────────────────
const { data: partner } = await sb.from('partners').select('id, slug, partner_wallet, rev_share_bps').eq('id', PARTNER_ID).single();
if (!partner) { console.error('partner not found'); process.exit(1); }
const { data: meme } = await sb.from('memes').select('id, symbol, status, creator_subescrow_pubkey, partner_id, partner_fee_lamports').eq('symbol', MEME_SYMBOL).single();
if (!meme) { console.error('meme not found'); process.exit(1); }

const escrowKp = Keypair.fromSecretKey(bs58.decode(gBs58('ESCROW_WALLET_PRIVATE_KEY')));

console.log(`Partner:      ${partner.slug} (${partner.id.slice(0,8)}…)`);
console.log(`  wallet:     ${partner.partner_wallet}`);
console.log(`  rev_share:  ${partner.rev_share_bps} bps (${(partner.rev_share_bps/100).toFixed(2)}% of platform)`);
console.log(`Meme:         ${meme.symbol} (${meme.id.slice(0,8)}…)`);
console.log(`  status:     ${meme.status}`);
console.log(`  sub-escrow: ${meme.creator_subescrow_pubkey}`);
console.log(`  current partner_id: ${meme.partner_id || '(none)'}`);
console.log(`Escrow:       ${escrowKp.publicKey.toBase58()}`);
console.log();

// ── Step 1: attach partner_id ───────────────────────────────────────
if (meme.partner_id !== partner.id) {
  console.log(`[1] Attaching partner_id...`);
  const { error } = await sb.from('memes').update({ partner_id: partner.id }).eq('id', meme.id);
  if (error) { console.error('  attach failed:', error.message); process.exit(1); }
  console.log(`    ✓ attached`);
} else {
  console.log(`[1] partner_id already attached`);
}

// ── Snapshot partner wallet balance ─────────────────────────────────
const partnerBalBefore = await conn.getBalance(new PublicKey(partner.partner_wallet));
console.log(`\nPartner wallet balance BEFORE: ${(partnerBalBefore/LAMPORTS_PER_SOL).toFixed(6)} SOL`);

// ── Step 2: fund sub-escrow from platform escrow ───────────────────
console.log(`\n[2] Funding sub-escrow with ${FUND_LAMPORTS} lamports (${(FUND_LAMPORTS/LAMPORTS_PER_SOL).toFixed(4)} SOL)...`);
const subPk = new PublicKey(meme.creator_subescrow_pubkey);
const subBalBefore = await conn.getBalance(subPk);
console.log(`    sub-escrow before: ${(subBalBefore/LAMPORTS_PER_SOL).toFixed(6)} SOL`);

const fundTx = new Transaction().add(
  SystemProgram.transfer({
    fromPubkey: escrowKp.publicKey,
    toPubkey: subPk,
    lamports: FUND_LAMPORTS,
  }),
);
fundTx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
fundTx.feePayer = escrowKp.publicKey;
const fundSig = await conn.sendTransaction(fundTx, [escrowKp]);
await conn.confirmTransaction(fundSig, 'confirmed');
console.log(`    fund tx: ${fundSig}`);
const subBalAfter = await conn.getBalance(subPk);
console.log(`    sub-escrow after:  ${(subBalAfter/LAMPORTS_PER_SOL).toFixed(6)} SOL`);

// ── Step 3: fire fees/process ──────────────────────────────────────
console.log(`\n[3] Firing /api/fees/process to trigger drain + payout...`);
const cronRes = await fetch('https://prooflaunch.fun/api/fees/process', {
  method: 'POST',
  headers: { 'x-vercel-cron': '1' },
});
if (!cronRes.ok) {
  console.error(`    HTTP ${cronRes.status}: ${await cronRes.text()}`);
  process.exit(1);
}
const cronBody = await cronRes.json();
const memeResult = (cronBody.subescrowResults || []).find(r => r.memeId === meme.id);
console.log(`    cron result for ${meme.symbol}:`);
console.log(`      ${JSON.stringify(memeResult?.result || '(no result)', null, 6).slice(0, 800)}`);

// ── Step 4: verify partner_payouts + balance delta ─────────────────
console.log(`\n[4] Verifying...`);

const { data: payouts } = await sb
  .from('partner_payouts')
  .select('*')
  .eq('partner_id', partner.id)
  .eq('meme_id', meme.id)
  .order('created_at', { ascending: false })
  .limit(3);
console.log(`    partner_payouts rows (newest 3):`);
for (const p of payouts || []) {
  console.log(`      ${p.created_at.slice(11,19)} status=${p.status} amount=${(p.amount_lamports/1e9).toFixed(6)} SOL platform_at_payout=${(p.platform_lamports_at_payout/1e9).toFixed(6)} tx=${(p.transfer_sig||'').slice(0,16)}…`);
  if (p.error) console.log(`        error: ${p.error.slice(0, 120)}`);
}

const partnerBalAfter = await conn.getBalance(new PublicKey(partner.partner_wallet));
const delta = partnerBalAfter - partnerBalBefore;
console.log(`\nPartner wallet balance AFTER:  ${(partnerBalAfter/LAMPORTS_PER_SOL).toFixed(6)} SOL`);
console.log(`Delta:                          ${(delta/LAMPORTS_PER_SOL).toFixed(6)} SOL (expected ~${(FUND_LAMPORTS * 0.10 * partner.rev_share_bps / 10_000 / LAMPORTS_PER_SOL).toFixed(6)} SOL = 10% platform × ${(partner.rev_share_bps/100).toFixed(0)}% rev_share)`);

// ── Refresh meme to show the cumulative counter ────────────────────
const { data: memeAfter } = await sb.from('memes').select('partner_fee_lamports').eq('id', meme.id).single();
console.log(`memes.partner_fee_lamports:    ${(Number(memeAfter.partner_fee_lamports)/1e9).toFixed(6)} SOL`);

console.log(`\n══════════════════════════════════════════════════════════════════`);
if (delta > 0 && payouts?.[0]?.status === 'sent') {
  console.log(`✅ PARTNER REV-SHARE PAYOUT WORKS END-TO-END`);
} else {
  console.log(`⚠️  Test inconclusive — check the logs above`);
}
console.log(`══════════════════════════════════════════════════════════════════`);
