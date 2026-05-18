import { Connection, PublicKey } from '@solana/web3.js';
import { readFileSync } from 'fs';
const env=readFileSync('.env.local','utf-8');
const get=(k)=>env.match(new RegExp(`^${k}=(.+)$`,'m'))?.[1]?.replace(/^["']|["']$/g,'');
const conn=new Connection(get('NEXT_PUBLIC_SOLANA_RPC_URL'),'confirmed');
const PUMP='6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const CLASSIC='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const T22='TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const ATA_PROG='ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const progName=(p)=>p===CLASSIC?'CLASSIC-SPL':p===T22?'TOKEN-2022':p;

// 1. Our last successful launch's mint — what token program owns it?
const ENgN='ENgNiDQjxwogBbUTJb1tSwxoSo33a3VgjMeXf1KGv9RQ';
const ai=await conn.getAccountInfo(new PublicKey(ENgN));
console.log(`Our last launch mint ${ENgN.slice(0,8)} owner: ${progName(ai?.owner?.toBase58())}`);

// 2. Find a recent ATOMIC create+buy on pump.fun (create & buy same slot, same mint)
const BUY=Buffer.from([102,6,61,18,1,218,235,234]).toString('hex');
const sigs=await conn.getSignaturesForAddress(new PublicKey(PUMP),{limit:150});
const bySlot={};
for(const s of sigs){ if(s.err)continue; (bySlot[s.slot]??=[]).push(s.signature); }
let found=0;
for(const [slot,sigList] of Object.entries(bySlot)){
  if(sigList.length<2) continue;
  // decode txs in this slot, look for a Create+Buy on same mint
  let createMint=null, buyTx=null;
  for(const sig of sigList){
    const tx=await conn.getTransaction(sig,{maxSupportedTransactionVersion:0,commitment:'confirmed'});
    if(!tx) continue;
    const logs=tx.meta?.logMessages||[];
    const m=tx.transaction.message;
    const keys=(m.staticAccountKeys||[]).map(k=>k.toBase58());
    const ld=tx.meta?.loadedAddresses; const allK=[...keys,...((ld?.writable||[]).map(k=>k.toString())),...((ld?.readonly||[]).map(k=>k.toString()))];
    const isCreate=logs.some(l=>/Instruction: (Create|CreateV2|InitializeMint)/.test(l)) && logs.some(l=>l.includes('Program log: Instruction: Create'));
    for(const ix of (m.compiledInstructions||[])){
      if(allK[ix.programIdIndex]!==PUMP) continue;
      const d=ix.data instanceof Uint8Array?Buffer.from(ix.data):Buffer.from(ix.data,'base64');
      if(d.subarray(0,8).toString('hex')===BUY){ buyTx={sig,tx,allK,ix}; }
    }
    if(isCreate){ const post=tx.meta?.postTokenBalances||[]; createMint=post[0]?.mint; }
  }
  if(buyTx){
    // decode the buy: which token program + ATA-create program + token-2022?
    const { tx, allK, ix }=buyTx;
    const mintAcct=allK[ix.accountKeyIndexes[2]];
    const mi=await conn.getAccountInfo(new PublicKey(mintAcct));
    console.log(`\nslot ${slot} buy ${buyTx.sig.slice(0,12)}  mint ${mintAcct.slice(0,8)} owner=${progName(mi?.owner?.toBase58())}  accts=${ix.accountKeyIndexes.length}`);
    // find ATA-create instr in same tx
    const m=tx.transaction.message;
    for(const cx of (m.compiledInstructions||[])){
      const prog=allK[cx.programIdIndex];
      if(prog===ATA_PROG){
        // ATA create: last account is the token program used
        const accts=cx.accountKeyIndexes.map(i=>allK[i]);
        console.log(`  ATA-create accts: payer=${accts[0]?.slice(0,6)} ... tokenProg=${progName(accts[accts.length-1])}`);
      }
    }
    found++; if(found>=3) break;
  }
}
if(!found) console.log('\nno atomic create+buy slot found in sample');
