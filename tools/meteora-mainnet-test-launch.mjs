// MAINNET platform-funded test launch through the Meteora DBC adapter.
//
// Uses real mainnet SOL. The goal: prove that the production curve
// parameters (METEORA_DBC_CONFIG=4RxYqm...) + pool wallet + sub-escrow
// signer pattern actually executes against the live DBC program, end-
// to-end. No real users, no real backers — just platform smoke.
//
// COSTS:
//   - 0.5 SOL of platform SOL goes into the pool wallet (the "first buy")
//   - ~0.005 SOL of platform SOL pays rent/fees for the create + sub-escrow funding
//   - 0.5 SOL is recoverable later: sweep the sub-escrow wallet after the
//     test (this script prints the sub-escrow keypair). The bonded SOL
//     in the DBC pool itself is NOT recoverable without a token sale.
//
// Naming: this is a one-off test token, NOT a real user submission.
// Symbol: PRFTEST. Name reflects "this is a platform smoke test".
//
// PREREQS:
//   - METEORA_DBC_CONFIG in .env.local set to the mainnet config pubkey
//   - ESCROW_WALLET_PRIVATE_KEY funded with >= 0.6 SOL on mainnet

import { readFileSync, writeFileSync } from 'fs';
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction,
  sendAndConfirmTransaction, LAMPORTS_PER_SOL, ComputeBudgetProgram,
} from '@solana/web3.js';
import { BN } from 'bn.js';
import bs58 from 'bs58';

