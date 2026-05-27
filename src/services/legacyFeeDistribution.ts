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
} from '@solana/spl-token';
import { OnlinePumpSdk } from '@pump-fun/pump-sdk';
import { SolanaStreamClient, ICluster } from '@streamflow/stream';
import bs58 from 'bs58';

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
  collectSig?: string;
  transferSig?: string;
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
  const escrowKeyRaw = (process.env.ESCROW_WALLET_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
  if (!escrowKeyRaw) {
    return { ok: false, error: 'ESCROW_WALLET_PRIVATE_KEY not set' };
  }
  let escrow: Keypair;
  try {
    escrow = Keypair.fromSecretKey(bs58.decode(escrowKeyRaw));
  } catch (e) {
    return { ok: false, error: `Escrow key decode failed: ${e instanceof Error ? e.message : e}` };
  }
  if (escrow.publicKey.toBase58() !== config.expectedCreatorPubkey) {
    return {
      ok: false,
      error: `Safety gate: escrow pubkey ${escrow.publicKey.toBase58()} != expected creator ${config.expectedCreatorPubkey} for ${config.symbol}`,
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

  // ── Pre-flight: read BC + AMM vaults ─────────────────────────────
  const [AMM_VAULT_AUTH] = PublicKey.findProgramAddressSync(
    [Buffer.from('creator_vault'), escrow.publicKey.toBuffer()],
    PUMPSWAP_AMM,
  );
  const AMM_VAULT_WSOL_ATA = getAssociatedTokenAddressSync(
    NATIVE_MINT, AMM_VAULT_AUTH, true, TOKEN_PROGRAM_ID,
  );
  const [bcLamBN, ammAtaInfo, escrowLamPre] = await Promise.all([
    sdk.getCreatorVaultBalance(escrow.publicKey),
    conn.getAccountInfo(AMM_VAULT_WSOL_ATA, 'confirmed'),
    conn.getBalance(escrow.publicKey, 'confirmed'),
  ]);
  const bcLam = Number(bcLamBN.toString());
  const ammLam = ammAtaInfo && ammAtaInfo.data.length >= 72
    ? Number(ammAtaInfo.data.readBigUInt64LE(64)) : 0;
  const totalCollectableLam = bcLam + ammLam;

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

  // ── Step 1: collect (BC + AMM → escrow) in one tx ────────────────
  let collectSig: string;
  try {
    const collectIxs = await sdk.collectCoinCreatorFeeInstructions(escrow.publicKey, escrow.publicKey);
    const collectTx = new Transaction()
      .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }))
      .add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }))
      .add(...collectIxs);
    collectTx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
    collectTx.feePayer = escrow.publicKey;
    collectSig = await conn.sendTransaction(collectTx, [escrow]);
    await conn.confirmTransaction(collectSig, 'confirmed');
  } catch (e) {
    return { ok: false, error: `Collect failed: ${e instanceof Error ? e.message : e}`, symbol: config.symbol };
  }

  // Verify the collect actually moved funds
  const escrowLamPost = await conn.getBalance(escrow.publicKey, 'confirmed');
  const collectedActualLam = escrowLamPost - escrowLamPre;
  if (collectedActualLam < totalCollectableLam * 0.95) {
    return {
      ok: false,
      error: `Collect verify failed: escrow grew by ${collectedActualLam} lamports, expected ≥${Math.floor(totalCollectableLam * 0.95)}`,
      symbol: config.symbol,
      collectSig,
    };
  }

  // ── Step 2: transfer slot 1 wallet + holder rewards in one tx ────
  let transferSig: string;
  try {
    const transferTx = new Transaction()
      .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 150_000 }))
      .add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }))
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
    transferSig = await conn.sendTransaction(transferTx, [escrow]);
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
      collectSig,
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

  return {
    ok: true,
    symbol: config.symbol,
    collectedLamports: totalCollectableLam,
    sentToSlot1WalletLamports: sendToSlot1WalletLam,
    sentToHolderRewardsLamports: holderRewardsLam,
    freedLamports: freedLam,
    collectSig,
    transferSig,
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
