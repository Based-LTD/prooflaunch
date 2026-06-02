// Verify a mainnet mint exists + show supply.
import { readFileSync } from 'fs';
import { Connection, PublicKey } from '@solana/web3.js';

const env = readFileSync('.env.local', 'utf-8');
const g = (k) => env.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.replace(/^["']|["']$/g, '');

const mint = process.argv[2];
if (!mint) { console.error('usage: node verify-mint-mainnet.mjs <mint-address>'); process.exit(1); }

const conn = new Connection(g('NEXT_PUBLIC_SOLANA_RPC_URL') || 'https://api.mainnet-beta.solana.com', 'confirmed');
const pk = new PublicKey(mint);

const info = await conn.getAccountInfo(pk);
if (!info) { console.log('mint NOT FOUND'); process.exit(1); }
console.log(`mint exists: owner=${info.owner.toBase58()} lamports=${info.lamports} dataLen=${info.data.length}`);

const supply = await conn.getTokenSupply(pk);
console.log(`supply: ${supply.value.uiAmountString} (${supply.value.amount} raw)`);
