import { NextRequest, NextResponse } from 'next/server';
import { Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction, ComputeBudgetProgram, TransactionInstruction } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { PumpSdk, OnlinePumpSdk } from '@pump-fun/pump-sdk';
import BN from 'bn.js';

// TEMPORARY read-only: measure serialized tx size for candidate atomic
// designs. No SOL, no chain writes. DELETE after we have the numbers.
export async function POST(req: NextRequest) {
  const s = process.env.CRON_SECRET;
  if (s && req.headers.get('authorization') !== `Bearer ${s}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const LIMIT = 1232;
  const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
  const conn = new Connection(RPC, 'confirmed');
  const FEE = new PublicKey('CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM');
  const BUYBACK = new PublicKey('5cjcW9wExnJJiqgLjq7DEG75Pm6JBgE1hNv4B2vHXUW6');
  try {
    const online = new OnlinePumpSdk(conn);
    const sdk = new PumpSdk();
    await online.fetchGlobal();
    const { blockhash } = await conn.getLatestBlockhash();
    const uri = 'https://pump.mypinata.cloud/ipfs/Qmb3kCf9z2pXq7vNw8aLrT4dHs9YfE6uJ1mKpQ2sVx';
    const escrow = Keypair.generate(), mint = Keypair.generate();
    const cb = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 500000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 500000 }),
    ];
    const createIx = await sdk.createV2Instruction({
      mint: mint.publicKey, name: 'Proof Launch Token', symbol: 'PROOF',
      uri, creator: escrow.publicKey, user: escrow.publicKey,
      mayhemMode: false, cashback: false,
    });
    const buildBuy = async (buyer: Keypair, creator: Keypair) => {
      const ata = getAssociatedTokenAddressSync(mint.publicKey, buyer.publicKey, true, TOKEN_2022_PROGRAM_ID);
      const ix = await sdk.getBuyInstructionRaw({
        user: buyer.publicKey, mint: mint.publicKey, creator: creator.publicKey,
        amount: new BN(1), solAmount: new BN(50000000),
        feeRecipient: FEE, buybackFeeRecipient: BUYBACK,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      });
      return [createAssociatedTokenAccountIdempotentInstruction(buyer.publicKey, ata, buyer.publicKey, mint.publicKey, TOKEN_2022_PROGRAM_ID), ix];
    };
    const measure = (label: string, ixs: TransactionInstruction[], signers: Keypair[]) => {
      try {
        const msg = new TransactionMessage({ payerKey: signers[0].publicKey, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message();
        const tx = new VersionedTransaction(msg); tx.sign(signers);
        const sz = tx.serialize().length;
        return { label, bytes: sz, fits: sz <= LIMIT, spare: LIMIT - sz };
      } catch (e) { return { label, error: e instanceof Error ? e.message : String(e) }; }
    };
    const pool = Keypair.generate(), b1 = Keypair.generate(), b2 = Keypair.generate(), b3 = Keypair.generate();
    const results = [
      measure('A) createV2(clean dev) + 1 separate-pool buy', [...cb, createIx, ...await buildBuy(pool, escrow)], [escrow, mint, pool]),
      measure('B) createV2 + escrow(dev) buy', [...cb, createIx, ...await buildBuy(escrow, escrow)], [escrow, mint]),
      measure('C) createV2 + 2 distinct buyer buys', [...cb, createIx, ...await buildBuy(b1, escrow), ...await buildBuy(b2, escrow)], [escrow, mint, b1, b2]),
      measure('D) createV2 + 3 distinct buyer buys', [...cb, createIx, ...await buildBuy(b1, escrow), ...await buildBuy(b2, escrow), ...await buildBuy(b3, escrow)], [escrow, mint, b1, b2, b3]),
    ];
    return NextResponse.json({ limit: LIMIT, results });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
