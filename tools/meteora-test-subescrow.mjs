// Second devnet smoke test: same launch flow but with a sub-escrow
// keypair as the poolCreator (matches the production adapter path).
// Validates that the signer wiring works when sub-escrow is the
// creator.

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
const DBC_CONFIG = g('METEORA_DBC_CONFIG_DEVNET');
if (!ESCROW_KEY || !DBC_CONFIG) { console.error('env missing'); process.exit(1); }

const conn = new Connection('https://api.devnet.solana.com', 'confirmed');
const escrowKp = Keypair.fromSecretKey(bs58.decode(ESCROW_KEY));
const dbcConfig = new PublicKey(DBC_CONFIG);

// Simulate the prod setup: pool wallet + sub-escrow are two distinct
// keypairs generated at submission time.
const poolKp = Keypair.generate();
const subEscrowKp = Keypair.generate();

console.log(`escrow:     ${escrowKp.publicKey.toBase58()}`);
console.log(`pool:       ${poolKp.publicKey.toBase58()}`);
console.log(`sub-escrow: ${subEscrowKp.publicKey.toBase58()} (← poolCreator)`);
console.log('');

// Fund pool wallet 0.5 SOL from escrow. Sub-escrow needs rent for
// signer status — fund with 0.005 SOL.
const FUND_POOL = 0.5 * LAMPORTS_PER_SOL;
const FUND_SUB = 0.01 * LAMPORTS_PER_SOL;
console.log(`funding pool ${FUND_POOL / LAMPORTS_PER_SOL} SOL + sub-escrow ${FUND_SUB / LAMPORTS_PER_SOL} SOL...`);
const fundTx = new Transaction().add(
  ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }),
  SystemProgram.transfer({ fromPubkey: escrowKp.publicKey, toPubkey: poolKp.publicKey, lamports: FUND_POOL }),
  SystemProgram.transfer({ fromPubkey: escrowKp.publicKey, toPubkey: subEscrowKp.publicKey, lamports: FUND_SUB }),
);
await sendAndConfirmTransaction(conn, fundTx, [escrowKp], { commitment: 'confirmed' });
console.log('  funded');

const mintKp = Keypair.generate();
console.log(`mint:       ${mintKp.publicKey.toBase58()}`);

const RESERVE = 0.05 * LAMPORTS_PER_SOL;
const buyAmount = FUND_POOL - RESERVE;

const { DynamicBondingCurveClient } = await import('@meteora-ag/dynamic-bonding-curve-sdk');
const client = new DynamicBondingCurveClient(conn, 'confirmed');

const tx = await client.pool.createPoolWithFirstBuy({
  createPoolParam: {
    name: 'PROOF Subesc Test',
    symbol: 'PROOFSUB',
    uri: 'https://prooflaunch.fun/api/token-metadata/PROOFSUB',
    payer: poolKp.publicKey,
    poolCreator: subEscrowKp.publicKey, // ← the prod scenario
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

console.log('sending with [pool, mint, subEscrow] signers...');
const sig = await sendAndConfirmTransaction(
  conn, tx,
  [poolKp, mintKp, subEscrowKp], // ← the production signer set
  { commitment: 'confirmed', skipPreflight: false, maxRetries: 3 },
);

console.log('');
console.log('✅ launch with sub-escrow as creator confirmed');
console.log(`   mint:  ${mintKp.publicKey.toBase58()}`);
console.log(`   tx:    ${sig}`);
console.log(`   https://solscan.io/tx/${sig}?cluster=devnet`);
console.log(`   https://solscan.io/token/${mintKp.publicKey.toBase58()}?cluster=devnet`);
