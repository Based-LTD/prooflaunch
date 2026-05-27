#!/usr/bin/env node
// proof-distribute-fees.mjs — one-shot manual collect+distribute for PROOF.
//
// Why this exists: PROOF (mint oaBXM2…pooL) launched on the legacy
// shared-escrow path, not with a per-coin sub-escrow. So distribution.ts
// (which expects creator_subescrow_pubkey in DB) skips it on every cron
// tick. We have to collect + split + credit by hand. Once.
//
// On-chain creator = the shared platform escrow `83u1Mra…`, whose key is
// ESCROW_WALLET_PRIVATE_KEY. The SDK's collectCoinCreatorFeeInstructions
// handles both the BC native vault and the AMM wSOL vault in one tx
// (auto-unwraps wSOL → native into the creator wallet).
//
// Default mode: DRY RUN — prints exactly what would happen, broadcasts
// nothing. Pass --execute to actually send.
//
// Distribution decided 2026-05-23:
//   55.91 SOL → slot 1 wallet (EsA8NH858…) — covers slot 1 pro-rata
//               (46.59) + slot 4 pro-rata (3.11) + platform 10% (6.21)
//   Slot 2 + 3 share (~6.22 SOL): PHYSICALLY RETAINED in escrow wallet,
//                       but NOT credited to claimable_fees_sol yet.
//                       User wants to talk to those backers first before
//                       making the credit visible in their UI. Manual
//                       credit later via DB update when ready.
//
// Slots 1 + 4 get fee_claims audit rows + total_claimed_sol bumped.

import { readFileSync } from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const {
  Connection, PublicKey, Keypair, Transaction, SystemProgram,
  ComputeBudgetProgram,
} = require('@solana/web3.js');
const { createClient } = require('@supabase/supabase-js');
const { OnlinePumpSdk } = require('@pump-fun/pump-sdk');
const bs58 = require('bs58').default || require('bs58');

// ── config ─────────────────────────────────────────────────────────────
const EXECUTE = process.argv.includes('--execute');
const PROOF_MINT = 'oaBXM2rCnWFeQc9ufdTSSpASwSrMBPrSmg8xtiepooL';
const PROOF_CREATOR_EXPECTED = '83u1MraLPeq3ZqGo4GKqeg5FLk6YpSR7H7GcgZc2s9Ko';
const SLOT_1_WALLET = 'EsA8NH8588FFdhUzvxPUn9bPzr8rZi9nPz5E136bLAir';
const SLOT_4_WALLET = 'CZnvVTTutAF7QTh5reQqRHE5i8J9cm1CWwaiQXi3QaXm';
const SLOT_2_WALLET = '88tFn44cCLvSgvcKnHDHckC8ExyjLXviDvghx45d2unu';
const SLOT_3_WALLET = 'GcqU3n56FMvkfy3uQtem7THPvBHpr2W3fGEsh9PCqab5';
const PLATFORM_CUT_PCT = 0.10;        // total non-backer cut
const HOLDER_REWARDS_PCT = 0.05;      // half of platform cut routes to holder airdrop pool
// Platform retention = PLATFORM_CUT_PCT - HOLDER_REWARDS_PCT = 5%
const TOTAL_STAKE_SOL = 1.8; // 1.5 + 0.1 + 0.1 + 0.1

// PROOF uses hold-weighted distribution (2026-05-24 onward). Each backer's
// pro-rata share is multiplied by their current hold % (capped 100%).
// Freed-up shares from dumpers flow entirely to HOLDER_REWARDS_WALLET.
const USE_HOLD_WEIGHTED = true;

// ── DEV-FEE-FORGO OVERRIDE (OFF by default) ──────────────────────────
// Optional bonus mode: when true, the founder's slot 1 hold-weighted
// share is redirected entirely to HOLDER_REWARDS_WALLET instead of
// being sent to the slot 1 wallet. Useful for one-off "holder bonus"
// distributions or surprise dev-share-forgo runs.
//
// Default is FALSE — standard distribution (slot 1 share to slot 1
// wallet, 5% to holders, freed shares to holders). The standard model
// already sends a meaningful portion to holders and is sustainable for
// ops; only flip this when doing a deliberate community-bonus run.
const REDIRECT_SLOT1_TO_HOLDERS = false;

