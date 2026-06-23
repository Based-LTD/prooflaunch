#!/usr/bin/env node
// Verify the 1 bps / 9999 bps split that our adapter uses works when both
// wallets are real on-chain accounts. Funds a fresh "fake sub-escrow"
// with rent-exempt minimum first so it has an on-chain footprint, then
// retries the same fee-share/config call.

import { readFileSync } from 'fs';
import { Connection, Keypair, SystemProgram, Transaction, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';

const env = readFileSync('.env.local', 'utf-8');
const g = (k) => env.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.replace(/^["']|["']$/g, '');
const gBs58 = (k) => g(k)?.replace(/\\n/g, '').trim();

const BAGS_API_KEY = g('BAGS_API_KEY');
const BASE = 'https://public-api-v2.bags.fm/api/v1';
const conn = new Connection(g('NEXT_PUBLIC_SOLANA_RPC_URL') || 'https://api.mainnet-beta.solana.com', 'confirmed');

const escrowKp = Keypair.fromSecretKey(bs58.decode(gBs58('ESCROW_WALLET_PRIVATE_KEY')));
const fakeSubKp = Keypair.generate();

console.log(`Escrow (payer):       ${escrowKp.publicKey.toBase58()}`);
console.log(`Fresh sub-escrow:     ${fakeSubKp.publicKey.toBase58()}`);

// Step 0: fund the sub-escrow with rent-exempt minimum (~0.00089 SOL).
// This is the proposed "tiny pre-fund step" we'd bake into the launch
// flow if this probe confirms the model.
const RENT_LAMPORTS = 1_500_000; // a bit over rent-exempt min for safety
console.log(`\n[0] Funding sub-escrow with ${RENT_LAMPORTS} lamports from escrow...`);
const fundTx = new Transaction().add(SystemProgram.transfer({
  fromPubkey: escrowKp.publicKey, toPubkey: fakeSubKp.publicKey, lamports: RENT_LAMPORTS,
}));
fundTx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
fundTx.feePayer = escrowKp.publicKey;
const fundSig = await conn.sendTransaction(fundTx, [escrowKp]);
await conn.confirmTransaction(fundSig, 'confirmed');
console.log(`     funded: ${fundSig}`);
console.log(`     sub-escrow balance now: ${await conn.getBalance(fakeSubKp.publicKey)} lamports`);

// Step 1: token-info
const form = new FormData();
form.set('name', 'PROOFLAUNCH_DRY_RUN_3');
form.set('symbol', 'PLDR3');
form.set('description', 'Probe 3 — verify 2-claimer with pre-funded sub-escrow.');
form.set('imageUrl', 'https://prooflaunch.fun/icon.png');
const r1 = await fetch(`${BASE}/token-launch/create-token-info`, {
  method: 'POST', headers: { 'x-api-key': BAGS_API_KEY }, body: form,
});
const env1 = await r1.json();
const tokenMint = env1.response?.tokenMint;
console.log(`\n[1] token-info: HTTP ${r1.status}  tokenMint=${tokenMint}`);

// Step 2: fee-share/config with the EXACT 1 bps / 9999 bps split our
// adapter uses, both wallets are real now.
console.log(`\n[2] fee-share/config (escrow 1 bps, sub-escrow 9999 bps)...`);
const r2 = await fetch(`${BASE}/fee-share/config`, {
  method: 'POST',
  headers: { 'x-api-key': BAGS_API_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    payer: escrowKp.publicKey.toBase58(),
    baseMint: tokenMint,
    claimersArray: [escrowKp.publicKey.toBase58(), fakeSubKp.publicKey.toBase58()],
    basisPointsArray: [1, 9999],
  }),
});
const t2 = await r2.text();
console.log(`    HTTP ${r2.status}`);
if (r2.ok) {
  const env2 = JSON.parse(t2);
  console.log(`    ✓ meteoraConfigKey:   ${env2.response.meteoraConfigKey}`);
  console.log(`    ✓ feeShareAuthority:  ${env2.response.feeShareAuthority}`);
  console.log(`    ✓ needsCreation:      ${env2.response.needsCreation}`);
  console.log(`    ✓ transactions:       ${env2.response.transactions?.length} returned`);
  console.log(`\n🟢 The 1bps/9999bps two-claimer model WORKS with real on-chain wallets.`);
  console.log(`   Adapter needs a pre-fund step (sub-escrow ← ~0.002 SOL from escrow)`);
  console.log(`   before calling fee-share/config. Then the existing logic runs.\n`);
} else {
  console.log(`    body[:500]=${t2.slice(0, 500)}`);
  console.log(`\n⚠️ Still failing. Need more investigation.\n`);
}

// Sweep the rent back to escrow so this test doesn't leave dust around.
console.log(`Cleanup: sweeping sub-escrow back to escrow...`);
const bal = await conn.getBalance(fakeSubKp.publicKey);
if (bal > 5_000) {
  const sweepTx = new Transaction().add(SystemProgram.transfer({
    fromPubkey: fakeSubKp.publicKey, toPubkey: escrowKp.publicKey, lamports: bal - 5_000,
  }));
  sweepTx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  sweepTx.feePayer = fakeSubKp.publicKey;
  const sweepSig = await conn.sendTransaction(sweepTx, [fakeSubKp]);
  await conn.confirmTransaction(sweepSig, 'confirmed');
  console.log(`  swept ${bal - 5_000} lamports back via ${sweepSig}`);
}
