#!/usr/bin/env node
// audit-escrow-pnl.mjs — Forensic P&L for the Solana platform escrow since a
// given date. Answers: is the insolvency real, where exactly did the SOL go,
// and is the model self-feeding at current volume?
//
// Categorizes every escrow tx by counterparty:
//   IN:  fee drains (sub-escrow → escrow), submission fees, founder top-ups
//   OUT: backer fee claims (liability-reducing — NOT a loss),
//        holder-rewards transfers, launch spends, gas fees, unknown
//
//   node tools/audit-escrow-pnl.mjs [since-iso, default 2026-09-01]

import { readFileSync } from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { createClient } = require('@supabase/supabase-js');
const { Connection, PublicKey } = require('@solana/web3.js');

const envText = readFileSync('.env.local', 'utf8');
const env = Object.fromEntries(envText.split('\n').filter(l => l && !l.startsWith('#') && l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const conn = new Connection(env.NEXT_PUBLIC_SOLANA_RPC_URL, 'confirmed');
const L = 1e9;

const ESCROW = new PublicKey('DRwYbZuhD8VLvgU18TKx4jm8rZaoUudoMQQzuziGqnrx');
const HR = env.HOLDER_REWARDS_WALLET_ADDRESS;
const SINCE = new Date(process.argv[2] || '2026-09-01T00:00:00Z').getTime() / 1000;

// Build classification sets from the DB
const { data: memes } = await supabase.from('memes').select('symbol, creator_subescrow_pubkey, pool_wallet, creator_wallet');
const subEscrows = new Map(); // pubkey -> symbol
const poolWallets = new Map();
for (const m of memes || []) {
  if (m.creator_subescrow_pubkey) subEscrows.set(m.creator_subescrow_pubkey, m.symbol);
  if (m.pool_wallet) poolWallets.set(m.pool_wallet, m.symbol);
}
const { data: backRows } = await supabase.from('backings').select('backer_wallet');
const backerWallets = new Set((backRows || []).map(b => b.backer_wallet));

// Current DB liability
let owed = 0, page = 0;
while (true) {
  const { data } = await supabase.from('backings').select('claimable_fees_sol').gt('claimable_fees_sol', 0).order('id').range(page * 1000, page * 1000 + 999);
  if (!data?.length) break;
  for (const r of data) owed += Number(r.claimable_fees_sol);
  if (data.length < 1000) break; page++;
}

// Pull escrow signatures back to SINCE
const sigs = [];
let before;
while (true) {
  const batch = await conn.getSignaturesForAddress(ESCROW, { limit: 500, before });
  if (!batch.length) break;
  sigs.push(...batch.filter(s => (s.blockTime || 0) >= SINCE));
  if ((batch[batch.length - 1].blockTime || 0) < SINCE) break;
  before = batch[batch.length - 1].signature;
  if (sigs.length > 4000) { console.log('(capped at 4000 sigs)'); break; }
}
console.log(`Escrow txs since ${new Date(SINCE * 1000).toISOString().slice(0, 10)}: ${sigs.length}\n`);

const buckets = {
  in_drains: 0, in_submissions: 0, in_topups: 0, in_other: 0,
  out_claims: 0, out_hr: 0, out_launch: 0, out_other: 0,
  gas_fees: 0,
};
let counts = { drains: 0, claims: 0, hr: 0, gasonly: 0, launch: 0, other_in: 0, other_out: 0 };
const unknownOut = new Map();
const flows = new Map(); // counterparty -> NET lamports (in positive)

let done = 0;
for (const s of sigs) {
  if (s.err) continue;
  let tx;
  try { tx = await conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0 }); } catch { continue; }
  if (!tx?.meta) continue;
  done++;
  const keys = tx.transaction.message.staticAccountKeys || tx.transaction.message.getAccountKeys?.().staticAccountKeys || [];
  const idx = keys.findIndex(k => k.equals(ESCROW));
  if (idx < 0) continue;
  const delta = (tx.meta.postBalances[idx] || 0) - (tx.meta.preBalances[idx] || 0);
  const feePaidByEscrow = idx === 0 ? tx.meta.fee : 0; // escrow as feePayer
  buckets.gas_fees += feePaidByEscrow;

  // net movement excluding the fee it paid
  const moved = delta + feePaidByEscrow;

  if (moved > 1000) {
    // inflow: who lost?
    let src = null, biggest = 0;
    for (let i = 0; i < keys.length; i++) {
      if (i === idx) continue;
      const d = (tx.meta.postBalances[i] || 0) - (tx.meta.preBalances[i] || 0);
      if (d < biggest) { biggest = d; src = keys[i].toBase58(); }
    }
    if (src && subEscrows.has(src)) { buckets.in_drains += moved; counts.drains++; }
    else if (moved === 20_000_000) { buckets.in_submissions += moved; }
    else if (moved > 500_000_000) { buckets.in_topups += moved; }
    else { buckets.in_other += moved; counts.other_in++; if (src) flows.set(src, (flows.get(src) || 0) + moved); }
  } else if (moved < -1000) {
    // outflow: who gained?
    let dst = null, biggest = 0;
    for (let i = 0; i < keys.length; i++) {
      if (i === idx) continue;
      const d = (tx.meta.postBalances[i] || 0) - (tx.meta.preBalances[i] || 0);
      if (d > biggest) { biggest = d; dst = keys[i].toBase58(); }
    }
    const amt = -moved;
    if (dst === HR) { buckets.out_hr += amt; counts.hr++; }
    else if (dst && backerWallets.has(dst)) { buckets.out_claims += amt; counts.claims++; }
    else if (dst && (poolWallets.has(dst) || subEscrows.has(dst))) { buckets.out_launch += amt; counts.launch++; }
    else {
      buckets.out_other += amt; counts.other_out++;
      if (dst) { unknownOut.set(dst, (unknownOut.get(dst) || 0) + amt); flows.set(dst, (flows.get(dst) || 0) - amt); }
    }
  } else {
    counts.gasonly++; // fee-only tx (escrow was feePayer for someone else's movement)
  }
}