const SLOT_1_STAKE = 1.5;
const SLOT_4_STAKE = 0.1;
const SLOT_2_STAKE = 0.1;
const SLOT_3_STAKE = 0.1;

// ── env ────────────────────────────────────────────────────────────────
const env = Object.fromEntries(
  readFileSync(new URL('./.env.local', import.meta.url), 'utf-8')
    .split('\n').filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const RPC = env.NEXT_PUBLIC_SOLANA_RPC_URL;
const conn = new Connection(RPC, 'confirmed');
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const escrow = Keypair.fromSecretKey(bs58.decode(env.ESCROW_WALLET_PRIVATE_KEY));
if (escrow.publicKey.toBase58() !== PROOF_CREATOR_EXPECTED) {
  console.error(`✗ Safety gate: escrow pubkey ${escrow.publicKey.toBase58()} != expected creator ${PROOF_CREATOR_EXPECTED}`);
  process.exit(1);
}

// Holder rewards wallet — receives 5% of every collection for the daily airdrop pool
if (!env.HOLDER_REWARDS_WALLET_ADDRESS) {
  console.error('✗ HOLDER_REWARDS_WALLET_ADDRESS not set in .env.local');
  process.exit(1);
}
const HOLDER_REWARDS_WALLET = env.HOLDER_REWARDS_WALLET_ADDRESS;

const sdk = new OnlinePumpSdk(conn);
const PUMPSWAP_AMM = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
const { getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const [AMM_VAULT_AUTH] = PublicKey.findProgramAddressSync(
  [Buffer.from('creator_vault'), escrow.publicKey.toBuffer()],
  PUMPSWAP_AMM,
);
const AMM_VAULT_WSOL_ATA = getAssociatedTokenAddressSync(NATIVE_MINT, AMM_VAULT_AUTH, true, TOKEN_PROGRAM_ID);

console.log('═══════════════════════════════════════════════════════════');
console.log('PROOF MANUAL FEE DISTRIBUTION');
console.log(`MODE: ${EXECUTE ? '🔴 EXECUTE — txs will broadcast' : '🟢 DRY RUN — no broadcast'}`);
console.log('═══════════════════════════════════════════════════════════\n');

// ── pre-flight balances ────────────────────────────────────────────────
async function readVaults() {
  const [bcLam, ammAtaInfo, escrowLam, slot1Lam] = await Promise.all([
    sdk.getCreatorVaultBalance(escrow.publicKey).then(bn => Number(bn.toString())),
    conn.getAccountInfo(AMM_VAULT_WSOL_ATA, 'confirmed'),
    conn.getBalance(escrow.publicKey, 'confirmed'),
    conn.getBalance(new PublicKey(SLOT_1_WALLET), 'confirmed'),
  ]);
  const ammLam = ammAtaInfo && ammAtaInfo.data.length >= 72
    ? Number(ammAtaInfo.data.readBigUInt64LE(64)) : 0;
  return { bcLam, ammLam, escrowLam, slot1Lam };
}

const pre = await readVaults();
const totalCollectableLam = pre.bcLam + pre.ammLam;
const totalCollectableSol = totalCollectableLam / 1e9;

console.log('PRE-FLIGHT BALANCES:');
console.log(`  BC creator-vault:      ${(pre.bcLam / 1e9).toFixed(6)} SOL`);
console.log(`  AMM wSOL ATA:          ${(pre.ammLam / 1e9).toFixed(6)} SOL`);
console.log(`  → Total collectable:   ${totalCollectableSol.toFixed(6)} SOL`);
console.log(`  Escrow native balance: ${(pre.escrowLam / 1e9).toFixed(6)} SOL`);
console.log(`  Slot 1 wallet:         ${(pre.slot1Lam / 1e9).toFixed(6)} SOL\n`);

// ── meme + backings refs (need tokens_received for hold % math) ────────
const { data: meme } = await sb.from('memes').select('id').eq('mint_address', PROOF_MINT).single();
const { data: backings } = await sb.from('backings')
  .select('id, slot_number, backer_wallet, amount_sol, claimable_fees_sol, total_claimed_sol, tokens_received')
  .eq('meme_id', meme.id)
  .in('slot_number', [1, 2, 3, 4])
  .eq('status', 'distributed');

// ── compute hold % per backer (direct + Streamflow-locked, capped 100%) ─
// Used only when USE_HOLD_WEIGHTED = true. PROOF is now hold-weighted (2026-05-24).
async function holdPctFor(backer) {
  if (!USE_HOLD_WEIGHTED) return 1.0;
  const allocated = BigInt(backer.tokens_received || '0');
  if (allocated === BigInt(0)) return 0;
  const owner = new PublicKey(backer.backer_wallet);
  const mint = new PublicKey(PROOF_MINT);
  // Direct wallet balance
  let directRaw = BigInt(0);
  try {
    const accts = await conn.getParsedTokenAccountsByOwner(owner, { mint });
    directRaw = accts.value.reduce((s, a) => s + BigInt(a.account.data.parsed.info.tokenAmount.amount || '0'), BigInt(0));
  } catch { /* fail-closed: zero share */ return 0; }
  // Streamflow-locked (same pattern as Roster)
  let lockedRaw = BigInt(0);
  try {
    const { SolanaStreamClient, ICluster } = require('@streamflow/stream');
    const streamClient = new SolanaStreamClient(env.NEXT_PUBLIC_SOLANA_RPC_URL, ICluster.Mainnet, 'confirmed');
    const streams = await streamClient.searchStreams({ mint: PROOF_MINT, sender: backer.backer_wallet });
    if (streams && streams.length > 0) {
      const lockBals = await Promise.all(streams.map(async (s) => {
        try {
          const raw = s.account?.escrowTokens;
          if (!raw) return BigInt(0);
          const pk = typeof raw === 'string' ? new PublicKey(raw) : new PublicKey(raw.toBase58 ? raw.toBase58() : raw);
          const info = await conn.getAccountInfo(pk);
          if (!info) return BigInt(0);
          return info.data.readBigUInt64LE(64);
        } catch { return BigInt(0); }
      }));
      lockedRaw = lockBals.reduce((s, x) => s + x, BigInt(0));
    }
  } catch { /* no streams */ }
  const effective = directRaw + lockedRaw;
  const rawPct = Number((effective * BigInt(10_000)) / allocated) / 10_000;
  return Math.min(1.0, rawPct);
}

console.log('CURRENT BACKER HOLD % (hold_weighted distribution):');
const holdPcts = {};
for (const b of backings.sort((a, b) => a.slot_number - b.slot_number)) {
  holdPcts[b.id] = await holdPctFor(b);
  console.log(`  Slot ${b.slot_number} (${b.backer_wallet.slice(0, 12)}…): hold ${(holdPcts[b.id] * 100).toFixed(2)}%`);
}
console.log();

// ── distribution math: hold-weighted with 100% freed → holder rewards ──
const backerPoolLam = totalCollectableLam - Math.floor(totalCollectableLam * PLATFORM_CUT_PCT);
const platformBaseLam = Math.floor(totalCollectableLam * (PLATFORM_CUT_PCT - HOLDER_REWARDS_PCT)); // 5%
const holderRewardsBaseLam = totalCollectableLam - backerPoolLam - platformBaseLam;               // 5%

// Per-slot effective share = stakeFrac × holdPct × backerPoolLam
const stakeFrac = {};
const slot1B = backings.find(b => b.slot_number === 1);
const slot2B = backings.find(b => b.slot_number === 2);
const slot3B = backings.find(b => b.slot_number === 3);
const slot4B = backings.find(b => b.slot_number === 4);
stakeFrac[slot1B.id] = SLOT_1_STAKE / TOTAL_STAKE_SOL;
stakeFrac[slot2B.id] = SLOT_2_STAKE / TOTAL_STAKE_SOL;
stakeFrac[slot3B.id] = SLOT_3_STAKE / TOTAL_STAKE_SOL;
stakeFrac[slot4B.id] = SLOT_4_STAKE / TOTAL_STAKE_SOL;

const slot1ShareLam = Math.floor(stakeFrac[slot1B.id] * holdPcts[slot1B.id] * backerPoolLam);
const slot4ShareLam = Math.floor(stakeFrac[slot4B.id] * holdPcts[slot4B.id] * backerPoolLam);
const slot2ShareLam = Math.floor(stakeFrac[slot2B.id] * holdPcts[slot2B.id] * backerPoolLam);
const slot3ShareLam = Math.floor(stakeFrac[slot3B.id] * holdPcts[slot3B.id] * backerPoolLam);
const totalEffectiveLam = slot1ShareLam + slot2ShareLam + slot3ShareLam + slot4ShareLam;
const freedLam = backerPoolLam - totalEffectiveLam;

// All freed shares flow to HOLDER_REWARDS_WALLET.
// Per dev-fee-forgo policy, slot 1's hold-weighted share ALSO routes to
// HOLDER_REWARDS_WALLET when REDIRECT_SLOT1_TO_HOLDERS is true.
const redirectedSlot1Lam = REDIRECT_SLOT1_TO_HOLDERS ? slot1ShareLam : 0;
const holderRewardsLam = holderRewardsBaseLam + freedLam + redirectedSlot1Lam;

// User wallet receives: slot 4 weighted + platform 5% (+ slot 1 if NOT redirecting)
const sendToSlot1Lam = (REDIRECT_SLOT1_TO_HOLDERS ? 0 : slot1ShareLam) + slot4ShareLam + platformBaseLam;

console.log('SPLIT (hold-weighted):');
console.log(`  Backer pool (90%):     ${(backerPoolLam / 1e9).toFixed(6)} SOL`);
const slot1Tag = REDIRECT_SLOT1_TO_HOLDERS ? '→ HOLDER_REWARDS_WALLET (dev-fee-forgo)' : '→ slot 1 wallet';
console.log(`    Slot 1 (83.33% × ${(holdPcts[slot1B.id]*100).toFixed(1)}%):  ${(slot1ShareLam / 1e9).toFixed(6)} SOL ${slot1Tag}`);
console.log(`    Slot 4 ( 5.56% × ${(holdPcts[slot4B.id]*100).toFixed(1)}%):  ${(slot4ShareLam / 1e9).toFixed(6)} SOL → slot 1 wallet (platform)`);
console.log(`    Slot 2 ( 5.56% × ${(holdPcts[slot2B.id]*100).toFixed(1)}%):  ${(slot2ShareLam / 1e9).toFixed(6)} SOL → DB credit`);
console.log(`    Slot 3 ( 5.56% × ${(holdPcts[slot3B.id]*100).toFixed(1)}%):  ${(slot3ShareLam / 1e9).toFixed(6)} SOL → DB credit`);
console.log(`    Freed (dumpers):     ${(freedLam / 1e9).toFixed(6)} SOL → HOLDER_REWARDS_WALLET`);
console.log(`  Platform 5%:           ${(platformBaseLam / 1e9).toFixed(6)} SOL → slot 1 wallet`);
console.log(`  Holder rewards 5%:     ${(holderRewardsBaseLam / 1e9).toFixed(6)} SOL → HOLDER_REWARDS_WALLET`);
console.log(`  ────────`);
console.log(`  → SEND TO SLOT 1 WALLET:        ${(sendToSlot1Lam / 1e9).toFixed(6)} SOL`);
console.log(`  → SEND TO HOLDER REWARDS WALLET: ${(holderRewardsLam / 1e9).toFixed(6)} SOL`);
console.log(`     = base 5% (${(holderRewardsBaseLam/1e9).toFixed(4)}) + freed (${(freedLam/1e9).toFixed(4)})` + (REDIRECT_SLOT1_TO_HOLDERS ? ` + dev slot 1 share (${(redirectedSlot1Lam/1e9).toFixed(4)})` : ''));
console.log(`  → CREDIT SLOTS 2 & 3 IN DB:      ${((slot2ShareLam + slot3ShareLam) / 1e9).toFixed(6)} SOL`);
if (REDIRECT_SLOT1_TO_HOLDERS) {
  console.log(`\n  💎 DEV-FEE-FORGO ACTIVE: slot 1 share routed to holders, not slot 1 wallet.`);
}
console.log();

console.log('CURRENT DB STATE:');
for (const b of backings.sort((a, b) => a.slot_number - b.slot_number)) {
  console.log(`  Slot ${b.slot_number} (${b.backer_wallet.slice(0, 12)}…): claimable=${Number(b.claimable_fees_sol).toFixed(6)}  claimed=${Number(b.total_claimed_sol).toFixed(6)}`);
}
console.log();

// ── safety gate ────────────────────────────────────────────────────────
// Floor at 0.1 SOL — well above gas-cost economics, allows smaller-cadence
// manual collects without bailing on legit accruals.
if (totalCollectableLam < 1e8) {
  console.log(`⚠ Total collectable < 0.1 SOL. Did fees already get pulled? Bailing.`);
  process.exit(0);
}

if (!EXECUTE) {
  console.log('🟢 DRY RUN complete. Nothing was broadcast.');
  console.log('   Re-run with `--execute` to broadcast.');
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────────────────
// EXECUTE PATH (only reached with --execute)
// ─────────────────────────────────────────────────────────────────────────
console.log('🔴 EXECUTING…\n');

// Step 1: collect BC + AMM in one tx (SDK builds both)
console.log('Step 1: collect_coin_creator_fee (BC + AMM)…');
const collectIxs = await sdk.collectCoinCreatorFeeInstructions(escrow.publicKey, escrow.publicKey);
const collectTx = new Transaction()
  .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }))
  .add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }))
  .add(...collectIxs);
