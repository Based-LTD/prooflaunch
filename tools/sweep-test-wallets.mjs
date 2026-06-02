// Sweep recoverable SOL from a mainnet test launch's keypair stash
// back into the platform escrow. Recovers the rent-exempt minimum
// from the sub-escrow + any leftover from the pool wallet (whatever
// wasn't bonded into the DBC curve).
//
// SOL bonded into the curve is NOT recoverable through this tool —
// only via swapping the curve's tokens back to SOL, which a separate
// tool can do later if we still have the tokens.

import { readFileSync, readdirSync } from 'fs';
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction,
  sendAndConfirmTransaction, LAMPORTS_PER_SOL, ComputeBudgetProgram,
} from '@solana/web3.js';
import bs58 from 'bs58';

const env = readFileSync('.env.local', 'utf-8');
const g = (k) => env.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.replace(/^["']|["']$/g, '');

const stashes = readdirSync('.').filter((f) => f.startsWith('meteora-mainnet-test.') && f.endsWith('.json'));
if (stashes.length === 0) { console.error('no stash files'); process.exit(1); }
const stashPath = stashes.sort().reverse()[0];
const stash = JSON.parse(readFileSync(stashPath, 'utf-8'));
console.log(`using stash: ${stashPath}`);

const conn = new Connection(g('NEXT_PUBLIC_SOLANA_RPC_URL') || 'https://api.mainnet-beta.solana.com', 'confirmed');
const escrowKp = Keypair.fromSecretKey(bs58.decode(g('ESCROW_WALLET_PRIVATE_KEY')));
const poolKp = Keypair.fromSecretKey(bs58.decode(stash.pool.secret));
const subEscrowKp = Keypair.fromSecretKey(bs58.decode(stash.subEscrow.secret));

console.log(`escrow:      ${escrowKp.publicKey.toBase58()}  (destination)`);
console.log(`pool:        ${poolKp.publicKey.toBase58()}`);
console.log(`sub-escrow:  ${subEscrowKp.publicKey.toBase58()}`);
console.log('');

// Leave enough lamports for the transfer tx fee. Solana rent-exempts
// accounts with non-zero balance; sweeping ALL lamports closes the
// account, freeing the rent. The tx fee comes off the sender too.
// Base tx fee = 5k; sweep isn't time-sensitive so we skip the
// priority-fee ix entirely → exact 5k is enough.
const TX_FEE_RESERVE = 5_000;

async function sweep(from, label) {
  const bal = await conn.getBalance(from.publicKey);
  console.log(`${label}: ${(bal / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
  if (bal <= TX_FEE_RESERVE) {
    console.log(`  (nothing to sweep; skipping)`);
    return;
  }
  const sweepAmount = bal - TX_FEE_RESERVE;
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: from.publicKey,
      toPubkey: escrowKp.publicKey,
      lamports: sweepAmount,
    }),
  );
  const sig = await sendAndConfirmTransaction(conn, tx, [from], { commitment: 'confirmed' });
  console.log(`  ✅ swept ${(sweepAmount / LAMPORTS_PER_SOL).toFixed(6)} SOL → escrow`);
  console.log(`     ${sig}`);
}

await sweep(poolKp, 'pool wallet');
await sweep(subEscrowKp, 'sub-escrow');

const finalBal = await conn.getBalance(escrowKp.publicKey);
console.log('');
console.log(`escrow now: ${(finalBal / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
