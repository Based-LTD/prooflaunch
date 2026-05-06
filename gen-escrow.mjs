import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

const kp = Keypair.generate();
const publicAddress = kp.publicKey.toBase58();
const privateKeyB58 = bs58.encode(kp.secretKey);

console.log('NEW ESCROW WALLET');
console.log('=================');
console.log(`Public address (share this):`);
console.log(`  ${publicAddress}`);
console.log();
console.log(`Private key (KEEP SECRET — paste into Vercel env):`);
console.log(`  ${privateKeyB58}`);
console.log();
console.log(`Solscan:`);
console.log(`  https://solscan.io/account/${publicAddress}`);