collectTx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
collectTx.feePayer = escrow.publicKey;
const collectSig = await conn.sendTransaction(collectTx, [escrow]);
console.log(`   collect sig: ${collectSig}`);
console.log(`   confirming…`);
await conn.confirmTransaction(collectSig, 'confirmed');
console.log(`   ✓ confirmed`);

// Step 2: verify escrow balance grew by ~the collected amount
const postCollect = await conn.getBalance(escrow.publicKey, 'confirmed');
const collectedActualLam = postCollect - pre.escrowLam;
console.log(`   Escrow grew by ${(collectedActualLam / 1e9).toFixed(6)} SOL`);
if (collectedActualLam < totalCollectableLam * 0.95) {
  console.error(`   ⚠ Collected less than 95% of expected. Aborting transfer step.`);
  process.exit(1);
}

// Step 3: ONE tx: transfer to slot 1 wallet + transfer to holder rewards wallet
console.log(`\nStep 2: transfer ${(sendToSlot1Lam / 1e9).toFixed(6)} SOL → slot 1 AND ${(holderRewardsLam / 1e9).toFixed(6)} SOL → holder rewards wallet`);
const transferTx = new Transaction()
  .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 150_000 }))
  .add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }))
  .add(SystemProgram.transfer({
    fromPubkey: escrow.publicKey,
    toPubkey: new PublicKey(SLOT_1_WALLET),
    lamports: sendToSlot1Lam,
  }))
  .add(SystemProgram.transfer({
    fromPubkey: escrow.publicKey,
    toPubkey: new PublicKey(HOLDER_REWARDS_WALLET),
    lamports: holderRewardsLam,
  }));