const env = readFileSync('.env.local', 'utf-8');
const g = (k) => env.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.replace(/^["']|["']$/g, '');

const ESCROW_KEY = g('ESCROW_WALLET_PRIVATE_KEY');
const DBC_CONFIG = g('METEORA_DBC_CONFIG');  // NOT the _DEVNET one
const RPC_URL = g('NEXT_PUBLIC_SOLANA_RPC_URL') || 'https://api.mainnet-beta.solana.com';

if (!ESCROW_KEY) { console.error('ESCROW_WALLET_PRIVATE_KEY missing'); process.exit(1); }
if (!DBC_CONFIG) { console.error('METEORA_DBC_CONFIG missing (mainnet)'); process.exit(1); }

const conn = new Connection(RPC_URL, 'confirmed');
const escrowKp = Keypair.fromSecretKey(bs58.decode(ESCROW_KEY));
const dbcConfig = new PublicKey(DBC_CONFIG);

console.log(`rpc:    ${RPC_URL}`);
console.log(`escrow: ${escrowKp.publicKey.toBase58()}`);
const escrowBal = await conn.getBalance(escrowKp.publicKey);
console.log(`        balance ${(escrowBal / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
if (escrowBal < 0.6 * LAMPORTS_PER_SOL) {
  console.error('escrow balance below 0.6 SOL — top up before retrying.');
  process.exit(1);
}
console.log(`dbc cfg: ${dbcConfig.toBase58()} (MAINNET)`);
console.log('');
console.log('⚠️  This will spend real mainnet SOL.');
console.log('   Pool funding: 0.5 SOL (bonded into the curve, recoverable only via sells)');
console.log('   Sub-escrow:   0.01 SOL (recoverable — sweep after)');
console.log('   Rent/fees:    ~0.005 SOL');
console.log('');

// 5-second hard pause so you can ctrl-c if anything looks wrong.
await new Promise((r) => setTimeout(r, 5000));

// Pool + sub-escrow keypairs — production setup mirrors this exactly.
const poolKp = Keypair.generate();
const subEscrowKp = Keypair.generate();
const mintKp = Keypair.generate();

console.log(`pool wallet: ${poolKp.publicKey.toBase58()}`);
console.log(`sub-escrow:  ${subEscrowKp.publicKey.toBase58()}`);
console.log(`mint:        ${mintKp.publicKey.toBase58()}`);
console.log('');

// Stash all keypairs immediately so we can recover funds even if the
// launch tx fails mid-flight.
const stashPath = `meteora-mainnet-test.${mintKp.publicKey.toBase58().slice(0, 8)}.json`;
writeFileSync(stashPath, JSON.stringify({
  network: 'mainnet',
  mint: { pubkey: mintKp.publicKey.toBase58(), secret: bs58.encode(mintKp.secretKey) },
  pool: { pubkey: poolKp.publicKey.toBase58(), secret: bs58.encode(poolKp.secretKey) },
  subEscrow: { pubkey: subEscrowKp.publicKey.toBase58(), secret: bs58.encode(subEscrowKp.secretKey) },
  dbcConfig: dbcConfig.toBase58(),
  startedAt: new Date().toISOString(),
}, null, 2));
console.log(`(keypairs stashed to ${stashPath} — gitignored)`);
console.log('');

const FUND_POOL = 0.5 * LAMPORTS_PER_SOL;
const FUND_SUB = 0.01 * LAMPORTS_PER_SOL;
console.log(`funding pool ${FUND_POOL / LAMPORTS_PER_SOL} SOL + sub-escrow ${FUND_SUB / LAMPORTS_PER_SOL} SOL...`);
const fundTx = new Transaction().add(
  ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }),
  SystemProgram.transfer({ fromPubkey: escrowKp.publicKey, toPubkey: poolKp.publicKey, lamports: FUND_POOL }),
  SystemProgram.transfer({ fromPubkey: escrowKp.publicKey, toPubkey: subEscrowKp.publicKey, lamports: FUND_SUB }),
);
const fundSig = await sendAndConfirmTransaction(conn, fundTx, [escrowKp], { commitment: 'confirmed' });
console.log(`  funded:  ${fundSig}`);

const RESERVE = 0.05 * LAMPORTS_PER_SOL;
const buyAmount = FUND_POOL - RESERVE;

const { DynamicBondingCurveClient, deriveDbcPoolAddress } = await import('@meteora-ag/dynamic-bonding-curve-sdk');
const QUOTE_MINT_SOL = new PublicKey('So11111111111111111111111111111111111111112');
const client = new DynamicBondingCurveClient(conn, 'confirmed');

console.log(`launch: ${buyAmount / LAMPORTS_PER_SOL} SOL buy (reserve ${RESERVE / LAMPORTS_PER_SOL} for rent/fees)`);

const tx = await client.pool.createPoolWithFirstBuy({
  createPoolParam: {
    name: 'Proof Mainnet Test',
    symbol: 'PRFTEST',
    uri: `https://prooflaunch.fun/api/token-metadata/${mintKp.publicKey.toBase58()}`,
    payer: poolKp.publicKey,
    poolCreator: subEscrowKp.publicKey,
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

const dbcPool = deriveDbcPoolAddress(QUOTE_MINT_SOL, mintKp.publicKey, dbcConfig);
console.log(`expected DBC pool: ${dbcPool.toBase58()}`);

console.log('sending launch tx...');
const launchSig = await sendAndConfirmTransaction(
  conn, tx,
  [poolKp, mintKp, subEscrowKp],
  { commitment: 'confirmed', skipPreflight: false, maxRetries: 3 },
);

console.log('');
console.log('✅ MAINNET launch confirmed');
console.log(`   mint:       ${mintKp.publicKey.toBase58()}`);
console.log(`   dbc pool:   ${dbcPool.toBase58()}`);
console.log(`   pool wlt:   ${poolKp.publicKey.toBase58()}`);
console.log(`   sub-escrow: ${subEscrowKp.publicKey.toBase58()}`);
console.log(`   tx:         ${launchSig}`);
console.log('');
console.log('Verify on solscan:');
console.log(`   https://solscan.io/tx/${launchSig}`);
console.log(`   https://solscan.io/token/${mintKp.publicKey.toBase58()}`);
console.log(`   https://solscan.io/account/${dbcPool.toBase58()}`);
