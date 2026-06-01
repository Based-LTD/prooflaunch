// Quick: confirm a mint exists on devnet + show supply.
import { Connection, PublicKey } from '@solana/web3.js';

const mint = process.argv[2];
if (!mint) { console.error('usage: node verify-mint.mjs <mint-address>'); process.exit(1); }

const conn = new Connection('https://api.devnet.solana.com', 'confirmed');
const pk = new PublicKey(mint);

const info = await conn.getAccountInfo(pk);
if (!info) { console.log('mint NOT FOUND'); process.exit(1); }
console.log(`mint exists: owner=${info.owner.toBase58()} lamports=${info.lamports} dataLen=${info.data.length}`);

const supply = await conn.getTokenSupply(pk);
console.log(`supply: ${supply.value.uiAmountString} (${supply.value.amount} raw)`);