transferTx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
transferTx.feePayer = escrow.publicKey;
const transferSig = await conn.sendTransaction(transferTx, [escrow]);
console.log(`   transfer sig: ${transferSig}`);
await conn.confirmTransaction(transferSig, 'confirmed');
console.log(`   ✓ confirmed`);

// Step 4: DB updates — ONLY for slots 1 & 4 (paid out).
// Slots 2 & 3 deliberately left untouched in DB — their share sits in
// escrow but they see claimable=0 in the UI until you decide to credit.
console.log(`\nStep 3: DB updates (slots 1 & 4 only — slots 2 & 3 left untouched per your call)`);

// Per-slot audit rows. When dev-fee-forgo is active, slot 1 does NOT
// get credited (those fees never reached slot 1 wallet — they went to
// HOLDER_REWARDS_WALLET). Slot 4 is always credited (platform stake).
const slot1Audit = REDIRECT_SLOT1_TO_HOLDERS
  ? [] // skip: fees redirected to holders
  : [[SLOT_1_WALLET, slot1ShareLam, 1]];
const auditRows = [...slot1Audit, [SLOT_4_WALLET, slot4ShareLam, 4]];

for (const [wallet, lam, slot] of auditRows) {
  const row = backings.find(b => b.backer_wallet === wallet);
  const newClaimed = Number(row.total_claimed_sol || 0) + lam / 1e9;
  const { error: updErr } = await sb.from('backings')
    .update({ total_claimed_sol: newClaimed })
    .eq('id', row.id);
  if (updErr) console.error(`   ✗ slot ${slot} bump failed:`, updErr);
  else console.log(`   ✓ slot ${slot} total_claimed += ${(lam / 1e9).toFixed(6)} (new total = ${newClaimed.toFixed(6)})`);

  // fee_claims schema uses wallet_address (not backer_wallet) + status (not source)
  const { error: claimErr } = await sb.from('fee_claims').insert({
    meme_id: meme.id,
    wallet_address: wallet,
    amount_sol: lam / 1e9,
    claim_tx: transferSig,
    status: 'completed',
    completed_at: new Date().toISOString(),
  });
  if (claimErr) console.error(`   ✗ fee_claims insert for slot ${slot} failed:`, claimErr);
  else console.log(`   ✓ fee_claims row inserted for slot ${slot}`);
}

