#!/usr/bin/env node
// Probe whether Bags fee-share/config works when payer + claimer is a
// REAL on-chain wallet (vs a fake throwaway keypair). If yes → the 500
// we hit was about wallet existence/registration. If still 500 → there's
// something else we're missing.

import { readFileSync } from 'fs';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

const env = readFileSync('.env.local', 'utf-8');
const g = (k) => env.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.replace(/^["']|["']$/g, '');
const gBs58 = (k) => g(k)?.replace(/\\n/g, '').trim();

const BAGS_API_KEY = g('BAGS_API_KEY');
const BASE = 'https://public-api-v2.bags.fm/api/v1';

// Use the platform escrow wallet — it definitely exists on-chain and has SOL.
const escrowKp = Keypair.fromSecretKey(bs58.decode(gBs58('ESCROW_WALLET_PRIVATE_KEY')));
console.log(`Escrow wallet (real, on-chain): ${escrowKp.publicKey.toBase58()}`);

// Step 1: token-info to get a valid baseMint
const form = new FormData();
form.set('name', 'PROOFLAUNCH_DRY_RUN_2');
form.set('symbol', 'PLDR2');
form.set('description', 'Probe 2 — checking on-chain wallet requirement.');
form.set('imageUrl', 'https://prooflaunch.fun/icon.png');
const r1 = await fetch(`${BASE}/token-launch/create-token-info`, {
  method: 'POST', headers: { 'x-api-key': BAGS_API_KEY }, body: form,
});
const env1 = await r1.json();
const tokenMint = env1.response?.tokenMint;
console.log(`token-info: HTTP ${r1.status}  tokenMint=${tokenMint}`);

// Probes
const probes = [
  { label: 'real escrow as payer + claimer (self at 100%)',
    body: { payer: escrowKp.publicKey.toBase58(), baseMint: tokenMint,
      claimersArray: [escrowKp.publicKey.toBase58()], basisPointsArray: [10000] } },
  { label: 'real escrow payer + claimer + partner key (if env set)',
    body: { payer: escrowKp.publicKey.toBase58(), baseMint: tokenMint,
      claimersArray: [escrowKp.publicKey.toBase58()], basisPointsArray: [10000],
      partner: g('BAGS_PARTNER_KEY') || undefined } },
  { label: 'real escrow + small partner + lookup tables off',
    body: { payer: escrowKp.publicKey.toBase58(), baseMint: tokenMint,
      claimersArray: [escrowKp.publicKey.toBase58()], basisPointsArray: [10000],
      additionalLookupTables: [], enableFirstSwapWithMinFee: false } },
];
for (const p of probes) {
  console.log(`\n→ ${p.label}`);
  const r = await fetch(`${BASE}/fee-share/config`, {
    method: 'POST',
    headers: { 'x-api-key': BAGS_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(p.body),
  });
  const t = await r.text();
  console.log(`  HTTP ${r.status}  body[:400]=${t.slice(0, 400)}`);
}
