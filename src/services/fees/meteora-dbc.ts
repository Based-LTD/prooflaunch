// Meteora DBC pre-graduation fee claim adapter.
//
// Counterpart to src/services/distribution.ts collectAndCreditFees for
// pump.fun creator-vaults. Meteora's DBC accrues fees per-pool with a
// configured `creatorTradingFeePercentage` (set to 100 in our shared
// config — see tools/meteora-dbc-config.template.ts). The accrued
// fees can be claimed by the pool's `creator` (= our per-meme
// sub-escrow keypair) via client.creator.claimCreatorTradingFee.
//
// This module only handles the CLAIM (on-chain SDK call). The downstream
// 90/10 split into backers + platform reuses the existing
// distribution.ts pipeline: claim drains creator-fees to sub-escrow as
// SOL → distribution.ts already knows how to split a sub-escrow's SOL.
//
// Phase 1: pre-graduation only. Post-graduation (DAMM v2 locked
// position) claims live in a sibling module added in Phase 2.

import { Connection, Keypair, PublicKey, sendAndConfirmTransaction } from '@solana/web3.js';
import { BN } from 'bn.js';
import { DynamicBondingCurveClient } from '@meteora-ag/dynamic-bonding-curve-sdk';
import bs58 from 'bs58';
import { decryptPrivateKey } from '@/lib/crypto';

const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

// U64_MAX as BN — passed as maxBaseAmount + maxQuoteAmount to mean
// "claim everything that's accrued". The SDK clamps to actual accrued
// amount, so passing max is the standard pattern for "drain all".
const U64_MAX_BN = new BN('18446744073709551615');

interface ClaimResult {
  success: boolean;
  signature?: string;
  error?: string;
}

// Claim accrued creator-trading-fees for one DBC pool. The pool's
// creator (= our per-meme sub-escrow) must sign. Fees land in the
// creator's wrapped-SOL ATA (CollectFeeMode.QuoteToken in our config
// means fees accrue as SOL). The SDK's claim instruction unwraps the
// SOL back to the creator's native account before returning.
export async function claimCreatorFees(opts: {
  poolAddress: string;
  subEscrowEncryptedKey: string;  // encrypted_creator_subescrow_key from memes row
  subEscrowPubkey: string;        // creator_subescrow_pubkey from memes row
  payerEncryptedKey?: string;     // optional: who pays tx fees; defaults to subescrow paying its own
}): Promise<ClaimResult> {
  try {
    const conn = new Connection(RPC_URL, 'confirmed');
    const pool = new PublicKey(opts.poolAddress);
    const creator = new PublicKey(opts.subEscrowPubkey);

    const subEscrowKp = Keypair.fromSecretKey(
      bs58.decode(decryptPrivateKey(opts.subEscrowEncryptedKey)),
    );
    if (subEscrowKp.publicKey.toBase58() !== opts.subEscrowPubkey) {
      return { success: false, error: 'sub-escrow key mismatch' };
    }

    const payerKp = opts.payerEncryptedKey
      ? Keypair.fromSecretKey(bs58.decode(decryptPrivateKey(opts.payerEncryptedKey)))
      : subEscrowKp;

    const client = new DynamicBondingCurveClient(conn, 'confirmed');

    const tx = await client.creator.claimCreatorTradingFee({
      creator,
      payer: payerKp.publicKey,
      pool,
      maxBaseAmount: U64_MAX_BN,   // drain-all idiom
      maxQuoteAmount: U64_MAX_BN,  // drain-all idiom
      receiver: creator,
    });

    const signers = payerKp.publicKey.equals(subEscrowKp.publicKey)
      ? [subEscrowKp]
      : [subEscrowKp, payerKp];

    const sig = await sendAndConfirmTransaction(conn, tx, signers, {
      commitment: 'confirmed',
      skipPreflight: false,
      maxRetries: 3,
    });

    return { success: true, signature: sig };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg };
  }
}