if (REDIRECT_SLOT1_TO_HOLDERS) {
  console.log(`   ⏭  slot 1 audit row SKIPPED — ${(slot1ShareLam / 1e9).toFixed(6)} SOL redirected to HOLDER_REWARDS_WALLET (dev-fee-forgo policy)`);
}

// Also credit slots 2 & 3 in DB now (per our 2026-05-23 decision —
// honoring the public 90/10 promise on the website roster)
console.log(`\nStep 4: credit slots 2 & 3 claimable_fees_sol`);
for (const [wallet, lam, slot] of [[SLOT_2_WALLET, slot2ShareLam, 2], [SLOT_3_WALLET, slot3ShareLam, 3]]) {
  const row = backings.find(b => b.backer_wallet === wallet);
  const newClaimable = Number(row.claimable_fees_sol || 0) + lam / 1e9;
  const { error } = await sb.from('backings')
    .update({ claimable_fees_sol: newClaimable })
    .eq('id', row.id);
  if (error) console.error(`   ✗ slot ${slot} credit failed:`, error);
  else console.log(`   ✓ slot ${slot} claimable += ${(lam / 1e9).toFixed(6)} (new claimable = ${newClaimable.toFixed(6)})`);
}

console.log('\n═══════════════════════════════════════════════════════════');
console.log('✓ DONE');
console.log(`  collect_tx:  https://solscan.io/tx/${collectSig}`);
console.log(`  transfer_tx: https://solscan.io/tx/${transferSig}`);
console.log(`  ${(sendToSlot1Lam / 1e9).toFixed(6)} SOL → slot 1 wallet (slot 4 platform + platform 5%)`);
console.log(`  ${(holderRewardsLam / 1e9).toFixed(6)} SOL → HOLDER_REWARDS_WALLET (airdrop pool)`);
if (REDIRECT_SLOT1_TO_HOLDERS) {
  console.log(`     ↑ includes ${(redirectedSlot1Lam / 1e9).toFixed(6)} SOL of dev slot 1 share, redirected per dev-fee-forgo policy`);
}
console.log(`  ${((slot2ShareLam + slot3ShareLam) / 1e9).toFixed(6)} SOL → escrow, credited to slots 2 & 3`);
console.log('═══════════════════════════════════════════════════════════');
