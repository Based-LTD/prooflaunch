/**
 * Server-side automatic fee distribution for pre-Phase-2 (legacy) memes.
 *
 * Background
 * ──────────
 * Phase 2 memes have a per-coin `creator_subescrow_pubkey` that the
 * standard fee-collection cron (`collectAndCreditFees` in distribution.ts)
 * iterates and processes. Pre-Phase-2 memes (like PROOF, mint
 * `oaBXM2…pooL`) registered the SHARED platform escrow as their
 * pump.fun creator, so they're explicitly skipped by that cron.
 *
 * This module fills that gap. It mirrors the manual `proof-distribute-fees.mjs`
 * script logic, runnable server-side from inside the hourly cron.
 *
 * What it does (per supported legacy meme)
 * ────────────────────────────────────────
 *   1. Read BC creator-vault + AMM wSOL ATA balances
 *   2. Safety floor: skip if total collectable < 0.1 SOL
 *   3. Collect creator fees → shared platform escrow (one tx)
 *   4. Compute hold-weighted shares per backer (uses Streamflow-locked + direct wallet)
 *   5. Split:
 *        - Slot 1 (founder) hold-weighted share        → slot 1 wallet
 *        - Slot 4 (platform) hold-weighted share       → slot 1 wallet (consolidated)
 *        - Slot 2 + 3 (external) hold-weighted shares  → credited to claimable_fees_sol (DB)
 *        - Freed shares (dumpers' forfeited pro-rata)  → HOLDER_REWARDS_WALLET
 *        - Platform 5%                                  → slot 1 wallet
 *        - Holder rewards 5%                            → HOLDER_REWARDS_WALLET
 *   6. Single transfer tx pays slot 1 wallet + HOLDER_REWARDS_WALLET
 *   7. DB updates: bump total_claimed_sol, insert fee_claims audit rows,
 *      credit slots 2 & 3 claimable_fees_sol
 *
 * Currently hardcoded to PROOF only (the only legacy meme with meaningful
 * activity). To extend to other pre-P2 memes, add their mint + slot wallet
 * mapping to LEGACY_MEMES.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import {
  Connection, PublicKey, Keypair, Transaction, SystemProgram, ComputeBudgetProgram,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
} from '@solana/spl-token';
import { OnlinePumpSdk } from '@pump-fun/pump-sdk';
import { SolanaStreamClient, ICluster } from '@streamflow/stream';
import bs58 from 'bs58';
import { simulateAndSend, adaptivePriorityFeeIx } from '@/lib/rpcHelpers';

// ── Constants ──────────────────────────────────────────────────────
const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL!;
const PUMPSWAP_AMM = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
const PLATFORM_CUT_PCT = 0.10;            // total non-backer cut
const HOLDER_REWARDS_PCT = 0.05;          // half of platform cut → holder airdrop pool
const COLLECTABLE_FLOOR_LAMPORTS = 1e8;   // 0.1 SOL — same safety floor as manual script

interface LegacyMemeConfig {
  mintAddress: string;
  symbol: string;
  /** Wallet that receives slot 1 + slot 4 + platform 5% (founder consolidates) */
  consolidatedDestinationWallet: string;
  /** Original on-chain creator pubkey (== shared platform escrow for pre-P2) */
  expectedCreatorPubkey: string;
  /** Per-slot stake (SOL) — used for stake_frac calc */
  slotStakes: { [slotNumber: number]: number };
  /**
   * Which slots get SOL physically transferred (the rest are DB-only credits).
   * For PROOF: slot 1 (founder) + slot 4 (platform).
   */
  consolidatedSlots: number[];
}

// PROOF: the only legacy meme with meaningful activity
const LEGACY_MEMES: LegacyMemeConfig[] = [
  {
    mintAddress: 'oaBXM2rCnWFeQc9ufdTSSpASwSrMBPrSmg8xtiepooL',
    symbol: 'PROOF',
    consolidatedDestinationWallet: 'EsA8NH8588FFdhUzvxPUn9bPzr8rZi9nPz5E136bLAir',
    expectedCreatorPubkey: '83u1MraLPeq3ZqGo4GKqeg5FLk6YpSR7H7GcgZc2s9Ko',
    slotStakes: { 1: 1.5, 2: 0.1, 3: 0.1, 4: 0.1 },
    consolidatedSlots: [1, 4],
  },
];

