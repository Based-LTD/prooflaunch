// Pre-flight: check escrow balance on devnet; request airdrop if low.
//
// Devnet airdrop is rate-limited and flaky — if this fails the user
// can fall back to https://faucet.solana.com/ or solfaucet.com to
// manually fund the escrow address it prints.

import { readFileSync } from 'fs';
import { Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';

const env = readFileSync('.env.local', 'utf-8');
const g = (k) => env.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.replace(/^["']|["']$/g, '');

const ESCROW_KEY = g('ESCROW_WALLET_PRIVATE_KEY');
if (!ESCROW_KEY) { console.error('ESCROW_WALLET_PRIVATE_KEY missing'); process.exit(1); }

const conn = new Connection('https://api.devnet.solana.com', 'confirmed');
const kp = Keypair.fromSecretKey(bs58.decode(ESCROW_KEY));

const bal = await conn.getBalance(kp.publicKey);
console.log(`escrow:  ${kp.publicKey.toBase58()}`);
console.log(`balance: ${(bal / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

if (bal >= 1.5 * LAMPORTS_PER_SOL) {
  console.log('✅ enough for config + test launch');
  process.exit(0);
}

console.log('requesting 2 SOL devnet airdrop...');
try {
  const sig = await conn.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL);
  await conn.confirmTransaction(sig, 'confirmed');
  const after = await conn.getBalance(kp.publicKey);
  console.log(`✅ airdropped. balance now ${(after / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
} catch (e) {
  console.error(`airdrop failed: ${e instanceof Error ? e.message : String(e)}`);
  console.error('');
  console.error('Manual airdrop fallback:');
  console.error(`  1. open https://faucet.solana.com/`);
  console.error(`  2. paste address: ${kp.publicKey.toBase58()}`);
  console.error(`  3. select "Devnet", request 2 SOL`);
  process.exit(1);
}
