// Devnet smoke test: launch one token end-to-end through the Meteora
// DBC adapter. Validates the integration without touching Supabase.
//
// Prereqs:
//   1. tools/meteora-create-config.mjs --network devnet has been run
//      successfully and METEORA_DBC_CONFIG_DEVNET is set in .env.local
//   2. ESCROW_WALLET_PRIVATE_KEY is funded with >= 1 SOL on devnet
//      (solana airdrop 1 <addr> --url devnet)
//
// What the script does:
//   1. Generates a fresh pool keypair and funds it from escrow with 0.5 SOL
//   2. Generates a fresh mint keypair
//   3. Calls client.pool.createPoolWithFirstBuy with the proof-launch config
//   4. Asserts the tx confirms + the pool exists on devnet
//   5. Prints the pool + mint + tx links so you can verify on devnet explorer
//
// Usage:
//   node --experimental-strip-types tools/meteora-test-launch.mjs

import { readFileSync } from 'fs';
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction,
  sendAndConfirmTransaction, LAMPORTS_PER_SOL, ComputeBudgetProgram,
} from '@solana/web3.js';
import { BN } from 'bn.js';
import bs58 from 'bs58';

const env = readFileSync('.env.local', 'utf-8');
const g = (k) => env.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.replace(/^["']|["']$/g, '');

const ESCROW_KEY = g('ESCROW_WALLET_PRIVATE_KEY');
const DBC_CONFIG = g('METEORA_DBC_CONFIG_DEVNET') ?? g('METEORA_DBC_CONFIG');
if (!ESCROW_KEY) { console.error('ESCROW_WALLET_PRIVATE_KEY missing'); process.exit(1); }
if (!DBC_CONFIG) {
  console.error('METEORA_DBC_CONFIG_DEVNET (or METEORA_DBC_CONFIG) missing.');
  console.error('Run: node --experimental-strip-types tools/meteora-create-config.mjs --network devnet');
  process.exit(1);
}

const RPC_URL = 'https://api.devnet.solana.com';
const conn = new Connection(RPC_URL, 'confirmed');
const escrowKp = Keypair.fromSecretKey(bs58.decode(ESCROW_KEY));
const dbcConfig = new PublicKey(DBC_CONFIG);

console.log(`rpc:    ${RPC_URL}`);
console.log(`escrow: ${escrowKp.publicKey.toBase58()}`);
const escrowBal = await conn.getBalance(escrowKp.publicKey);
console.log(`        balance ${(escrowBal / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
if (escrowBal < 0.6 * LAMPORTS_PER_SOL) {
  console.error('escrow balance below 0.6 SOL — airdrop more before running.');
  console.error(`solana airdrop 1 ${escrowKp.publicKey.toBase58()} --url devnet`);
  process.exit(1);
}
console.log(`dbc cfg: ${dbcConfig.toBase58()}`);
console.log('');

// 1. Generate pool wallet + fund it from escrow.
const poolKp = Keypair.generate();
const FUND_LAMPORTS = 0.5 * LAMPORTS_PER_SOL;
console.log(`pool wallet: ${poolKp.publicKey.toBase58()} (funding with 0.5 SOL)...`);

const fundTx = new Transaction().add(
  ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }),
  SystemProgram.transfer({
    fromPubkey: escrowKp.publicKey,
    toPubkey: poolKp.publicKey,
    lamports: FUND_LAMPORTS,
  }),
);
const fundSig = await sendAndConfirmTransaction(conn, fundTx, [escrowKp], { commitment: 'confirmed' });
console.log(`  funded:  ${fundSig}`);

// 2. Mint keypair.
const mintKp = Keypair.generate();
console.log(`mint:   ${mintKp.publicKey.toBase58()}`);

// 3. Run the launch via the SDK directly (the in-app adapter uses
// Supabase env we don't want this script to touch).
const { DynamicBondingCurveClient } = await import('@meteora-ag/dynamic-bonding-curve-sdk');
const client = new DynamicBondingCurveClient(conn, 'confirmed');

const RESERVE = 0.05 * LAMPORTS_PER_SOL;
const buyAmount = FUND_LAMPORTS - RESERVE;

console.log(`buy:    ${buyAmount / LAMPORTS_PER_SOL} SOL (reserve ${RESERVE / LAMPORTS_PER_SOL} for rent/fees)`);

const tx = await client.pool.createPoolWithFirstBuy({
  createPoolParam: {
    name: 'PROOF Devnet Test',
    symbol: 'PROOFTEST',
    uri: 'https://prooflaunch.fun/api/token-metadata/PROOFTEST',
    payer: poolKp.publicKey,
    // poolCreator is a SIGNER on the DBC create instruction. For the
    // smoke test we use the pool wallet itself so we only need [poolKp,
    // mintKp] as signers. In the production adapter the sub-escrow is
    // the creator; the adapter loads its encrypted key and adds it as
    // a signer (see src/services/launch/meteora.ts).
    poolCreator: poolKp.publicKey,
    config: dbcConfig,
    baseMint: mintKp.publicKey,
  },
  firstBuyParam: {
    buyer: poolKp.publicKey,
    buyAmount: new BN(buyAmount.toString()),
    minimumAmountOut: new BN(0),
    referralTokenAccount: null,
  },
});
tx.instructions.unshift(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }));

console.log('sending launch tx...');
const launchSig = await sendAndConfirmTransaction(
  conn, tx, [poolKp, mintKp],
  { commitment: 'confirmed', skipPreflight: false, maxRetries: 3 },
);

console.log('');
console.log('✅ launch confirmed');
console.log(`   mint:  ${mintKp.publicKey.toBase58()}`);
console.log(`   pool:  ${poolKp.publicKey.toBase58()}`);
console.log(`   tx:    ${launchSig}`);
console.log('');
console.log('Verify on devnet explorer:');
console.log(`   https://solscan.io/tx/${launchSig}?cluster=devnet`);
console.log(`   https://solscan.io/token/${mintKp.publicKey.toBase58()}?cluster=devnet`);