export interface LegacyDistributionResult {
  ok: boolean;
  skipped?: string;
  symbol?: string;
  collectedLamports?: number;
  sentToSlot1WalletLamports?: number;
  sentToHolderRewardsLamports?: number;
  freedLamports?: number;
  collectSig?: string;      // BC creator-vault collect (null when graduated)
  ammCollectSig?: string;   // PumpSwap AMM creator-vault collect (null pre-graduation)
  closeSig?: string;        // wSOL ATA close/unwrap (only present after AMM collect)
  transferSig?: string;
  // When the meme's on-chain creator is the pre-rotation old escrow,
  // this is the sig of the residual sweep tx (old → new escrow).
  oldEscrowSweepSig?: string;
  error?: string;
}

/**
 * Distribute pump.fun creator fees for a single legacy (pre-P2) meme.
 * Idempotent in practice: re-running before fees re-accumulate hits the
 * safety floor and skips. No double-pay risk.
 */
export async function distributeLegacyMeme(
  supabase: SupabaseClient,
  mintAddress: string,
): Promise<LegacyDistributionResult> {
  const config = LEGACY_MEMES.find(m => m.mintAddress === mintAddress);
  if (!config) {
    return { ok: false, error: `Legacy meme config not found for ${mintAddress}` };
  }

  const conn = new Connection(RPC_URL, 'confirmed');

  // ── Load escrow (the shared platform escrow == pump.fun creator) ─
  // For pre-rotation memes (PROOF, TEST) whose on-chain creator is the
  // OLD escrow, fall back to OLD_ESCROW_WALLET_PRIVATE_KEY env. The
  // June 4 wallet rotation orphaned these memes from the new escrow,
  // and pump.fun doesn't support transferring creator authority
  // post-launch. The old key is still held by the platform owner;
  // using it here keeps fee collection live for legacy launches. After
  // distribution, residual SOL on the old escrow is swept to the new
  // escrow (see end of function).
  function loadKey(envName: string): Keypair | null {
    const raw = (process.env[envName] || '').replace(/\\n/g, '\n').trim();
    if (!raw) return null;
    try { return Keypair.fromSecretKey(bs58.decode(raw)); }
    catch { return null; }
  }
  const newEscrow = loadKey('ESCROW_WALLET_PRIVATE_KEY');
  if (!newEscrow) {
    return { ok: false, error: 'ESCROW_WALLET_PRIVATE_KEY not set or invalid' };
  }
  const oldEscrow = loadKey('OLD_ESCROW_WALLET_PRIVATE_KEY');

  let escrow: Keypair;
  let isOldEscrow = false;
  if (newEscrow.publicKey.toBase58() === config.expectedCreatorPubkey) {
    escrow = newEscrow;
  } else if (oldEscrow && oldEscrow.publicKey.toBase58() === config.expectedCreatorPubkey) {
    escrow = oldEscrow;
    isOldEscrow = true;
  } else {
    return {
      ok: false,
      error: `Safety gate: neither ESCROW (${newEscrow.publicKey.toBase58()}) nor OLD_ESCROW (${oldEscrow?.publicKey.toBase58() ?? 'unset'}) matches expected creator ${config.expectedCreatorPubkey} for ${config.symbol}. Add OLD_ESCROW_WALLET_PRIVATE_KEY env to claim pre-rotation creator vaults.`,
    };
  }

  const holderRewardsAddr = process.env.HOLDER_REWARDS_WALLET_ADDRESS;
  if (!holderRewardsAddr) {
    return { ok: false, error: 'HOLDER_REWARDS_WALLET_ADDRESS not set' };
  }
  const holderRewardsWallet = new PublicKey(holderRewardsAddr);

  const sdk = new OnlinePumpSdk(conn);

  // ── Load meme + backings ─────────────────────────────────────────
  const { data: meme } = await supabase
    .from('memes')
    .select('id, symbol')
    .eq('mint_address', mintAddress)
    .single();
  if (!meme) return { ok: false, error: `Meme not found in DB: ${mintAddress}` };

  const { data: backings } = await supabase
    .from('backings')
    .select('id, slot_number, backer_wallet, amount_sol, claimable_fees_sol, total_claimed_sol, tokens_received')
    .eq('meme_id', meme.id)
    .in('slot_number', Object.keys(config.slotStakes).map(Number))
    .eq('status', 'distributed');
  if (!backings || backings.length === 0) {
    return { ok: false, skipped: 'no_distributed_backings', symbol: config.symbol };
  }

  // ── Pre-flight: read BC + AMM vaults + escrow's own residual wSOL ─
  // Residual wSOL on escrow's own ATA happens when a previous AMM
  // collect succeeded but the close/unwrap step didn't finish (e.g.
  // pre-atomic-tx era of this code, or when close was a separate tx
  // and silently failed). Treating that residual as collectable lets
  // the flow recover automatically instead of the SOL sitting stuck
  // forever below the "no new AMM fees to trigger a run" floor.
  const [AMM_VAULT_AUTH] = PublicKey.findProgramAddressSync(
    [Buffer.from('creator_vault'), escrow.publicKey.toBuffer()],
    PUMPSWAP_AMM,
  );
  const AMM_VAULT_WSOL_ATA = getAssociatedTokenAddressSync(
    NATIVE_MINT, AMM_VAULT_AUTH, true, TOKEN_PROGRAM_ID,
  );
  const ESCROW_WSOL_ATA = getAssociatedTokenAddressSync(
    NATIVE_MINT, escrow.publicKey, true, TOKEN_PROGRAM_ID,
  );
  const [bcLamBN, ammAtaInfo, escrowWsolInfo, escrowLamPre] = await Promise.all([
    sdk.getCreatorVaultBalance(escrow.publicKey),
    conn.getAccountInfo(AMM_VAULT_WSOL_ATA, 'confirmed'),
    conn.getAccountInfo(ESCROW_WSOL_ATA, 'confirmed'),
    conn.getBalance(escrow.publicKey, 'confirmed'),
  ]);
  const bcLam = Number(bcLamBN.toString());
  const ammLam = ammAtaInfo && ammAtaInfo.data.length >= 72
    ? Number(ammAtaInfo.data.readBigUInt64LE(64)) : 0;
  const escrowWsolResidualLam = escrowWsolInfo && escrowWsolInfo.data.length >= 72
    ? Number(escrowWsolInfo.data.readBigUInt64LE(64)) : 0;
  const totalCollectableLam = bcLam + ammLam + escrowWsolResidualLam;

  // ── Safety floor ──────────────────────────────────────────────────
  if (totalCollectableLam < COLLECTABLE_FLOOR_LAMPORTS) {
    return {
      ok: true,
      skipped: `below_floor (${(totalCollectableLam / 1e9).toFixed(6)} SOL < 0.1)`,
      symbol: config.symbol,
      collectedLamports: 0,
    };
  }

  // ── Hold % per backer ─────────────────────────────────────────────
  const holdPcts: { [backingId: string]: number } = {};
  for (const b of backings) {
    holdPcts[b.id] = await computeHoldPct(conn, b, mintAddress);
  }

  // ── Distribution math (hold-weighted, freed → holders) ────────────
  const backerPoolLam = totalCollectableLam - Math.floor(totalCollectableLam * PLATFORM_CUT_PCT);
  const platformBaseLam = Math.floor(totalCollectableLam * (PLATFORM_CUT_PCT - HOLDER_REWARDS_PCT));
  const holderRewardsBaseLam = totalCollectableLam - backerPoolLam - platformBaseLam;

  const totalStakeSol = Object.values(config.slotStakes).reduce((a, b) => a + b, 0);
  const stakeFrac: { [backingId: string]: number } = {};
  for (const b of backings) {
    const stake = config.slotStakes[b.slot_number] ?? 0;
    stakeFrac[b.id] = stake / totalStakeSol;
  }

  const slotShareLam: { [backingId: string]: number } = {};
  for (const b of backings) {
    slotShareLam[b.id] = Math.floor(stakeFrac[b.id] * holdPcts[b.id] * backerPoolLam);
  }
  const totalEffectiveLam = Object.values(slotShareLam).reduce((a, b) => a + b, 0);
  const freedLam = backerPoolLam - totalEffectiveLam;
  const holderRewardsLam = holderRewardsBaseLam + freedLam;

  // Slot 1 wallet receives: consolidated slot shares + platform base 5%
  let sendToSlot1WalletLam = platformBaseLam;
  for (const b of backings) {
    if (config.consolidatedSlots.includes(b.slot_number)) {
      sendToSlot1WalletLam += slotShareLam[b.id];
    }
  }

  // ── Step 1: collect fees ─────────────────────────────────────────
  // Two-step collect for graduated tokens: try BC creator vault first
  // (may fail with AccountNotFound if graduated), then PumpSwap AMM
  // creator vault separately. Prior implementation combined both in a
  // single sdk.collectCoinCreatorFeeInstructions() call which included
  // BC-vault references — when a token graduated, the BC vault account
  // was closed, so simulate rejected the whole tx with AccountNotFound
  // and the AMM fees piled up unclaimed (2026-07-01: found 4.38 SOL
  // stuck for PROOF). Mirror of the split pattern already working in
  // src/services/distribution.ts Steps A + A2 + A3.
  let collectSig: string | null = null;
  let ammCollectSig: string | null = null;
  let closeSig: string | null = null;

  // Fee payer split. When the on-chain creator authority is OLD_ESCROW
  // (rotated out 2026-06-04), that wallet is typically drained to 0 and
  // can't afford tx fees or wSOL ATA rent (~0.003 SOL). Use NEW_ESCROW
  // as fee payer while OLD_ESCROW signs as the creator authority — old
  // ends up with the collected fees anyway, and the rent flows back on
  // ATA close.
  const feePayer = isOldEscrow ? newEscrow : escrow;

  // Step 1a: BC creator-vault collect (skip cleanly on AccountNotFound).
  if (bcLam > 0) {
    try {
      const collectIxs = await sdk.collectCoinCreatorFeeInstructions(escrow.publicKey, escrow.publicKey);
      const collectPriorityIx = await adaptivePriorityFeeIx(conn, { fallback: 50_000 });
      const collectTx = new Transaction()
        .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }))
        .add(collectPriorityIx)
        .add(...collectIxs);
      collectTx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
      collectTx.feePayer = feePayer.publicKey;
      // pump.fun collect_creator_fee authorizes via PDA seeds, so the
      // creator (escrow) does NOT need to sign — only the fee payer.
      // Including escrow as a signer when it's not marked as one in the
      // ix's account_keys triggers 'unknown signer' from web3.js's
      // partialSign.
      collectSig = await simulateAndSend(conn, collectTx, [feePayer], { label: 'legacy-bc-collect' });
      await conn.confirmTransaction(collectSig, 'confirmed');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Graduated tokens close their BC vault. AccountNotFound is the
      // expected signal — log and move on to AMM collect. Any other
      // error is a real failure and we bail.
      if (!msg.includes('AccountNotFound')) {
        return { ok: false, error: `BC collect failed: ${msg}`, symbol: config.symbol };
      }
      console.log(`[legacy-distribute] ${config.symbol} BC vault closed (graduated) — skipping BC collect, trying AMM`);
    }
  }

  // Step 1b: PumpSwap AMM creator-vault collect + wSOL unwrap in ONE
  // atomic tx. The AMM collect deposits wrapped SOL into escrow's wSOL
  // ATA; closeAccount immediately unwraps it back to native SOL. Merging
  // both into a single tx eliminates the failure mode where collect
  // succeeds but close silently fails, leaving fees stranded as wSOL
  // (which the native-SOL verify step below can't see, so distribution
  // aborts even though the collect actually worked).
  //
  // Instruction order:
  //   1. createAssociatedTokenAccountIdempotent → ATA exists
  //   2. collectCoinCreatorFee (from AMM SDK) → wSOL lands in ATA
  //   3. closeAccount → wSOL unwrapped to native SOL, ATA rent to owner
  //
  // Instructions execute sequentially inside a single tx, so ordering
  // is safe. If the whole tx fails on sim, no state changes on chain.
  if (ammLam > 0) {
    try {
      const { OnlinePumpAmmSdk, PumpAmmSdk } = await import('@pump-fun/pump-swap-sdk');
      const ammSdk = new OnlinePumpAmmSdk(conn);
      const offlineAmmSdk = new PumpAmmSdk();

      const escrowWsolAta = getAssociatedTokenAddressSync(NATIVE_MINT, escrow.publicKey, true);
      const state = await ammSdk.collectCoinCreatorFeeSolanaState(escrow.publicKey, escrowWsolAta);
      const ammCollectIxs = await offlineAmmSdk.collectCoinCreatorFee(state, feePayer.publicKey);

      const ammPriorityIx = await adaptivePriorityFeeIx(conn, { fallback: 50_000 });
      const ammTx = new Transaction()
        .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }))
        .add(ammPriorityIx)
        .add(createAssociatedTokenAccountIdempotentInstruction(
          feePayer.publicKey, escrowWsolAta, escrow.publicKey, NATIVE_MINT, TOKEN_PROGRAM_ID,
        ))
        .add(...ammCollectIxs)
        // Atomic unwrap — see Step 1b comment. wSOL amount → native SOL,
        // ATA rent → escrow (owner). Both wSOL-amount and ATA-rent
        // become spendable native SOL on escrow after this tx confirms.
        .add(createCloseAccountInstruction(
          escrowWsolAta, escrow.publicKey, escrow.publicKey, [], TOKEN_PROGRAM_ID,
        ));
      ammTx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
      ammTx.feePayer = feePayer.publicKey;
      // AMM collect: PDA-authorized, no creator signature required.
      // closeAccount: token-program-authorized, requires ATA owner
      // (escrow) to sign. So the tx needs both feePayer AND escrow
      // signatures when they're distinct.
      const signers = feePayer === escrow ? [escrow] : [feePayer, escrow];
      ammCollectSig = await simulateAndSend(conn, ammTx, signers, { label: 'legacy-amm-collect-unwrap' });
      await conn.confirmTransaction(ammCollectSig, 'confirmed');
      closeSig = ammCollectSig;  // same tx, same sig — surfaces in result for observability
    } catch (e) {
      return { ok: false, error: `AMM collect+unwrap failed: ${e instanceof Error ? e.message : e}`, symbol: config.symbol };
    }
  } else if (escrowWsolResidualLam > 0) {
    // AMM vault didn't have new fees to collect, but there's residual
    // wSOL sitting on escrow's own ATA from a prior partial run.
    // Recovery: close it standalone to unwrap → native SOL. Same
    // signer requirements as the atomic path — escrow signs as ATA
    // owner, feePayer signs the tx.
    try {
      const closeTx = new Transaction().add(
        createCloseAccountInstruction(
          ESCROW_WSOL_ATA, escrow.publicKey, escrow.publicKey, [], TOKEN_PROGRAM_ID,
        ),
      );
      closeTx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
      closeTx.feePayer = feePayer.publicKey;
      const closeSigners = feePayer === escrow ? [escrow] : [feePayer, escrow];
      closeSig = await simulateAndSend(conn, closeTx, closeSigners, { label: 'legacy-residual-unwrap' });
      await conn.confirmTransaction(closeSig, 'confirmed');
    } catch (e) {
      return { ok: false, error: `Residual wSOL unwrap failed: ${e instanceof Error ? e.message : e}`, symbol: config.symbol };
    }
  }

  // At least one collect step must have succeeded to proceed.
  if (!collectSig && !ammCollectSig) {
    return { ok: false, error: `No collect ran (bcLam=${bcLam}, ammLam=${ammLam})`, symbol: config.symbol };
  }

  // Verify the collect actually moved funds. The post-balance read can
  // lag confirmed-commitment by a few seconds on busy RPC nodes — when
  // the collect tx claims 3+ SOL across BC + AMM vaults the cron's
  // immediate getBalance() sometimes returns the pre-collect amount.
  // Retry up to 5 times (1s spacing) before failing.
  let escrowLamPost = 0;
  let collectedActualLam = 0;
  for (let attempt = 0; attempt < 5; attempt++) {
    escrowLamPost = await conn.getBalance(escrow.publicKey, 'confirmed');
    collectedActualLam = escrowLamPost - escrowLamPre;
    if (collectedActualLam >= totalCollectableLam * 0.95) break;
    if (attempt < 4) await new Promise(r => setTimeout(r, 1500));
  }
  if (collectedActualLam < totalCollectableLam * 0.95) {
    return {
      ok: false,
      error: `Collect verify failed after 5 retries: escrow grew by ${collectedActualLam} lamports, expected ≥${Math.floor(totalCollectableLam * 0.95)} (collectSig ${collectSig ?? 'n/a'} ammCollectSig ${ammCollectSig ?? 'n/a'})`,
      symbol: config.symbol,
      collectSig: collectSig ?? undefined,
      ammCollectSig: ammCollectSig ?? undefined,
      closeSig: closeSig ?? undefined,
    };
  }

  // ── Step 2: transfer slot 1 wallet + holder rewards in one tx ────
  let transferSig: string;
  try {
    // SOL-030: adaptive priority fee.
    const transferPriorityIx = await adaptivePriorityFeeIx(conn, { fallback: 50_000 });
    const transferTx = new Transaction()
      .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 150_000 }))
      .add(transferPriorityIx)
      .add(SystemProgram.transfer({
        fromPubkey: escrow.publicKey,
        toPubkey: new PublicKey(config.consolidatedDestinationWallet),
        lamports: sendToSlot1WalletLam,
      }))
      .add(SystemProgram.transfer({
        fromPubkey: escrow.publicKey,
        toPubkey: holderRewardsWallet,
        lamports: holderRewardsLam,
      }));
    transferTx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
    transferTx.feePayer = escrow.publicKey;
    // SOL-029: simulate before send.
    transferSig = await simulateAndSend(conn, transferTx, [escrow], { label: 'legacy-transfer' });
    await conn.confirmTransaction(transferSig, 'confirmed');
  } catch (e) {
    // Collect succeeded but transfer failed — funds are safe in escrow,
    // next cron tick will be skipped (vault is empty now) and the
    // already-collected SOL stays. Operator can manually transfer or
    // wait for next collection to amortize. Log loud.
    return {
      ok: false,
      error: `Transfer failed (funds safe in escrow): ${e instanceof Error ? e.message : e}`,
      symbol: config.symbol,
      collectSig: collectSig ?? undefined,
      ammCollectSig: ammCollectSig ?? undefined,
      closeSig: closeSig ?? undefined,
    };
  }

  // ── Step 3: DB updates ────────────────────────────────────────────
  // 3a: consolidated slots → bump total_claimed_sol + insert fee_claims audit rows
  for (const b of backings) {
    if (!config.consolidatedSlots.includes(b.slot_number)) continue;
    const lam = slotShareLam[b.id];
    const newClaimed = Number(b.total_claimed_sol || 0) + lam / 1e9;
    await supabase.from('backings').update({ total_claimed_sol: newClaimed }).eq('id', b.id);
    await supabase.from('fee_claims').insert({
      meme_id: meme.id,
      wallet_address: b.backer_wallet,
      amount_sol: lam / 1e9,
      claim_tx: transferSig,
      status: 'completed',
      completed_at: new Date().toISOString(),
    });
  }
  // 3b: non-consolidated slots → credit claimable_fees_sol in DB only
  for (const b of backings) {
    if (config.consolidatedSlots.includes(b.slot_number)) continue;
    const lam = slotShareLam[b.id];
    const newClaimable = Number(b.claimable_fees_sol || 0) + lam / 1e9;
    await supabase.from('backings').update({ claimable_fees_sol: newClaimable }).eq('id', b.id);
  }

  // Step 4 — sweep old-escrow residual to new escrow when isOldEscrow.
  // After the distribution txes, the old escrow still holds the rent
  // floor + any rounding remainder. We want those funds living in the
  // new escrow so all platform SOL stays centralized. Leaves 5000
  // lamports behind for the next tx fee. Non-fatal on failure.
  let oldEscrowSweepSig: string | undefined;
  if (isOldEscrow) {
    try {
      const oldBal = await conn.getBalance(escrow.publicKey, 'confirmed');
      const sweepLam = oldBal - 5000;
      if (sweepLam > 100_000) { // only sweep if > 0.0001 SOL after fee
        const sweepTx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: escrow.publicKey,
            toPubkey: newEscrow.publicKey,
            lamports: sweepLam,
          }),
        );
        sweepTx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
        sweepTx.feePayer = escrow.publicKey;
        oldEscrowSweepSig = await simulateAndSend(conn, sweepTx, [escrow], { label: 'legacy-old-escrow-sweep' });
        await conn.confirmTransaction(oldEscrowSweepSig, 'confirmed');
      }
    } catch (e) {
      // Non-fatal — funds safe in old escrow, next tick will sweep.
      console.error(`[legacy ${config.symbol}] old-escrow sweep failed (funds safe): ${e instanceof Error ? e.message : e}`);
    }
  }

  return {
    ok: true,
    symbol: config.symbol,
    collectedLamports: totalCollectableLam,
    sentToSlot1WalletLamports: sendToSlot1WalletLam,
    sentToHolderRewardsLamports: holderRewardsLam,
    freedLamports: freedLam,
    collectSig: collectSig ?? undefined,
    ammCollectSig: ammCollectSig ?? undefined,
    closeSig: closeSig ?? undefined,
    transferSig,
    oldEscrowSweepSig,
  };
}

