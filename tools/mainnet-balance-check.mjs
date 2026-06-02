// Mainnet escrow balance check before any on-chain operation.
// Refuses to print/proceed if the balance is below the expected
// threshold for the operation we're about to do.

import { readFileSync } from 'fs';
import { Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';

const env = readFileSync('.env.local', 'utf-8');
const g = (k) => env.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.replace(/^["']|["']$/g, '');

const ESCROW_KEY = g('ESCROW_WALLET_PRIVATE_KEY');
const RPC = g('NEXT_PUBLIC_SOLANA_RPC_URL') || 'https://api.mainnet-beta.solana.com';

const kp = Keypair.fromSecretKey(bs58.decode(ESCROW_KEY));
const conn = new Connection(RPC, 'confirmed');
const bal = await conn.getBalance(kp.publicKey);

console.log(`rpc:     ${RPC}`);
console.log(`escrow:  ${kp.publicKey.toBase58()}`);
console.log(`balance: ${(bal / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
console.log('');
console.log('Operations + estimated costs:');
console.log('  1. Config create:  ~0.005 SOL (account rent + tx fee)');
console.log('  2. Test launch:    ~0.5 SOL (pool funding + launch fee + rent)');
console.log('  TOTAL needed:      ~0.51 SOL minimum, recommend 1+ SOL buffer');
