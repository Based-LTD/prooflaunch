// One-shot: burn all PRFTEST tokens held by the test pool wallet so
// the on-chain state shows "pool/dev holds zero" — matches the
// post-distribution end state of a real Proof Launch backed launch.
//
// Reads the keypair stash from meteora-mainnet-test.<mint>.json.

import { readFileSync, readdirSync } from 'fs';
import {
  Connection, Keypair, PublicKey, Transaction, ComputeBudgetProgram,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { getAssociatedTokenAddressSync, createBurnInstruction, getAccount } from '@solana/spl-token';
import bs58 from 'bs58';

const env = readFileSync('.env.local', 'utf-8');
const g = (k) => env.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.replace(/^["']|["']$/g, '');

// Find the test stash file. There should only be one mainnet test
// at a time; if multiple, take the newest.
const stashes = readdirSync('.').filter((f) => f.startsWith('meteora-mainnet-test.') && f.endsWith('.json'));
if (stashes.length === 0) {
  console.error('no meteora-mainnet-test.*.json stash found');
  process.exit(1);
}
const stashPath = stashes.sort().reverse()[0];
const stash = JSON.parse(readFileSync(stashPath, 'utf-8'));
console.log(`using stash: ${stashPath}`);

const conn = new Connection(g('NEXT_PUBLIC_SOLANA_RPC_URL') || 'https://api.mainnet-beta.solana.com', 'confirmed');
const poolKp = Keypair.fromSecretKey(bs58.decode(stash.pool.secret));
const mint = new PublicKey(stash.mint.pubkey);
const escrowKp = Keypair.fromSecretKey(bs58.decode(g('ESCROW_WALLET_PRIVATE_KEY')));

const ata = getAssociatedTokenAddressSync(mint, poolKp.publicKey, true);
console.log(`pool wallet: ${poolKp.publicKey.toBase58()}`);
console.log(`pool ATA:    ${ata.toBase58()}`);
console.log(`mint:        ${mint.toBase58()}`);

const acct = await getAccount(conn, ata);
const amount = acct.amount;
console.log(`balance:     ${amount.toString()} raw (${Number(amount) / 1e6} tokens at 6 decimals)`);
if (amount === 0n) {
  console.log('already zero — nothing to burn');
  process.exit(0);
}

console.log('');
console.log('burning all pool tokens...');
const tx = new Transaction().add(
  ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }),
  createBurnInstruction(ata, mint, poolKp.publicKey, amount),
);
const sig = await sendAndConfirmTransaction(conn, tx, [escrowKp, poolKp], { commitment: 'confirmed' });
console.log(`✅ burned ${amount} raw tokens`);
console.log(`   tx: ${sig}`);
console.log(`   https://solscan.io/tx/${sig}`);