const bal = await conn.getBalance(ESCROW);
console.log('=== LEDGER (SOL) ===');
console.log('IN   fee drains from sub-escrows:', (buckets.in_drains / L).toFixed(4), `(${counts.drains} txs)`);
console.log('IN   submission fees:            ', (buckets.in_submissions / L).toFixed(4));
console.log('IN   top-ups (>0.5):             ', (buckets.in_topups / L).toFixed(4));
console.log('IN   other:                      ', (buckets.in_other / L).toFixed(4), `(${counts.other_in} txs)`);
console.log('OUT  backer claims (reduce owed):', (buckets.out_claims / L).toFixed(4), `(${counts.claims} txs)`);
console.log('OUT  holder-rewards transfers:   ', (buckets.out_hr / L).toFixed(4), `(${counts.hr} txs)`);
console.log('OUT  launches (pool/sub funding):', (buckets.out_launch / L).toFixed(4), `(${counts.launch} txs)`);
console.log('OUT  other/unknown:              ', (buckets.out_other / L).toFixed(4), `(${counts.other_out} txs)`);
console.log('GAS  total tx fees paid by escrow:', (buckets.gas_fees / L).toFixed(4), `(across ${done} txs, ${counts.gasonly} fee-only)`);
if (unknownOut.size) {
  console.log('\nUnknown counterparties by NET flow (negative = true net outflow):');
  let churn = 0, trueOut = 0;
  for (const [a, net] of [...flows.entries()].sort((x, y) => x[1] - y[1])) {
    if (Math.abs(net) < 3_000_000) { churn += unknownOut.get(a) || 0; continue; } // rent churn, nets ~0
    console.log('  ', a, 'net', (net / L).toFixed(4), 'SOL');
    if (net < 0) trueOut += -net;
  }
  console.log('   rent/ATA churn (gross out that returned):', (churn / L).toFixed(4), 'SOL — net ~0');
  console.log('   TRUE net unknown outflow:', (trueOut / L).toFixed(4), 'SOL');
}
console.log('\n=== SOLVENCY ===');
console.log('escrow balance:', (bal / L).toFixed(4), ' owed to backers:', owed.toFixed(4), ' surplus:', (bal / L - owed).toFixed(4));

console.log('\n=== SELF-FEEDING MATH (period) ===');
const days = (Date.now() / 1000 - SINCE) / 86400;
const platformIncome = buckets.in_drains * 0.05 + buckets.in_submissions; // 5% of drains is platform's share of what came in
const opsCost = buckets.gas_fees;
console.log(`period: ${days.toFixed(1)} days`);
console.log(`drains in: ${(buckets.in_drains / L).toFixed(4)} → platform 5% cut ≈ ${(platformIncome / L).toFixed(4)}`);
console.log(`gas out: ${(opsCost / L).toFixed(4)}  (${(opsCost / L / days).toFixed(4)}/day)`);
console.log(`net platform P&L: ${((platformIncome - opsCost) / L).toFixed(4)} SOL`);
console.log(`breakeven needs drains ≥ ${(opsCost / 0.05 / L).toFixed(3)} SOL/period (${(opsCost / 0.05 / L / days).toFixed(3)}/day)`);