/**
 * Hold % = (direct wallet balance + Streamflow-locked) / allocated, capped at 1.0.
 * Mirrors the script's holdPctFor() exactly. Used for hold-weighted distribution.
 */
async function computeHoldPct(
  conn: Connection,
  backing: { backer_wallet: string; tokens_received: string | null },
  mintAddress: string,
): Promise<number> {
  const allocated = BigInt(backing.tokens_received || '0');
  if (allocated === BigInt(0)) return 0;

  const owner = new PublicKey(backing.backer_wallet);
  const mint = new PublicKey(mintAddress);

  // Direct wallet balance
  let directRaw = BigInt(0);
  try {
    const accts = await conn.getParsedTokenAccountsByOwner(owner, { mint });
    directRaw = accts.value.reduce(
      (s, a) => s + BigInt(a.account.data.parsed.info.tokenAmount.amount || '0'),
      BigInt(0),
    );
  } catch {
    // Fail-closed: any RPC issue → treat as 0% (their share goes to holders)
    return 0;
  }

  // Streamflow-locked
  let lockedRaw = BigInt(0);
  try {
    const streamClient = new SolanaStreamClient(
      process.env.NEXT_PUBLIC_SOLANA_RPC_URL!,
      ICluster.Mainnet,
      'confirmed',
    );
    const streams = await streamClient.searchStreams({
      mint: mintAddress,
      sender: backing.backer_wallet,
    });
    if (streams && streams.length > 0) {
      const lockBals = await Promise.all(streams.map(async (s: { account?: { escrowTokens?: unknown } }) => {
        try {
          const raw = s.account?.escrowTokens;
          if (!raw) return BigInt(0);
          const pk = typeof raw === 'string'
            ? new PublicKey(raw)
            : new PublicKey((raw as { toBase58: () => string }).toBase58?.() ?? (raw as PublicKey));
          const info = await conn.getAccountInfo(pk);
          if (!info) return BigInt(0);
          return info.data.readBigUInt64LE(64);
        } catch {
          return BigInt(0);
        }
      }));
      lockedRaw = lockBals.reduce((s, x) => s + x, BigInt(0));
    }
  } catch {
    // No streams or stream lookup failed — locked stays 0
  }

  const effective = directRaw + lockedRaw;
  const rawPct = Number((effective * BigInt(10_000)) / allocated) / 10_000;
  return Math.min(1.0, rawPct);
}

/**
 * Iterate all legacy memes and distribute each. Called from the hourly
 * fee-process cron. Returns per-meme results for logging.
 */
export async function distributeAllLegacyMemes(
  supabase: SupabaseClient,
): Promise<Array<{ mint: string; result: LegacyDistributionResult }>> {
  const results: Array<{ mint: string; result: LegacyDistributionResult }> = [];
  for (const config of LEGACY_MEMES) {
    try {
      const result = await distributeLegacyMeme(supabase, config.mintAddress);
      results.push({ mint: config.mintAddress, result });
    } catch (e) {
      results.push({
        mint: config.mintAddress,
        result: { ok: false, error: e instanceof Error ? e.message : String(e), symbol: config.symbol },
      });
    }
  }
  return results;
}
