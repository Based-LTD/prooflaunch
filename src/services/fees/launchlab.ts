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
import type { ApiV3PoolInfoStandardItemCpmm } from '@raydium-io/raydium-sdk-v2';
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

// Post-graduation CPMM claim. After a LaunchLab pool bonds and migrates
// to CPMM (per migrateType: 'cpmm' in services/launch/launchlab.ts), a
// fee-collection NFT is minted to the pool creator (= our pool wallet).
// The Raydium SDK's cpmm.collectCreatorFees automatically detects that
// the SDK owner (loaded with the pool wallet keypair) holds this NFT
// and claims the accrued fees.
//
// Pool discovery: uses raydium.api.fetchPoolByMints to look up the CPMM
// pool paired against wSOL for our mint. Off-chain API is fast and
// reliable — Raydium keeps its pool index fresh.
//
// Result path is identical to pre-grad: fees land in pool wallet's wSOL
// ATA, we close to unwrap, forward to sub-escrow. The caller
// (claimLaunchLabFees) does that downstream work uniformly.
async function claimCpmmCreatorFees(opts: {
  raydium: Raydium;
  mintAddress: string;
}): Promise<{ success: boolean; claimSig?: string; error?: string; noPoolFound?: boolean }> {
  try {
    // Discover the CPMM pool paired with wSOL for our mint. Raydium's
    // off-chain API is authoritative for pool discovery post-migration.
    const poolResp = await opts.raydium.api.fetchPoolByMints({
      mint1: opts.mintAddress,
      mint2: NATIVE_MINT.toBase58(),
    });
    const cpmmPool = (poolResp.data ?? []).find((p) => (p as { type?: string }).type === 'Standard');
    if (!cpmmPool) {
      return { success: false, noPoolFound: true, error: 'no CPMM pool found for mint against wSOL (not yet graduated?)' };
    }

    const microLamports = await getAdaptivePriorityFee(new Connection(RPC_URL, 'confirmed'), { fallback: 200_000 });

    const { execute } = await opts.raydium.cpmm.collectCreatorFees({
      poolInfo: cpmmPool as ApiV3PoolInfoStandardItemCpmm,
      txVersion: TxVersion.V0,
      computeBudgetConfig: { units: 400_000, microLamports },
    });

    const { txId } = await execute();
    return { success: true, claimSig: txId };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// Detect if an error message indicates the pool has graduated (pre-grad
// claim path returns "no fees" for both truly-no-fees AND graduated
// state — we need finer detection). Graduated LaunchLab pools return
// specific SDK errors when pre-grad claim is attempted.
function looksLikeGraduated(errMsg: string): boolean {
  return /migrated|graduated|already migrated|pool.*closed|pool.*complete|instruction.*11\b|InvalidPoolStatus/i.test(errMsg);
}

export async function claimLaunchLabFees(opts: {
  poolEncryptedKey: string;    // encrypted_pool_key from memes row
  poolPubkey: string;          // pool_wallet from memes row
  subEscrowPubkey: string;     // creator_subescrow_pubkey — destination for forwarded SOL
  mintAddress: string;         // mint_address — needed for post-grad CPMM pool discovery
}): Promise<ClaimResult & { graduated?: boolean }> {
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
    let graduated = false;
    try {
      // MakeTxData.execute returns { txId, signedTx } — single-tx path.
      const { txId } = await executeClaim();
      claimSig = txId;
      await conn.confirmTransaction(claimSig, 'confirmed');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // If the pool has no accrued fees, Raydium reverts. Not an error —
      // surface as info so upstream logs at info level. BUT: distinguish
      // "no fees on active pool" from "pool graduated → use CPMM path".
      if (looksLikeGraduated(msg)) {
        // Post-graduation flow: fall through to CPMM's collectCreatorFees.
        // Pool wallet holds the fee-collection NFT that was minted at
        // migration; Raydium SDK auto-detects that ownership when the
        // SDK is loaded with pool wallet as owner (which we already did
        // above for the pre-grad attempt).
        graduated = true;
        console.log(`[launchlab-fees] pre-grad claim rejected as graduated (${msg.slice(0, 100)}); falling through to CPMM path for mint ${opts.mintAddress}`);
        const postGrad = await claimCpmmCreatorFees({ raydium, mintAddress: opts.mintAddress });
        if (postGrad.noPoolFound) {
          // Graduation-shaped error but no CPMM pool discovered yet —
          // migration might still be in-flight. Skip this tick, retry
          // next cron cycle. Not an error to surface loudly.
          return { success: true, claimedLamports: 0, graduated: true };
        }
        if (!postGrad.success) {
          return { success: false, error: `CPMM claim failed post-graduation: ${postGrad.error}`, graduated: true };
        }
        claimSig = postGrad.claimSig!;
        await conn.confirmTransaction(claimSig, 'confirmed');
      } else if (/no fees|nothing to claim|zero balance|InsufficientFunds/i.test(msg)) {
        return { success: true, claimedLamports: 0 };
      } else {
        return { success: false, error: `claimCreatorFee failed: ${msg}` };
      }
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
      graduated,
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
  graduated?: boolean;    // true once we detected the pool migrated to CPMM
  error?: string;
}

export async function collectLaunchLabFeesForCron(
  supabase: SupabaseClient,
  memeId: string,
): Promise<LaunchLabCollectResult> {
  const { data: meme, error } = await supabase
    .from('memes')
    .select('id, symbol, status, mint_address, launchlab_pool_address, encrypted_pool_key, pool_wallet, creator_subescrow_pubkey, encrypted_creator_subescrow_key')
    .eq('id', memeId)
    .single();
  if (error || !meme) return { ok: false, error: 'meme not found' };
  if (meme.status !== 'live') return { ok: true, skipped: `not live (status=${meme.status})` };
  if (!meme.launchlab_pool_address) return { ok: true, skipped: 'no launchlab_pool_address (not a LaunchLab launch or pre-adapter row)' };
  if (!meme.pool_wallet || !meme.encrypted_pool_key) {
    return { ok: true, skipped: 'no pool wallet key (data drift)' };
  }
  if (!meme.mint_address) {
    return { ok: true, skipped: 'no mint_address (data drift — cannot lookup post-grad CPMM pool)' };
  }
  if (!meme.creator_subescrow_pubkey || !meme.encrypted_creator_subescrow_key) {
    return { ok: true, skipped: 'no sub-escrow (would-be pre-P2 meme; LaunchLab requires sub-escrow for forward routing)' };
  }

  // Step A: claim fees on-chain. Tries pre-grad LaunchLab creatorFee
  // first; if the pool has already graduated (SDK error matches
  // looksLikeGraduated), falls through to CPMM's collectCreatorFees.
  // Either path lands wSOL in pool wallet ATA → closes to unwrap →
  // forwards to sub-escrow.
  const claim = await claimLaunchLabFees({
    poolEncryptedKey: meme.encrypted_pool_key,
    poolPubkey: meme.pool_wallet,
    subEscrowPubkey: meme.creator_subescrow_pubkey,
    mintAddress: meme.mint_address,
  });
  if (!claim.success) return { ok: false, error: claim.error, graduated: claim.graduated };

  // If nothing was claimed, no point running the downstream drain.
  if (!claim.claimedLamports || claim.claimedLamports === 0) {
    return {
      ok: true,
      skipped: claim.graduated
        ? 'graduated: no CPMM fees accrued this tick (or CPMM pool not indexed yet)'
        : 'no fees accrued (claim returned zero lamports)',
      claimSig: claim.claimSig,
      graduated: claim.graduated,
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
    graduated: claim.graduated,
    error: credit.ok ? undefined : credit.error,
  };
}
