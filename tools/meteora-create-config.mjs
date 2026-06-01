// One-time admin tool: create the shared Proof Launch DBC config on a
// chosen network. Every Meteora-launched token references this single
// config account; once created the pubkey is written to env as
// METEORA_DBC_CONFIG and the launch adapter picks it up.
//
// Curve parameters live in tools/meteora-dbc-config.template.ts so the
// TypeScript types of the SDK type-check the values at edit time. This
// .mjs script is the runner — it imports the typed template and calls
// the SDK against a real connection.
//
// Usage:
//   node --experimental-strip-types tools/meteora-create-config.mjs --network devnet
//   node --experimental-strip-types tools/meteora-create-config.mjs --network mainnet
//
// Devnet is safe to re-run as a smoke test. Mainnet should only be run
// ONCE per major curve revision — every Meteora token launched after
// will reference the resulting config pubkey forever.
//
// Reads from .env.local:
//   ESCROW_WALLET_PRIVATE_KEY      — pays config rent, signs as feeClaimer
//   NEXT_PUBLIC_SOLANA_RPC_URL     — mainnet RPC (used for --network mainnet)
//
// Devnet uses https://api.devnet.solana.com by default.

import { readFileSync, writeFileSync } from 'fs';
import { Connection, Keypair, sendAndConfirmTransaction } from '@solana/web3.js';
import bs58 from 'bs58';

const args = process.argv.slice(2);
const networkIdx = args.indexOf('--network');
const network = networkIdx >= 0 ? args[networkIdx + 1] : 'devnet';
if (!['devnet', 'mainnet'].includes(network)) {
  console.error('usage: --network devnet|mainnet');
  process.exit(1);
}

const env = readFileSync('.env.local', 'utf-8');
const g = (k) => env.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.replace(/^["']|["']$/g, '');

const ESCROW_KEY = g('ESCROW_WALLET_PRIVATE_KEY');
if (!ESCROW_KEY) {
  console.error('ESCROW_WALLET_PRIVATE_KEY missing in .env.local');
  process.exit(1);
}

const RPC_URL = network === 'mainnet'
  ? (g('NEXT_PUBLIC_SOLANA_RPC_URL') ?? 'https://api.mainnet-beta.solana.com')
  : 'https://api.devnet.solana.com';

console.log(`network: ${network}`);
console.log(`rpc:     ${RPC_URL}`);

// Dynamic import so the SDK + template are only resolved when the
// script runs (not at module-parse time, which lets node strip the
// .ts template via --experimental-strip-types).
const [{ DynamicBondingCurveClient }, { buildFreshProofLaunchDbcParams }] = await Promise.all([
  import('@meteora-ag/dynamic-bonding-curve-sdk'),
  import('./meteora-dbc-config.template.ts'),
]);

const conn = new Connection(RPC_URL, 'confirmed');
const escrowKp = Keypair.fromSecretKey(bs58.decode(ESCROW_KEY));

const bal = await conn.getBalance(escrowKp.publicKey);
console.log(`escrow:  ${escrowKp.publicKey.toBase58()}  (${(bal / 1e9).toFixed(4)} SOL)`);
if (bal < 50_000_000) {
  // 0.05 SOL covers config rent + tx fee with margin
  console.error(`escrow balance below 0.05 SOL — top up before retrying.`);
  if (network === 'devnet') console.error(`devnet airdrop: solana airdrop 1 ${escrowKp.publicKey.toBase58()} --url devnet`);
  process.exit(1);
}

const { params, configKeypair } = buildFreshProofLaunchDbcParams({
  payer: escrowKp.publicKey,
  feeClaimer: escrowKp.publicKey,        // partner fee share (0% in our setup, but must be ours)
  leftoverReceiver: escrowKp.publicKey,  // any unsold base tokens at migration
});

console.log(`config:  ${configKeypair.publicKey.toBase58()}  (fresh, will be created)`);

const client = new DynamicBondingCurveClient(conn, 'confirmed');
const tx = await client.partner.createConfig(params);

console.log('sending tx...');
const sig = await sendAndConfirmTransaction(
  conn,
  tx,
  [escrowKp, configKeypair],
  { commitment: 'confirmed', skipPreflight: false, maxRetries: 3 },
);

console.log(`✅ config created`);
console.log(`   signature: ${sig}`);
console.log(`   config:    ${configKeypair.publicKey.toBase58()}`);
console.log('');
console.log(`Add this to .env.local (and Vercel for prod):`);
console.log(`   METEORA_DBC_CONFIG=${configKeypair.publicKey.toBase58()}`);
console.log('');

// Stash the config keypair to disk so it can be re-used / re-signed by
// future admin tasks (e.g. updateConfig if Meteora ever adds it).
const stash = `meteora-dbc-config.${network}.${configKeypair.publicKey.toBase58().slice(0, 8)}.json`;
writeFileSync(stash, JSON.stringify({
  network,
  pubkey: configKeypair.publicKey.toBase58(),
  secret: bs58.encode(configKeypair.secretKey),
  createdAt: new Date().toISOString(),
  signature: sig,
}, null, 2));
console.log(`(config keypair stashed at ${stash} — gitignored)`);
