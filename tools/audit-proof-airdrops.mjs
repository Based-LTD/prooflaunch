#!/usr/bin/env node
// audit-proof-airdrops.mjs — Diagnostic for PROOF holder airdrop distribution
// health. Answers: is the payout list actually reaching multiple wallets, or
// is one wallet dominating? What's the recent trend? Is the rewards wallet
// getting fed?
//
// Read-only. Safe to run anytime.
//
//   node tools/audit-proof-airdrops.mjs

import { readFileSync } from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { createClient } = require('@supabase/supabase-js');
const { Connection, PublicKey } = require('@solana/web3.js');
const bs58Mod = require('bs58');
const bs58 = bs58Mod.default || bs58Mod;
const { Keypair } = require('@solana/web3.js');

// Load .env.local
const envText = readFileSync('.env.local', 'utf8');
const env = Object.fromEntries(
  envText.split('\n')
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => {
      const idx = l.indexOf('=');
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim().replace(/^["']|["']$/g, '')];
    })
);

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
);

const LAMPORTS_PER_SOL = 1_000_000_000;
const PROOF_MINT = 'oaBXM2rCnWFeQc9ufdTSSpASwSrMBPrSmg8xtiepooL';

function fmt(lamports) {
  return `${(Number(lamports) / LAMPORTS_PER_SOL).toFixed(6)} SOL`;
}

console.log('=== PROOF HOLDER AIRDROP AUDIT ===\n');

// 1. Rewards wallet balance (the pool being distributed from)
const rewardsKey = env.HOLDER_REWARDS_WALLET_PRIVATE_KEY;
if (rewardsKey) {
  const kp = Keypair.fromSecretKey(bs58.decode(rewardsKey.replace(/\\n/g, '\n').trim()));
  const conn = new Connection(env.NEXT_PUBLIC_SOLANA_RPC_URL, 'confirmed');
  const bal = await conn.getBalance(kp.publicKey);
  console.log(`HOLDER_REWARDS_WALLET (${kp.publicKey.toBase58()}):`);
  console.log(`  Current balance: ${fmt(bal)}\n`);
}

// 2. Lifetime totals — PAGINATED (Supabase caps queries at 1000 rows; the
// unpaginated version silently undercounted once the table grew past that,
// same bug that broke the public /api/proof/paid-out counter)
const sentAll = [];
for (let page = 0; ; page++) {
  const { data } = await supabase
    .from('holder_distribution_payouts')
    .select('share_lamports, wallet, status')
    .eq('status', 'sent')
    .order('id', { ascending: true })
    .range(page * 1000, page * 1000 + 999);
  if (!data || data.length === 0) break;
  sentAll.push(...data);
  if (data.length < 1000) break;
}

const sentSum = (sentAll || []).reduce((s, p) => s + Number(p.share_lamports || 0), 0);
console.log(`LIFETIME TOTALS (status='sent'):`);
console.log(`  Total distributed: ${fmt(sentSum)}`);
console.log(`  Total payout rows: ${sentAll?.length || 0}`);
console.log(`  Unique wallets paid: ${new Set((sentAll || []).map(p => p.wallet)).size}\n`);

// 3. Concentration — top 20 recipients
const perWallet = new Map();
for (const p of sentAll || []) {
  perWallet.set(p.wallet, (perWallet.get(p.wallet) || 0) + Number(p.share_lamports || 0));
}
const ranked = [...perWallet.entries()].sort((a, b) => b[1] - a[1]);
console.log(`TOP 20 RECIPIENTS BY LIFETIME PAID:`);
let cumulative = 0;
for (let i = 0; i < Math.min(20, ranked.length); i++) {
  const [wallet, lam] = ranked[i];
  cumulative += lam;
  const pct = (lam / sentSum * 100).toFixed(1);
  const cumPct = (cumulative / sentSum * 100).toFixed(1);
  console.log(`  ${String(i + 1).padStart(2)}. ${wallet}  ${fmt(lam).padEnd(14)}  ${pct.padStart(5)}%  (cum ${cumPct}%)`);
}
console.log();

