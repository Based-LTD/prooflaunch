#!/usr/bin/env node
// reconcile-meme-bots.mjs — one-off DB reset to align with on-chain reality.
//
// Fixes historical drift surfaced by audit-meme.mjs:
//   1. Flip any meme_buybacks row marked ok/partial whose on-chain tx
//      actually reverted (pre-2026-06-17 phantom-success bug fallout).
//   2. Recompute meme_bots.total_sol_spent from SUM of completed+partial
//      rows so the lifetime column doesn't include phantom amounts.
//   3. Recompute meme_bots.total_tokens_acted:
//      - BURN: SUM of tokens_acted_raw (already per-run deltas — burns destroy)
//      - HOLD: set to on-chain ATA balance (historical column was a
//        snapshot that double-counted; from now on the swap path writes
//        per-run deltas correctly, so this rebases the running sum).
//      - DISTRIBUTE_SOL_*: no tokens, leave 0.
//      - DISTRIBUTE_TOKENS_*: SUM (per-run deltas, distributes destroy from bot wallet).
//
// Usage:
//   node tools/reconcile-meme-bots.mjs <meme_id> [--execute]

import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';

const memeId = process.argv[2];
const EXECUTE = process.argv.includes('--execute');
if (!memeId || memeId.startsWith('--')) {
  console.error('usage: node tools/reconcile-meme-bots.mjs <meme_id> [--execute]');
  process.exit(2);
}

const env = readFileSync('.env.local', 'utf-8');
const g = (k) => env.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.replace(/^["']|["']$/g, '');
const sb = createClient(g('NEXT_PUBLIC_SUPABASE_URL'), g('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const conn = new Connection(g('NEXT_PUBLIC_SOLANA_RPC_URL') || 'https://api.mainnet-beta.solana.com', 'confirmed');

const { data: meme } = await sb.from('memes').select('id, symbol, name, mint_address').eq('id', memeId).single();
if (!meme) { console.error('meme not found'); process.exit(2); }

console.log(`Reconciling ${meme.symbol} (${meme.name}) — mode: ${EXECUTE ? 'EXECUTE' : 'DRY-RUN'}`);

const mintPub = meme.mint_address ? new PublicKey(meme.mint_address) : null;
let tokenProgramId = TOKEN_PROGRAM_ID;
if (mintPub) {
  const mintAcc = await conn.getAccountInfo(mintPub);
  if (mintAcc?.owner.equals(TOKEN_2022_PROGRAM_ID)) tokenProgramId = TOKEN_2022_PROGRAM_ID;
}

// ── Step 1: find phantom rows ─────────────────────────────────────
console.log(`\n[1] Scanning for phantom-success rows...`);
const { data: rows } = await sb
  .from('meme_buybacks')
  .select('id, executed_at, action, status, action_tx, swap_tx, sol_spent_lamports')
  .eq('meme_id', meme.id)
  .in('status', ['completed', 'partial']);

const phantomIds = [];
for (const r of rows || []) {
  const sig = r.action_tx || r.swap_tx;
  if (!sig) continue;
  try {
    const tx = await conn.getTransaction(sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    if (tx?.meta?.err) {
      phantomIds.push(r.id);
      const sol = (Number(r.sol_spent_lamports) / 1e9).toFixed(4);
      console.log(`    phantom: ${r.executed_at.slice(0,19)} ${r.action} spent=${sol} SOL  (would flip to failed)`);
    }
  } catch {}
}
console.log(`    ${phantomIds.length} phantom rows to flip`);

// ── Step 2: load bots, fetch on-chain HOLD balances, compute targets ────
const { data: bots } = await sb
  .from('meme_bots')
  .select('id, action, bot_wallet, total_sol_spent, total_tokens_acted')
  .eq('meme_id', meme.id);

const targets = [];
for (const b of bots || []) {
  // recompute SOL spent from completed+partial rows MINUS phantoms
  const { data: solRows } = await sb
    .from('meme_buybacks')
    .select('id, sol_spent_lamports')
    .eq('bot_id', b.id)
    .in('status', ['completed', 'partial']);
  const okSolRows = (solRows || []).filter((r) => !phantomIds.includes(r.id));
  const newSolSpentLamports = okSolRows.reduce((s, r) => s + Number(r.sol_spent_lamports), 0);
  const newTotalSolSpent = newSolSpentLamports / 1e9;

  let newTotalTokensActed = 0n;
  if (b.action === 'burn' || b.action.startsWith('distribute_tokens') || b.action.startsWith('donate_tokens')) {
    // per-run deltas already correct
    const { data: tokRows } = await sb
      .from('meme_buybacks')
      .select('id, tokens_acted_raw')
      .eq('bot_id', b.id)
      .in('status', ['completed', 'partial']);
    const okTokRows = (tokRows || []).filter((r) => !phantomIds.includes(r.id));
    newTotalTokensActed = okTokRows.reduce((s, r) => s + BigInt(r.tokens_acted_raw || 0), 0n);
  } else if (b.action === 'hold' && mintPub) {
    // Use on-chain ATA balance as the truth
    try {
      const ata = getAssociatedTokenAddressSync(mintPub, new PublicKey(b.bot_wallet), false, tokenProgramId);
      const info = await conn.getAccountInfo(ata);
      if (info) newTotalTokensActed = info.data.readBigUInt64LE(64);
    } catch {}
  }
  // distribute_sol_* and donate_sol stay at 0

  targets.push({
    id: b.id,
    action: b.action,
    old_sol: Number(b.total_sol_spent),
    new_sol: newTotalSolSpent,
    old_tokens: BigInt(b.total_tokens_acted || 0),
    new_tokens: newTotalTokensActed,
  });
}

console.log(`\n[2] Per-bot recompute plan:`);
for (const t of targets) {
  const solDelta = t.new_sol - t.old_sol;
  const tokDelta = t.new_tokens - t.old_tokens;
  console.log(`    [${t.action.padEnd(24)}]`);
  console.log(`      total_sol_spent:    ${t.old_sol.toFixed(6)} → ${t.new_sol.toFixed(6)}  (Δ ${solDelta >= 0 ? '+' : ''}${solDelta.toFixed(6)})`);
  console.log(`      total_tokens_acted: ${t.old_tokens.toString()} → ${t.new_tokens.toString()}  (Δ ${tokDelta >= 0n ? '+' : ''}${tokDelta.toString()})`);
}

if (!EXECUTE) {
  console.log(`\nDRY-RUN. Re-run with --execute to apply.`);
  process.exit(0);
}

// ── Step 3: APPLY ────────────────────────────────────────────────
console.log(`\n[3] APPLYING...`);
if (phantomIds.length > 0) {
  const { error } = await sb
    .from('meme_buybacks')
    .update({ status: 'failed', error: 'reconciliation: on-chain tx reverted (pre-2026-06-17 phantom-success bug)' })
    .in('id', phantomIds);
  if (error) console.error(`  flip phantoms failed: ${error.message}`);
  else console.log(`  flipped ${phantomIds.length} phantom rows to failed`);
}
for (const t of targets) {
  const { error } = await sb
    .from('meme_bots')
    .update({
      total_sol_spent: t.new_sol,
      total_tokens_acted: t.new_tokens.toString(),
    })
    .eq('id', t.id);
  if (error) console.error(`  bot ${t.id} update failed: ${error.message}`);
  else console.log(`  ✓ bot ${t.action.padEnd(24)} reconciled`);
}
console.log(`\nDone.`);
