// Raydium LaunchLab pre-graduation fee claim adapter.
//
// Counterpart to src/services/fees/meteora-dbc.ts. LaunchLab pools accrue
// creator trading fees to the pool's creator authority (in our case, the
// per-meme POOL WALLET — see services/launch/launchlab.ts where poolKp
// is passed as Raydium SDK owner during createLaunchpad). The pool wallet
// signs `raydium.launchpad.claimCreatorFee` to withdraw its accrued
// share; fees land as wSOL in the pool wallet's ATA.
//
// Post-claim, we unwrap the wSOL to native SOL (close ATA), then forward
// the native SOL from pool wallet → sub-escrow so the shared distribution
// pipeline (drainAndCreditAfterPlatformClaim) can credit backers. Reusing
// the sub-escrow-based pipeline means launchlab benefits from every
// bug-fix + hold-weighted-distribution feature the meteora/pump.fun paths
// already have — no divergent code path to maintain.
//
// Key structural difference from meteora-dbc.ts:
//   - Meteora: sub-escrow IS the pool creator → signs claim directly.
//   - LaunchLab: pool wallet is the creator → signs claim → we transfer
//     forward to sub-escrow.
//
// The extra hop costs one transfer tx (~5k lamports) per collection cycle.
// Acceptable — the alternative (making the shared drain pipeline accept
// pool wallet as SOL source) touches too much shared code for one adapter.

import {
  Connection, Keypair, PublicKey, Transaction, SystemProgram, ComputeBudgetProgram, sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  Raydium, LAUNCHPAD_PROGRAM, TxVersion,
} from '@raydium-io/raydium-sdk-v2';
import {
  NATIVE_MINT, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, createCloseAccountInstruction,
} from '@solana/spl-token';
import type { SupabaseClient } from '@supabase/supabase-js';
import bs58 from 'bs58';
import { decryptPrivateKey } from '@/lib/crypto';
import { drainAndCreditAfterPlatformClaim } from '@/services/distribution';
import { createLaunchLogger } from '@/lib/launchLog';
import { adaptivePriorityFeeIx, getAdaptivePriorityFee, simulateAndSend } from '@/lib/rpcHelpers';

const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

// Minimum SOL on the pool wallet before we attempt a claim. Covers the
// claim tx fee + priority + unwrap + forward tx. If short, we top up
// from ESCROW first.
const POOL_GAS_MIN_LAMPORTS = 5_000_000; // 0.005 SOL

// Leave this much on the pool wallet AFTER the forward-to-sub-escrow tx.
// Buffer for future cron ticks — avoids repeated top-ups from ESCROW
// on every cycle when volume is steady.
const POOL_GAS_KEEP_LAMPORTS = 2_000_000; // 0.002 SOL

interface ClaimResult {
  success: boolean;
  claimSig?: string;
  closeSig?: string;
  forwardSig?: string;
  claimedLamports?: number;
  forwardedLamports?: number;
  error?: string;
}

