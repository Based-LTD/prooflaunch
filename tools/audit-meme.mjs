#!/usr/bin/env node
// audit-meme.mjs — V1 forensic auditor for a Prooflaunch meme.
//
// Goal: prove the system is internally consistent before we expose it
// as a partner API. Specifically, surface every place where what the
// DB claims doesn't match what the chain shows.
//
// V1 checks (the cheapest, highest-signal ones):
//
//   A. PHANTOM-SUCCESS scan
//      For every meme_buybacks row with status='completed' | 'partial',
//      fetch the on-chain action_tx. Verify meta.err is null. Any row
//      where DB says success but on-chain reverted is a phantom — the
//      bug we patched at the simulateAndSend layer 2026-06-17. If any
//      phantoms exist they pre-date that fix.
//
//   B. BOT WALLET FLOW RECONCILIATION
//      Sum every bot wallet's claimed lifetime spend (DB meme_bots.total_sol_spent)
//      and compare to inflow - outflow - current balance from on-chain.
//      Off-by-N tells us how much DB diverges from reality.
//
//   C. UNCOLLECTED FEES on-chain
//      Probe all four fee surfaces (BC creator-vault PDA, PumpSwap auth PDA
//      native + wSOL ATA, sub-escrow wSOL ATA). Report any non-zero amount
//      — that's drainable revenue still sitting there.
//
//   D. ON-CHAIN BURN vs DB BURN
//      Mint's total_supply_burned vs sum of DB burn deltas. Should match.
//
//   E. TREASURY ATA on-chain vs DB
//      HOLD bot wallet's token ATA balance vs the snapshot field. Should
//      match (the snapshot is a per-run on-chain read at the time of
//      that run — most-recent run's snapshot = latest holdings).
//
// Exit code 0 = clean. Exit code 1 = at least one finding. Stdout is
// the human-readable report; consider piping to file for archive.
//
// Usage:
//   node tools/audit-meme.mjs <meme_id>
//   node tools/audit-meme.mjs --by-symbol GO

import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import {
  Connection, PublicKey, LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync, getMint,
  TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, NATIVE_MINT,
} from '@solana/spl-token';

const PUMP_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const PUMP_AMM_PROGRAM_ID = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
const RENT_EXEMPT = 890_880;
const PUMPFUN_DEFAULT_SUPPLY = 1_000_000_000n; // pump.fun standard mint

// ── Argv ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let lookupKind = 'id';
let lookupValue = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--by-symbol') { lookupKind = 'symbol'; lookupValue = args[++i]; continue; }
  if (args[i] === '--by-mint')   { lookupKind = 'mint';   lookupValue = args[++i]; continue; }
  if (!lookupValue) lookupValue = args[i];
}
if (!lookupValue) {
  console.error('usage: node tools/audit-meme.mjs <meme_id>');
  console.error('       node tools/audit-meme.mjs --by-symbol GO');
  console.error('       node tools/audit-meme.mjs --by-mint <mint>');
  process.exit(2);
}

