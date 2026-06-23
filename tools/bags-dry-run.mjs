#!/usr/bin/env node
// bags-dry-run.mjs — verify our Bags integration talks to the live API
// without committing anything to chain.
//
// Calls each of the three POST endpoints our adapter uses, NEVER signs
// or broadcasts the returned transactions, so nothing leaves the Bags
// backend and no SOL moves. Validates:
//   1. BAGS_API_KEY auth works (vs 401)
//   2. Request shapes match what their API expects (vs 400)
//   3. Response shapes match what our adapter parses (vs runtime crash)
//   4. The 'creator must be in claimers' rule actually wants both pool
//      wallet AND sub-escrow, or something different
//
// Pass-condition: each step returns success=true OR a clear error we
// can read and fix. Fail-condition: 401 (key bad), 5xx (Bags down), or
// our parse crashes on response shape drift.

import { readFileSync } from 'fs';
import { Keypair } from '@solana/web3.js';

const env = readFileSync('.env.local', 'utf-8');
const g = (k) => env.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.replace(/^["']|["']$/g, '');
const BAGS_API_KEY = g('BAGS_API_KEY');
if (!BAGS_API_KEY) {
  console.error('BAGS_API_KEY not set in .env.local');
  process.exit(1);
}

const BASE = 'https://public-api-v2.bags.fm/api/v1';
const headers = (json = true) => ({
  'x-api-key': BAGS_API_KEY,
  ...(json ? { 'Content-Type': 'application/json' } : {}),
});

// Throwaway keypairs for the dry run — never broadcast so they don't
// need to exist on chain or be funded.
const fakePoolKp = Keypair.generate();
const fakeSubKp = Keypair.generate();

console.log(`\n══════════════════════════════════════════════════════════════════`);
console.log(`  BAGS API DRY RUN`);
console.log(`══════════════════════════════════════════════════════════════════`);
console.log(`  API key:            ${BAGS_API_KEY.slice(0, 8)}…${BAGS_API_KEY.slice(-4)} (len ${BAGS_API_KEY.length})`);
console.log(`  Fake pool wallet:   ${fakePoolKp.publicKey.toBase58()}`);
console.log(`  Fake sub-escrow:    ${fakeSubKp.publicKey.toBase58()}`);
console.log();

// ───────────────────────────────────────────────────────────────────
// Step 1: create-token-info  (multipart form-data)
// ───────────────────────────────────────────────────────────────────
console.log(`[1/3] POST /token-launch/create-token-info ...`);
const form = new FormData();
form.set('name', 'PROOFLAUNCH_DRY_RUN');
form.set('symbol', 'PLDRYRUN');
form.set('description', 'Integration dry-run from prooflaunch.fun — do not index. Auto-generated.');
form.set('imageUrl', 'https://prooflaunch.fun/icon.png');
const r1 = await fetch(`${BASE}/token-launch/create-token-info`, {
  method: 'POST',
  headers: headers(false),
  body: form,
});
const t1 = await r1.text();
console.log(`      HTTP ${r1.status}`);
let info = null;
try {
  const env1 = JSON.parse(t1);
  if (env1.success && env1.response) {
    info = env1.response;
    console.log(`      ✓ tokenMint:     ${info.tokenMint}`);
    console.log(`      ✓ tokenMetadata: ${info.tokenMetadata?.slice(0, 60)}…`);
  } else {
    console.log(`      ✗ ${JSON.stringify(env1).slice(0, 400)}`);
  }
} catch {
  console.log(`      ✗ non-JSON response: ${t1.slice(0, 400)}`);
}
if (!info) {
  console.log(`\nStopping — token-info failed. Auth or request-shape issue.\n`);
  process.exit(1);
}

// ───────────────────────────────────────────────────────────────────
// Step 2: fee-share/config — sub-escrow at 9999 bps, pool wallet at 1
// ───────────────────────────────────────────────────────────────────
console.log(`\n[2/3] POST /fee-share/config ...`);
// Try a few variations sequentially to narrow the 500 cause:
const variations = [
  { label: 'baseline (2 claimers: pool 1bps + sub 9999bps)',
    body: { payer: fakePoolKp.publicKey.toBase58(), baseMint: info.tokenMint,
      claimersArray: [fakePoolKp.publicKey.toBase58(), fakeSubKp.publicKey.toBase58()],
      basisPointsArray: [1, 9999] } },
  { label: 'with explicit bagsConfigType default',
    body: { payer: fakePoolKp.publicKey.toBase58(), baseMint: info.tokenMint,
      claimersArray: [fakePoolKp.publicKey.toBase58(), fakeSubKp.publicKey.toBase58()],
      basisPointsArray: [1, 9999], bagsConfigType: 'fa29606e-5e48-4c37-827f-4b03d58ee23d' } },
  { label: 'single claimer (payer = sub-escrow, 100%)',
    body: { payer: fakeSubKp.publicKey.toBase58(), baseMint: info.tokenMint,
      claimersArray: [fakeSubKp.publicKey.toBase58()], basisPointsArray: [10000] } },
  { label: 'single claimer (payer = pool wallet, claimer = sub-escrow)',
    body: { payer: fakePoolKp.publicKey.toBase58(), baseMint: info.tokenMint,
      claimersArray: [fakeSubKp.publicKey.toBase58()], basisPointsArray: [10000] } },
];
let r2 = null, info2body = null;
for (const v of variations) {
  console.log(`      • try: ${v.label}`);
  const r = await fetch(`${BASE}/fee-share/config`, {
    method: 'POST', headers: headers(), body: JSON.stringify(v.body),
  });
  const txt = await r.text();
  console.log(`        HTTP ${r.status}  body[:300]=${txt.slice(0, 300)}`);
  if (r.ok && txt.includes('"success":true')) {
    r2 = r; info2body = txt; console.log(`        ✓ this variation succeeded`);
    break;
  }
}
if (!r2) {
  console.log(`\nAll variations failed. Step 2 needs real Bags-side investigation.`);
  process.exit(1);
}
const t2 = info2body;
console.log(`      ✓ winning variation HTTP ${r2.status}`);
let feeShare = null;
try {
  const env2 = JSON.parse(t2);
  if (env2.success && env2.response) {
    feeShare = env2.response;
    console.log(`      ✓ meteoraConfigKey:  ${feeShare.meteoraConfigKey}`);
    console.log(`      ✓ feeShareAuthority: ${feeShare.feeShareAuthority}`);
    console.log(`      ✓ tx count:          ${feeShare.transactions?.length ?? 0}`);
    console.log(`      ✓ needsCreation:     ${feeShare.needsCreation}`);
    if ((feeShare.transactions?.length ?? 0) > 0) {
      const t = feeShare.transactions[0];
      console.log(`      ✓ first tx blockhash: ${t.blockhash?.blockhash?.slice(0, 12)}…  base58 len ${t.transaction?.length}`);
    }
  } else {
    console.log(`      ✗ ${JSON.stringify(env2).slice(0, 600)}`);
  }
} catch {
  console.log(`      ✗ non-JSON response: ${t2.slice(0, 400)}`);
}

// ───────────────────────────────────────────────────────────────────
// Step 3: create-launch-transaction (only if step 2 worked)
// ───────────────────────────────────────────────────────────────────
if (feeShare?.meteoraConfigKey) {
  console.log(`\n[3/3] POST /token-launch/create-launch-transaction ...`);
  const r3 = await fetch(`${BASE}/token-launch/create-launch-transaction`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      ipfs: info.tokenMetadata,
      tokenMint: info.tokenMint,
      wallet: fakePoolKp.publicKey.toBase58(),
      initialBuyLamports: 50_000_000, // 0.05 SOL — just a sanity value, won't be sent
      configKey: feeShare.meteoraConfigKey,
    }),
  });
  const t3 = await r3.text();
  console.log(`      HTTP ${r3.status}`);
  try {
    const env3 = JSON.parse(t3);
    if (env3.success && env3.response) {
      const txStr = typeof env3.response === 'string' ? env3.response : env3.response.transaction;
      console.log(`      ✓ unsigned launch tx returned (base58 len ${txStr?.length})`);
    } else {
      console.log(`      ✗ ${JSON.stringify(env3).slice(0, 600)}`);
    }
  } catch {
    console.log(`      ✗ non-JSON response: ${t3.slice(0, 400)}`);
  }
} else {
  console.log(`\n[3/3] SKIPPED — no meteoraConfigKey from step 2`);
}

console.log(`\n══════════════════════════════════════════════════════════════════`);
console.log(`  DRY RUN COMPLETE — no transactions broadcast, no SOL moved.`);
console.log(`══════════════════════════════════════════════════════════════════\n`);