export async function claimLaunchLabFees(opts: {
  poolEncryptedKey: string;    // encrypted_pool_key from memes row
  poolPubkey: string;          // pool_wallet from memes row
  subEscrowPubkey: string;     // creator_subescrow_pubkey — destination for forwarded SOL
}): Promise<ClaimResult> {
  try {
    const conn = new Connection(RPC_URL, 'confirmed');

    // Load pool wallet keypair (= the creator authority for the LaunchLab pool).
    const poolKp = Keypair.fromSecretKey(bs58.decode(decryptPrivateKey(opts.poolEncryptedKey)));
    if (poolKp.publicKey.toBase58() !== opts.poolPubkey) {
      return { success: false, error: 'pool wallet key mismatch — refusing to touch' };
    }
    const subEscrow = new PublicKey(opts.subEscrowPubkey);

    // Gas top-up: pool wallet is drained to ~0 after atomic launch. Before
    // any claim, ensure it can pay its own tx fees. Top up from ESCROW if needed.
    const poolBalPre = await conn.getBalance(poolKp.publicKey, 'confirmed');
    if (poolBalPre < POOL_GAS_MIN_LAMPORTS) {
      const escrowRaw = (process.env.ESCROW_WALLET_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
      if (!escrowRaw) {
        return { success: false, error: 'pool wallet underfunded and ESCROW_WALLET_PRIVATE_KEY not available for top-up' };
      }
      const escrowKp = Keypair.fromSecretKey(bs58.decode(escrowRaw));
      const topupTx = new Transaction()
        .add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }))
        .add(SystemProgram.transfer({
          fromPubkey: escrowKp.publicKey,
          toPubkey: poolKp.publicKey,
          lamports: POOL_GAS_MIN_LAMPORTS,
        }));
      topupTx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
      topupTx.feePayer = escrowKp.publicKey;
      await sendAndConfirmTransaction(conn, topupTx, [escrowKp], { commitment: 'confirmed', maxRetries: 3 });
    }

    // Load Raydium SDK with the pool wallet as owner. The SDK derives the
    // pool from the owner's creator context — we don't pass a poolId to
    // claimCreatorFee. This matches how services/launch/launchlab.ts
    // loaded it during createLaunchpad.
    const raydium = await Raydium.load({
      connection: conn,
      owner: poolKp,
      cluster: 'mainnet',
      disableFeatureCheck: true,
      blockhashCommitment: 'confirmed',
      disableLoadToken: true,
    });

    // SOL-030: adaptive priority fee, matches launchlab.ts style.
    const microLamports = await getAdaptivePriorityFee(conn, { fallback: 200_000 });

    // Build the claim tx. mintB = NATIVE_MINT because our LaunchLab pools
    // are all SOL-quoted. mintBProgram = TOKEN_PROGRAM_ID because wSOL is
    // classic SPL Token, not Token-2022.
    const { execute: executeClaim } = await raydium.launchpad.claimCreatorFee({
      programId: LAUNCHPAD_PROGRAM,
      mintB: NATIVE_MINT,
      mintBProgram: TOKEN_PROGRAM_ID,
      txVersion: TxVersion.V0,
      computeBudgetConfig: { units: 400_000, microLamports },
    });

    let claimSig: string;
    try {
      // MakeTxData.execute returns { txId, signedTx } — single-tx path.
      const { txId } = await executeClaim();
      claimSig = txId;
      await conn.confirmTransaction(claimSig, 'confirmed');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // If the pool has no accrued fees to claim, Raydium reverts. That's
      // not an error condition for the cron — surface as "no fees to claim"
      // so upstream can log info-level, not error.
      if (/no fees|nothing to claim|zero balance|InsufficientFunds/i.test(msg)) {
        return { success: true, claimedLamports: 0 };
      }
      return { success: false, error: `claimCreatorFee failed: ${msg}` };
    }

    // After claim, wSOL is sitting in pool wallet's wSOL ATA. Close it to
    // unwrap to native SOL. If the ATA doesn't exist (nothing claimed), skip.
    const poolWsolAta = getAssociatedTokenAddressSync(NATIVE_MINT, poolKp.publicKey, true, TOKEN_PROGRAM_ID);
    const wsolInfo = await conn.getAccountInfo(poolWsolAta, 'confirmed');
    let claimedLamports = 0;
    let closeSig: string | undefined;
    if (wsolInfo && wsolInfo.data.length >= 72) {
      const wsolAmount = Number(wsolInfo.data.readBigUInt64LE(64));
      claimedLamports = wsolAmount;
      if (wsolAmount > 0) {
        const closeTx = new Transaction()
          .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 60_000 }))
          .add(await adaptivePriorityFeeIx(conn, { fallback: 50_000 }))
          .add(createCloseAccountInstruction(
            poolWsolAta, poolKp.publicKey, poolKp.publicKey, [], TOKEN_PROGRAM_ID,
          ));
        closeTx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
        closeTx.feePayer = poolKp.publicKey;
        closeSig = await simulateAndSend(conn, closeTx, [poolKp], { label: 'launchlab-unwrap-wsol' });
        await conn.confirmTransaction(closeSig, 'confirmed');
      }
    }

    // Forward native SOL from pool wallet → sub-escrow, keeping a small
    // gas buffer on the pool wallet for the next cycle. If there's
    // nothing to forward (claim yielded zero), skip.
    const poolBalPost = await conn.getBalance(poolKp.publicKey, 'confirmed');
    const forwardable = poolBalPost - POOL_GAS_KEEP_LAMPORTS;
    let forwardSig: string | undefined;
    let forwardedLamports = 0;
    if (forwardable > 100_000) { // dust floor — no point paying tx fee to move sub-100k
      const forwardTx = new Transaction()
        .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 30_000 }))
        .add(await adaptivePriorityFeeIx(conn, { fallback: 50_000 }))
        .add(SystemProgram.transfer({
          fromPubkey: poolKp.publicKey,
          toPubkey: subEscrow,
          lamports: forwardable,
        }));
      forwardTx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
      forwardTx.feePayer = poolKp.publicKey;
      forwardSig = await simulateAndSend(conn, forwardTx, [poolKp], { label: 'launchlab-forward-to-subescrow' });
      await conn.confirmTransaction(forwardSig, 'confirmed');
      forwardedLamports = forwardable;
    }

    return {
      success: true,
      claimSig,
      closeSig,
      forwardSig,
      claimedLamports,
      forwardedLamports,
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// Cron entry point — called per-LaunchLab-meme by /api/fees/process.
// Runs the on-chain claim (drains LaunchLab creator-fees into the pool
// wallet, unwraps wSOL, forwards to sub-escrow), then delegates to
// the shared drain+credit pipeline which handles the sub-escrow → backers
// accounting exactly like Meteora and pump.fun paths.
//
// Idempotent: if no fees have accrued, the claim returns claimedLamports=0
// and we skip the drain (nothing to distribute). Next cron tick re-attempts.
export interface LaunchLabCollectResult {
  ok: boolean;
  skipped?: string;
  claimSig?: string;
  closeSig?: string;
  forwardSig?: string;
  claimedLamports?: number;
  forwardedLamports?: number;
  drainSig?: string;
  collectedLamports?: number;
  backerLamports?: number;
  backerCount?: number;
  platformLamports?: number;
  error?: string;
}

export async function collectLaunchLabFeesForCron(
  supabase: SupabaseClient,
  memeId: string,
): Promise<LaunchLabCollectResult> {
  const { data: meme, error } = await supabase
    .from('memes')
    .select('id, symbol, status, launchlab_pool_address, encrypted_pool_key, pool_wallet, creator_subescrow_pubkey, encrypted_creator_subescrow_key')
    .eq('id', memeId)
    .single();
  if (error || !meme) return { ok: false, error: 'meme not found' };
  if (meme.status !== 'live') return { ok: true, skipped: `not live (status=${meme.status})` };
  if (!meme.launchlab_pool_address) return { ok: true, skipped: 'no launchlab_pool_address (not a LaunchLab launch or pre-adapter row)' };
  if (!meme.pool_wallet || !meme.encrypted_pool_key) {
    return { ok: true, skipped: 'no pool wallet key (data drift)' };
  }
  if (!meme.creator_subescrow_pubkey || !meme.encrypted_creator_subescrow_key) {
    return { ok: true, skipped: 'no sub-escrow (would-be pre-P2 meme; LaunchLab requires sub-escrow for forward routing)' };
  }

  // Step A: claim fees on-chain (pool wallet as creator authority) +
  // unwrap wSOL + forward to sub-escrow.
  const claim = await claimLaunchLabFees({
    poolEncryptedKey: meme.encrypted_pool_key,
    poolPubkey: meme.pool_wallet,
    subEscrowPubkey: meme.creator_subescrow_pubkey,
  });
  if (!claim.success) return { ok: false, error: claim.error };

  // If nothing was claimed, no point running the downstream drain.
  if (!claim.claimedLamports || claim.claimedLamports === 0) {
    return {
      ok: true,
      skipped: 'no fees accrued (claim returned zero lamports)',
      claimSig: claim.claimSig,
    };
  }

  // Step B: shared drain+credit pipeline reads sub-escrow SOL balance,
  // routes to backers per hold-weight, credits claimable_fees_sol, etc.
  // Same code path Meteora + pump.fun use — sub-escrow doesn't care
  // which platform put SOL there.
  const log = createLaunchLogger(memeId);
  const credit = await drainAndCreditAfterPlatformClaim(supabase, memeId, log);

  return {
    ok: credit.ok,
    claimSig: claim.claimSig,
    closeSig: claim.closeSig,
    forwardSig: claim.forwardSig,
    claimedLamports: claim.claimedLamports,
    forwardedLamports: claim.forwardedLamports,
    drainSig: credit.drainSig,
    collectedLamports: credit.collectedLamports,
    backerLamports: credit.backerLamports,
    backerCount: credit.backerCount,
    platformLamports: credit.platformLamports,
    error: credit.ok ? undefined : credit.error,
  };
}