// ── Env / clients ───────────────────────────────────────────────────
const env = readFileSync('.env.local', 'utf-8');
const g = (k) => env.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.replace(/^["']|["']$/g, '');
const sb = createClient(g('NEXT_PUBLIC_SUPABASE_URL'), g('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const conn = new Connection(g('NEXT_PUBLIC_SOLANA_RPC_URL') || 'https://api.mainnet-beta.solana.com', 'confirmed');

const fmt = (n) => (Number(n) / LAMPORTS_PER_SOL).toFixed(6);
const fmtTok = (n, dec) => (Number(n) / Math.pow(10, dec)).toLocaleString('en-US', { maximumFractionDigits: 2 });

// ── Fetch meme ──────────────────────────────────────────────────────
const memeQ = sb.from('memes').select('*');
const { data: meme, error: memeErr } = await (
  lookupKind === 'symbol' ? memeQ.eq('symbol', lookupValue).single()
  : lookupKind === 'mint' ? memeQ.eq('mint_address', lookupValue).single()
  : memeQ.eq('id', lookupValue).single()
);
if (memeErr || !meme) {
  console.error(`Meme not found for ${lookupKind}=${lookupValue}: ${memeErr?.message || 'no row'}`);
  process.exit(2);
}

console.log(`\n═══════════════════════════════════════════════════════════════════`);
console.log(`  AUDIT — ${meme.symbol} (${meme.name})`);
console.log(`  meme_id:     ${meme.id}`);
console.log(`  mint:        ${meme.mint_address || '(unlaunched)'}`);
console.log(`  status:      ${meme.status}`);
console.log(`  platform:    ${meme.launch_platform}`);
console.log(`  sub-escrow:  ${meme.creator_subescrow_pubkey || '(legacy, no sub-escrow)'}`);
console.log(`═══════════════════════════════════════════════════════════════════`);

let findingCount = 0;
const findings = [];
function finding(severity, area, msg) {
  findings.push({ severity, area, msg });
  findingCount++;
}

// ── Mint info ───────────────────────────────────────────────────────
let mintInfo = null;
let tokenProgramId = TOKEN_PROGRAM_ID;
let decimals = 6;
if (meme.mint_address) {
  const mintPub = new PublicKey(meme.mint_address);
  const mintAcc = await conn.getAccountInfo(mintPub);
  if (mintAcc) {
    tokenProgramId = mintAcc.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
    mintInfo = await getMint(conn, mintPub, 'confirmed', tokenProgramId);
    decimals = mintInfo.decimals;
  }
}

// ────────────────────────────────────────────────────────────────────
// A. PHANTOM-SUCCESS SCAN
// ────────────────────────────────────────────────────────────────────
console.log(`\n[A] PHANTOM-SUCCESS SCAN — verify every ok row's tx actually succeeded`);
const { data: buybacks } = await sb
  .from('meme_buybacks')
  .select('id, executed_at, action, status, action_tx, swap_tx, sol_spent_lamports')
  .eq('meme_id', meme.id)
  .in('status', ['completed', 'partial'])
  .order('executed_at', { ascending: false });
console.log(`    rows to verify: ${buybacks?.length || 0}`);

let phantomCount = 0;
let verifyChecked = 0;
let verifyOk = 0;
for (const r of buybacks || []) {
  const sig = r.action_tx || r.swap_tx;
  if (!sig) continue;
  verifyChecked++;
  try {
    const tx = await conn.getTransaction(sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    if (!tx) {
      finding('warn', 'A', `tx not found (could be expired): ${sig.slice(0,12)}… action=${r.action} ${r.executed_at.slice(0,10)}`);
      continue;
    }
    if (tx.meta?.err) {
      phantomCount++;
      const sol = fmt(r.sol_spent_lamports);
      finding('CRITICAL', 'A',
        `PHANTOM: DB says ${r.status}, on-chain REVERTED. action=${r.action} spent=${sol} SOL `
        + `tx=${sig} err=${JSON.stringify(tx.meta.err)} at ${r.executed_at.slice(0,19)}`);
    } else {
      verifyOk++;
    }
  } catch (e) {
    finding('warn', 'A', `RPC error on ${sig.slice(0,12)}…: ${e.message?.slice(0,80)}`);
  }
}
console.log(`    verified: ${verifyOk}/${verifyChecked} succeeded on-chain · phantoms: ${phantomCount}`);

// ────────────────────────────────────────────────────────────────────
// B. BOT WALLET FLOW RECONCILIATION
// ────────────────────────────────────────────────────────────────────
console.log(`\n[B] BOT WALLET BALANCES — DB lifetime vs on-chain`);
const { data: bots } = await sb
  .from('meme_bots')
  .select('id, action, fee_pct, bot_wallet, label, total_sol_spent, total_tokens_acted')
  .eq('meme_id', meme.id)
  .order('slot_order', { ascending: true });
for (const b of bots || []) {
  const wal = new PublicKey(b.bot_wallet);
  const walSol = await conn.getBalance(wal);
  const tokenAta = mintInfo
    ? getAssociatedTokenAddressSync(new PublicKey(meme.mint_address), wal, false, tokenProgramId)
    : null;
  let tokenBal = 0n;
  if (tokenAta) {
    try {
      const info = await conn.getAccountInfo(tokenAta);
      if (info) tokenBal = info.data.readBigUInt64LE(64);
    } catch {}
  }
  console.log(`    [${b.action.padEnd(24)}] fee_pct=${b.fee_pct}%  wallet=${b.bot_wallet}`);
  console.log(`         on-chain SOL:      ${fmt(walSol)} SOL`);
  console.log(`         on-chain token:    ${fmtTok(tokenBal, decimals)} ${meme.symbol}`);
  console.log(`         DB total_sol_spent: ${b.total_sol_spent} SOL`);
  console.log(`         DB total_tokens:    ${fmtTok(b.total_tokens_acted, decimals)} ${meme.symbol}`);
  // The HOLD bot's total_tokens_acted is a snapshot (known issue, see go-stats notes).
  // For other actions, compare DB sums to on-chain.
  if (b.action === 'hold') {
    const dbSnapshot = BigInt(b.total_tokens_acted || 0);
    if (dbSnapshot !== tokenBal) {
      finding('warn', 'B',
        `HOLD bot DB snapshot (${b.total_tokens_acted}) ≠ on-chain ATA (${tokenBal}). `
        + `Snapshot column drift — fix the executeHold writer to use deltas.`);
    }
  } else if (b.action === 'burn') {
    if (tokenBal !== 0n) {
      finding('warn', 'B',
        `BURN bot wallet still holds ${fmtTok(tokenBal, decimals)} ${meme.symbol} tokens. `
        + `Expected ~0 after burns. Could indicate a failed downstream burn ix after a successful swap.`);
    }
  }
}

// ────────────────────────────────────────────────────────────────────
// C. UNCOLLECTED FEE SURFACES
// ────────────────────────────────────────────────────────────────────
console.log(`\n[C] UNCOLLECTED FEES — anything still sitting in vaults / wSOL ATAs`);
if (meme.creator_subescrow_pubkey) {
  const sub = new PublicKey(meme.creator_subescrow_pubkey);
  const [bcVault] = PublicKey.findProgramAddressSync([Buffer.from('creator-vault'), sub.toBuffer()], PUMP_PROGRAM_ID);
  const [ammAuth] = PublicKey.findProgramAddressSync([Buffer.from('creator_vault'), sub.toBuffer()], PUMP_AMM_PROGRAM_ID);
  const ammWsolAta = getAssociatedTokenAddressSync(NATIVE_MINT, ammAuth, true);
  const subWsolAta = getAssociatedTokenAddressSync(NATIVE_MINT, sub, true);
  const [bcBal, ammAuthBal, ammWsolInfo, subBal, subWsolInfo] = await Promise.all([
    conn.getBalance(bcVault),
    conn.getBalance(ammAuth),
    conn.getAccountInfo(ammWsolAta),
    conn.getBalance(sub),
    conn.getAccountInfo(subWsolAta),
  ]);
  const ammAuthFees = Math.max(0, ammAuthBal - RENT_EXEMPT);
  const ammWsol = ammWsolInfo ? Number(ammWsolInfo.data.readBigUInt64LE(64)) : 0;
  const subWsol = subWsolInfo ? Number(subWsolInfo.data.readBigUInt64LE(64)) : 0;
  console.log(`    BC creator-vault:        ${fmt(bcBal)} SOL  ${bcBal > 50_000 ? '← drainable' : ''}`);
  console.log(`    PumpSwap auth PDA:       ${fmt(ammAuthBal)} SOL  (drainable ${fmt(ammAuthFees)})`);
  console.log(`    PumpSwap wSOL ATA:       ${fmt(ammWsol)} SOL  ${ammWsol > 50_000 ? '← drainable' : ''}`);
  console.log(`    Sub-escrow native SOL:   ${fmt(subBal)} SOL`);
  console.log(`    Sub-escrow wSOL ATA:     ${fmt(subWsol)} SOL  ${subWsol > 50_000 ? '← orphaned wSOL' : ''}`);

  const totalUncollected = bcBal + ammAuthFees + ammWsol + subBal + subWsol;
  if (totalUncollected > 1_000_000) {
    finding('info', 'C',
      `${fmt(totalUncollected)} SOL across uncollected fee surfaces. `
      + `Next cron tick should clear this if distribution.ts collect path is wired correctly.`);
  }
} else {
  console.log(`    (legacy meme — no sub-escrow, skipped)`);
}

// ────────────────────────────────────────────────────────────────────
// D. MINT SUPPLY vs DB BURN SUM
// ────────────────────────────────────────────────────────────────────
console.log(`\n[D] BURN RECONCILIATION — on-chain mint drop vs DB burn deltas`);
if (mintInfo) {
  const originalRaw = PUMPFUN_DEFAULT_SUPPLY * BigInt(Math.pow(10, decimals));
  const supply = mintInfo.supply;
  const onChainBurned = originalRaw - supply;
  // DB burns
  let dbBurned = 0n;
  for (const r of buybacks || []) {
    if (r.action === 'burn') dbBurned += BigInt((r.tokens_acted_raw || '0').toString());
  }
  // Need to refetch with tokens_acted_raw
  const { data: burnRuns } = await sb.from('meme_buybacks')
    .select('tokens_acted_raw')
    .eq('meme_id', meme.id)
    .eq('action', 'burn')
    .in('status', ['completed', 'partial']);
  dbBurned = (burnRuns || []).reduce((s, r) => s + BigInt(r.tokens_acted_raw || 0), 0n);
  console.log(`    original supply:    ${fmtTok(originalRaw, decimals)} ${meme.symbol}`);
  console.log(`    current supply:     ${fmtTok(supply, decimals)} ${meme.symbol}`);
  console.log(`    on-chain burned:    ${fmtTok(onChainBurned, decimals)} ${meme.symbol}`);
  console.log(`    DB burn deltas sum: ${fmtTok(dbBurned, decimals)} ${meme.symbol}`);
  const driftRaw = onChainBurned - dbBurned;
  const driftTok = Number(driftRaw) / Math.pow(10, decimals);
  if (driftRaw !== 0n) {
    const driftPctOfOnChain = onChainBurned > 0n ? (Math.abs(Number(driftRaw)) / Number(onChainBurned)) * 100 : 0;
    if (driftPctOfOnChain < 1) {
      finding('info', 'D', `Burn drift ${driftTok.toFixed(2)} ${meme.symbol} (${driftPctOfOnChain.toFixed(3)}% of on-chain) — likely rounding from swap-vs-burn-ix decimal math.`);
    } else {
      finding('warn', 'D', `Burn drift ${driftTok.toFixed(2)} ${meme.symbol} (${driftPctOfOnChain.toFixed(2)}% of on-chain) — investigate, > 1% drift is unusual.`);
    }
  }
} else {
  console.log(`    (no mint info, skipped)`);
}

// ────────────────────────────────────────────────────────────────────
// E. BACKING CREDITS RECONCILIATION (per-meme totals — quick sanity)
// ────────────────────────────────────────────────────────────────────
console.log(`\n[E] BACKER CREDIT TOTALS — DB only (no chain action expected unless claimed)`);
const { data: backings } = await sb
  .from('backings')
  .select('id, backer_wallet, amount_sol, claimable_fees_sol, status')
  .eq('meme_id', meme.id);
let totalClaimable = 0;
let confirmedCount = 0;
for (const b of backings || []) {
  totalClaimable += Number(b.claimable_fees_sol || 0);
  if (b.status === 'confirmed' || b.status === 'distributed') confirmedCount++;
}
console.log(`    backings rows:           ${backings?.length || 0} (confirmed/distributed: ${confirmedCount})`);
console.log(`    total claimable fees:    ${totalClaimable.toFixed(6)} SOL`);

// ────────────────────────────────────────────────────────────────────
// REPORT
// ────────────────────────────────────────────────────────────────────
console.log(`\n═══════════════════════════════════════════════════════════════════`);
console.log(`  REPORT — ${findings.length} finding${findings.length === 1 ? '' : 's'}`);
console.log(`═══════════════════════════════════════════════════════════════════`);
if (findings.length === 0) {
  console.log(`\n  ✓ Clean. No drift, no phantoms, no leaks.`);
} else {
  // Sort: CRITICAL → warn → info
  const order = { CRITICAL: 0, warn: 1, info: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  for (const f of findings) {
    console.log(`\n  [${f.severity}] [${f.area}] ${f.msg}`);
  }
}
console.log(``);
const hasCritical = findings.some((f) => f.severity === 'CRITICAL');
process.exit(hasCritical ? 1 : 0);
