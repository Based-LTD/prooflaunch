// One-time admin tool: create the shared Proof Launch USDC-quoted DBC
// config on a chosen network. Mirrors tools/meteora-create-config.mjs
// (the SOL variant) — only the imported template differs.
//
// Curve / fee / liquidity-distribution params live in
//   tools/meteora-dbc-config-usdc.template.ts
// where the SDK's TypeScript types validate the values at edit time.
//
// Usage:
//   node --experimental-strip-types tools/meteora-create-config-usdc.mjs --network devnet
//   node --experimental-strip-types tools/meteora-create-config-usdc.mjs --network mainnet
//
// Devnet is safe to re-run as a smoke test. Mainnet should only be run
// ONCE — every Meteora USDC token launched after will reference the
// resulting config pubkey forever.
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

const ESCROW_KEY_RAW = g('ESCROW_WALLET_PRIVATE_KEY');
if (!ESCROW_KEY_RAW) {
  console.error('ESCROW_WALLET_PRIVATE_KEY missing in .env.local');
  process.exit(1);
}
// Strip any literal `\n` paste artifacts (Vercel env editor habit).
const ESCROW_KEY = ESCROW_KEY_RAW.replace(/\\n/g, '').trim();

// Allow CLI override via --rpc <url> so we can swap RPCs when one is
// rate-limited without editing .env.local. Falls back to env, then public.
const rpcIdx = args.indexOf('--rpc');
const cliRpc = rpcIdx >= 0 ? args[rpcIdx + 1] : null;
const RPC_URL = cliRpc ?? (network === 'mainnet'
  ? (g('NEXT_PUBLIC_SOLANA_RPC_URL') ?? 'https://api.mainnet-beta.solana.com')
  : 'https://api.devnet.solana.com');

console.log(`network: ${network}`);
console.log(`rpc:     ${RPC_URL}`);

const [{ DynamicBondingCurveClient }, { buildFreshProofLaunchDbcUsdcParams }] = await Promise.all([
  import('@meteora-ag/dynamic-bonding-curve-sdk'),
  import('./meteora-dbc-config-usdc.template.ts'),
]);

const conn = new Connection(RPC_URL, 'confirmed');
const escrowKp = Keypair.fromSecretKey(bs58.decode(ESCROW_KEY));

const bal = await conn.getBalance(escrowKp.publicKey);
console.log(`escrow:  ${escrowKp.publicKey.toBase58()}  (${(bal / 1e9).toFixed(4)} SOL)`);
if (bal < 50_000_000) {
  console.error(`escrow balance below 0.05 SOL — top up before retrying.`);
  if (network === 'devnet') console.error(`devnet airdrop: solana airdrop 1 ${escrowKp.publicKey.toBase58()} --url devnet`);
  process.exit(1);
}

const { params, configKeypair } = buildFreshProofLaunchDbcUsdcParams({
  payer: escrowKp.publicKey,
  feeClaimer: escrowKp.publicKey,
  leftoverReceiver: escrowKp.publicKey,
});

console.log(`config:  ${configKeypair.publicKey.toBase58()}  (fresh, will be created)`);
console.log(`quote:   USDC (EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v)`);
console.log(`mcap:    init=$900 / migration=$69k`);

const client = new DynamicBondingCurveClient(conn, 'confirmed');
const tx = await client.partner.createConfig(params);

console.log('sending tx...');
const sig = await sendAndConfirmTransaction(
  conn,
  tx,
  [escrowKp, configKeypair],
  { commitment: 'confirmed', skipPreflight: false, maxRetries: 3 },
);

console.log(`✅ USDC config created`);
console.log(`   signature: ${sig}`);
console.log(`   config:    ${configKeypair.publicKey.toBase58()}`);
console.log(`   solscan:   https://solscan.io/tx/${sig}`);
console.log('');
console.log(`Add this to .env.local (and Vercel for prod):`);
console.log(`   METEORA_DBC_CONFIG_USDC=${configKeypair.publicKey.toBase58()}`);
console.log('');

const stash = `meteora-dbc-config-usdc.${network}.${configKeypair.publicKey.toBase58().slice(0, 8)}.json`;
writeFileSync(stash, JSON.stringify({
  network,
  quote: 'USDC',
  pubkey: configKeypair.publicKey.toBase58(),
  secret: bs58.encode(configKeypair.secretKey),
  createdAt: new Date().toISOString(),
  signature: sig,
}, null, 2));
console.log(`(config keypair stashed at ${stash} — gitignored)`);