if (ranked.length > 0) {
  const top1Pct = (ranked[0][1] / sentSum * 100).toFixed(1);
  const top5Pct = ranked.slice(0, 5).reduce((s, [_, v]) => s + v, 0) / sentSum * 100;
  const top10Pct = ranked.slice(0, 10).reduce((s, [_, v]) => s + v, 0) / sentSum * 100;
  console.log(`CONCENTRATION:`);
  console.log(`  Top 1  wallet: ${top1Pct}%`);
  console.log(`  Top 5  wallets: ${top5Pct.toFixed(1)}%`);
  console.log(`  Top 10 wallets: ${top10Pct.toFixed(1)}%\n`);
}

// 4. Recent distributions
const { data: distros } = await supabase
  .from('holder_distributions')
  .select('id, epoch_date, distributed_at, total_sol_lamports, holder_count, status')
  .order('distributed_at', { ascending: false })
  .limit(15);

console.log(`RECENT 15 DISTRIBUTIONS:`);
console.log(`  Date        Wallets  Total SOL      Status`);
for (const d of distros || []) {
  console.log(`  ${d.epoch_date}  ${String(d.holder_count).padStart(4)}     ${fmt(d.total_sol_lamports).padEnd(14)} ${d.status}`);
}
console.log();

// 5. For the most recent distribution — how did the SOL split?
if (distros && distros.length > 0) {
  const latest = distros[0];
  const { data: recentPayouts } = await supabase
    .from('holder_distribution_payouts')
    .select('wallet, share_lamports, status')
    .eq('distribution_id', latest.id)
    .order('share_lamports', { ascending: false });

  console.log(`MOST RECENT DISTRIBUTION (${latest.epoch_date}) — TOP 10 SHARES:`);
  const rTotal = (recentPayouts || []).reduce((s, p) => s + Number(p.share_lamports || 0), 0);
  for (let i = 0; i < Math.min(10, (recentPayouts || []).length); i++) {
    const p = recentPayouts[i];
    const pct = (Number(p.share_lamports) / rTotal * 100).toFixed(1);
    console.log(`  ${String(i + 1).padStart(2)}. ${p.wallet}  ${fmt(p.share_lamports).padEnd(14)}  ${pct.padStart(5)}%  ${p.status}`);
  }
  const sentCount = (recentPayouts || []).filter(p => p.status === 'sent').length;
  const pendingCount = (recentPayouts || []).filter(p => p.status === 'pending').length;
  const failedCount = (recentPayouts || []).filter(p => p.status !== 'sent' && p.status !== 'pending').length;
  console.log(`\n  Round ${latest.epoch_date}: ${sentCount} sent, ${pendingCount} pending, ${failedCount} other`);
  console.log();
}

// 6. Pending balances — wallets accumulating below dust floor
const { data: pendingBal } = await supabase
  .from('holder_pending_balances')
  .select('wallet, pending_lamports, total_paid_lamports, payout_count')
  .gt('pending_lamports', 0)
  .order('pending_lamports', { ascending: false })
  .limit(10);

console.log(`TOP 10 WALLETS WITH PENDING (below dust floor, accumulating):`);
for (const p of pendingBal || []) {
  console.log(`  ${p.wallet}  pending: ${fmt(p.pending_lamports).padEnd(14)}  lifetime: ${fmt(p.total_paid_lamports)} (${p.payout_count} payouts)`);
}
console.log();

// 7. Anyone with 0 payouts despite being a real holder
const { count: pendingWithZero } = await supabase
  .from('holder_pending_balances')
  .select('*', { count: 'exact', head: true })
  .eq('total_paid_lamports', 0);
console.log(`WALLETS WITH ZERO LIFETIME PAYOUTS (accumulating but never crossed floor): ${pendingWithZero || 0}`);
