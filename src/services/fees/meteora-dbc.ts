// Meteora DBC pre-graduation fee claim adapter.
//
// Counterpart to src/services/distribution.ts collectAndCreditFees for
// pump.fun creator-vaults. Meteora's DBC accrues fees per-pool with a
// configured `creatorTradingFeePercentage` (set to 100 in our shared
// config — see tools/meteora-dbc-config.template.ts). The accrued
// fees can be claimed by the pool's `creator` (= our per-meme
// sub-escrow keypair) via client.creator.claimCreatorTradingFee.
//
// Phase 1: pre-graduation only. Post-graduation (DAMM v2 locked
// position) claims live in a sibling module added in Phase 2.
//
// The Phase 1 cron path (collectMeteoraFeesForCron, below) only runs
// the on-chain CLAIM. Once SOL lands in the sub-escrow, the existing
// pump.fun-derived drain+credit pipeline in distribution.ts can be
// reused — but wiring full credit-to-backers requires real trading
// fees to validate against, which we won't see until mainnet launches
// happen. For now the cron logs the claim result; the full
// credit-to-backers wiring is the next deliverable after real fees
// start flowing.

import { Connection, Keypair, PublicKey, sendAndConfirmTransaction } from '@solana/web3.js';
import { BN } from 'bn.js';
import { DynamicBondingCurveClient } from '@meteora-ag/dynamic-bonding-curve-sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import bs58 from 'bs58';
import { decryptPrivateKey } from '@/lib/crypto';
import { drainAndCreditAfterPlatformClaim } from '@/services/distribution';
import { createLaunchLogger } from '@/lib/launchLog';

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

// Cron entry point — called per-Meteora-meme by /api/fees/process.
// Currently only runs the on-chain claim (drains DBC creator-fees into
// the sub-escrow as SOL). The downstream drain+split+credit to backers
// reuses the pump.fun pipeline once we have real fee-flow data to
// validate against; until then this function logs the claim outcome.
//
// Idempotent: if no fees have accrued, the claim tx either reverts or
// confirms with zero net SOL movement — the SDK / on-chain program
// handles this. Either way the cron's next tick re-attempts.
//
// Safe-by-default: skips memes missing dbc_pool_address (legacy/pre-
// adapter rows), missing sub-escrow keys (legacy pre-P2 memes), or
// not in 'live' status.
export interface MeteoraCollectResult {
  ok: boolean;
  skipped?: string;
  claimSig?: string;
  drainSig?: string;
  collectedLamports?: number;
  backerLamports?: number;
  backerCount?: number;
  error?: string;
}

export async function collectMeteoraFeesForCron(
  supabase: SupabaseClient,
  memeId: string,
): Promise<MeteoraCollectResult> {
  const { data: meme, error } = await supabase
    .from('memes')
    .select('id, status, dbc_pool_address, creator_subescrow_pubkey, encrypted_creator_subescrow_key')
    .eq('id', memeId)
    .single();
  if (error || !meme) return { ok: false, error: 'meme not found' };
  if (meme.status !== 'live') return { ok: true, skipped: `not live (status=${meme.status})` };
  if (!meme.dbc_pool_address) return { ok: true, skipped: 'no dbc_pool_address (not a meteora launch or pre-adapter row)' };
  if (!meme.creator_subescrow_pubkey || !meme.encrypted_creator_subescrow_key) {
    return { ok: true, skipped: 'no sub-escrow (legacy pre-P2 meme)' };
  }

  // Before claiming: ensure the sub-escrow has SOL for the claim tx fee.
  // SOL memes were always implicitly funded via the launch flow, so this
  // top-up is a no-op (already > minLamports). USDC memes start with 0
  // native SOL on the sub-escrow because the launch path only ever
  // moved USDC there. Without this, claimCreatorFees throws "Attempt to
  // debit an account but found no record of a prior credit".
  try {
    const { Connection: Conn, Keypair: Kp } = await import('@solana/web3.js');
    const { ensureGasReserveAndSend } = await import('@/lib/quoteAsset');
    const bs58Mod = await import('bs58');
    const escrowRaw = (process.env.ESCROW_WALLET_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
    if (escrowRaw) {
      const escrowKp = Kp.fromSecretKey(bs58Mod.default.decode(escrowRaw));
      const subKp = Kp.fromSecretKey(bs58Mod.default.decode(decryptPrivateKey(meme.encrypted_creator_subescrow_key)));
      const conn = new Conn(RPC_URL, 'confirmed');
      await ensureGasReserveAndSend({
        conn, wallet: subKp.publicKey, minLamports: 5_000_000,
        funder: escrowKp, label: `subescrow-claim-gas:${memeId}`,
      });
    }
  } catch (e) {
    return { ok: false, error: `pre-claim sub-escrow gas top-up failed: ${e instanceof Error ? e.message : String(e)}` };
  }

  // Step A — platform-specific: claim DBC creator fees on-chain.
  // Quote currency lands in the sub-escrow (SOL → native, USDC → ATA).
  const claim = await claimCreatorFees({
    poolAddress: meme.dbc_pool_address,
    subEscrowEncryptedKey: meme.encrypted_creator_subescrow_key,
    subEscrowPubkey: meme.creator_subescrow_pubkey,
  });
  if (!claim.success) return { ok: false, error: claim.error };

  // Steps B + C — shared pipeline: drain sub-escrow → escrow, route
  // to bots, credit backers. Same code path pump.fun uses; the
  // sub-escrow doesn't care which platform put SOL in it.
  const log = createLaunchLogger(memeId);
  const credit = await drainAndCreditAfterPlatformClaim(supabase, memeId, log);

  // The claim succeeded even if drain fails (orphaned SOL in sub-escrow
  // will be caught + drained by the next cron tick). Surface both signals
  // so the caller can log the partial-success case appropriately.
  if (!credit.ok) {
    return {
      ok: false,
      claimSig: claim.signature,
      error: `claim ok but credit failed: ${credit.error}`,
    };
  }
  return {
    ok: true,
    claimSig: claim.signature,
    drainSig: credit.drainSig,
    collectedLamports: credit.collectedLamports,
    backerLamports: credit.backerLamports,
    backerCount: credit.backerCount,
  };
}
