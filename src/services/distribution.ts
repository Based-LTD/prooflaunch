import type { SupabaseClient } from '@supabase/supabase-js';
import { distributeFromPool, refundFromPool } from './pumpfun';
import { createLaunchLogger, type LaunchLogger } from '@/lib/launchLog';
import { Connection, PublicKey, Keypair, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { OnlinePumpSdk } from '@pump-fun/pump-sdk';
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
} from '@solana/spl-token';
import bs58 from 'bs58';
import { decryptPrivateKey } from '@/lib/crypto';
import { simulateAndSend } from '@/lib/rpcHelpers';

// PumpSwap AMM program. Used both for fee-collection from graduated
// tokens' creator vault and for the LP-feed bot action elsewhere.
const PUMP_AMM_PROGRAM_ID = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
// Rent-exempt for a 0-byte account, used to subtract rent from the
// PumpSwap creator_vault auth PDA's native SOL balance when figuring
// out how much is actually drainable.
const RENT_EXEMPT_SYSTEM_ACCOUNT_LAMPORTS = 890_880;
import { SolanaStreamClient, ICluster } from '@streamflow/stream';

// Shared, idempotent pooled-token distribution.
//
// This is the SINGLE source of truth for "release the pool's tokens to
// backers proportionally". It is called by:
//   - /api/claim          (creator-triggered, signed)
//   - reconcile (cron)     (no human in the loop — auto-settles a 'live'
//                           meme whose creator never hit Distribute)
//
// Idempotency: the proportional split is computed over ALL confirmed
// backings (stable denominator), but only backings WITHOUT a claim_tx are
// actually sent. Re-running only finishes what's left. The last unclaimed
// backer absorbs the rounding remainder so no dust is stranded.

export interface SettleResult {
  ok: boolean;
  distributed: number;            // backers paid this run
  remaining: number;              // backers still unpaid (failed this run)
  alreadyComplete?: boolean;      // nothing to do — all already distributed
  failures: { backerWallet: string; error?: string }[];
  error?: string;                 // hard error that prevented any work
}

export async function settlePoolDistribution(
  supabase: SupabaseClient,
  memeId: string,
  log: LaunchLogger = createLaunchLogger(memeId)
): Promise<SettleResult> {
  const { data: meme, error: memeErr } = await supabase
    .from('memes')
    .select('id, status, mint_address, pool_wallet, encrypted_pool_key, pool_token_balance')
    .eq('id', memeId)
    .single();

  if (memeErr || !meme) {
    return { ok: false, distributed: 0, remaining: 0, failures: [], error: 'Meme not found' };
  }
  if (meme.status !== 'live' || !meme.mint_address || !meme.pool_wallet || !meme.encrypted_pool_key) {
    return { ok: false, distributed: 0, remaining: 0, failures: [], error: 'Meme not in a distributable state' };
  }

  const poolTokens = BigInt(meme.pool_token_balance || 0);
  if (poolTokens <= BigInt(0)) {
    return { ok: false, distributed: 0, remaining: 0, failures: [], error: 'No pooled tokens recorded for this meme' };
  }

  const { data: all } = await supabase
    .from('backings')
    .select('id, backer_wallet, amount_sol, claim_tx')
    .eq('meme_id', memeId)
    .eq('status', 'confirmed')
    .order('created_at', { ascending: true });

  if (!all || all.length === 0) {
    return { ok: false, distributed: 0, remaining: 0, failures: [], error: 'No confirmed backings' };
  }

  const totalSol = all.reduce((s, b) => s + Number(b.amount_sol), 0);
  let running = BigInt(0);
  const planned = all.map((b, i) => {
    let toks: bigint;
    if (i === all.length - 1) {
      toks = poolTokens - running; // last gets exact remainder
    } else {
      toks = (poolTokens * BigInt(Math.round(Number(b.amount_sol) * 1e9))) / BigInt(Math.round(totalSol * 1e9));
      running += toks;
    }
    return { id: b.id, backerWallet: b.backer_wallet, tokens: toks.toString(), alreadyClaimed: !!b.claim_tx };
  });

  const todo = planned.filter((p) => !p.alreadyClaimed);
  if (todo.length === 0) {
    return { ok: true, distributed: 0, remaining: 0, alreadyComplete: true, failures: [] };
  }

  const { results } = await distributeFromPool(
    meme.encrypted_pool_key,
    meme.pool_wallet,
    meme.mint_address,
    todo.map((t) => ({ backerWallet: t.backerWallet, tokens: t.tokens })),
    log
  );

  let ok = 0;
  const failures: { backerWallet: string; error?: string }[] = [];
  for (const r of results) {
    const p = todo.find((t) => t.backerWallet === r.backerWallet);
    if (!p) continue;
    if (r.signature) {
      await supabase
        .from('backings')
        .update({
          status: 'distributed',
          claim_tokens: r.tokens,
          claim_tx: r.signature,
          claimed_at: new Date().toISOString(),
          tokens_received: r.tokens,
        })
        .eq('id', p.id);
      ok++;
    } else {
      failures.push({ backerWallet: r.backerWallet, error: r.error });
    }
  }

  return {
    ok: failures.length === 0,
    distributed: ok,
    remaining: failures.length,
    failures,
  };
}

export interface RefundPoolResult {
  ok: boolean;
  refunded: number;               // backers refunded this run
  remaining: number;              // backers still owed (failed this run)
  failures: { backerWallet: string; error?: string }[];
  error?: string;                 // hard error (e.g. legacy meme, no pool)
  legacy?: boolean;               // no pool wallet — caller should use the
                                  // burner refund path instead
  markedFailed?: boolean;         // meme status set to 'failed' this run
}

// Shared, idempotent "this meme will never launch — make every backer
// whole from the pool" operation. Called when a meme fails to fill by
// its deadline, or fills but the creator abandons the launch. 0% fee:
// the backer did nothing wrong. Only 'confirmed' backings are touched,
// so it is safe to re-run; already-withdrawn/refunded backers are
// skipped. The meme is flipped to 'failed' once every backer is clear.
export async function refundMemePool(
  supabase: SupabaseClient,
  memeId: string,
  log: LaunchLogger = createLaunchLogger(memeId)
): Promise<RefundPoolResult> {
  const { data: meme, error: memeErr } = await supabase
    .from('memes')
    .select('id, status, pool_wallet, encrypted_pool_key')
    .eq('id', memeId)
    .single();

  if (memeErr || !meme) {
    return { ok: false, refunded: 0, remaining: 0, failures: [], error: 'Meme not found' };
  }
  // Never refund a meme that already launched (or is mid-launch): the
  // pool is committed to the on-chain buy.
  if (meme.status === 'live' || meme.status === 'launching') {
    return { ok: false, refunded: 0, remaining: 0, failures: [], error: `Meme is ${meme.status}; pool is committed` };
  }
  if (!meme.pool_wallet || !meme.encrypted_pool_key) {
    // Legacy meme (per-backer burners) — caller falls back to the burner
    // refund path. Not an error.
    return { ok: false, refunded: 0, remaining: 0, failures: [], legacy: true };
  }

  const { data: backings } = await supabase
    .from('backings')
    .select('id, backer_wallet, amount_sol')
    .eq('meme_id', memeId)
    .eq('status', 'confirmed')
    .order('created_at', { ascending: true });

  if (!backings || backings.length === 0) {
    // Nothing owed — make sure the meme is closed out.
    if (meme.status !== 'failed') {
      await supabase.from('memes').update({ status: 'failed' }).eq('id', memeId);
    }
    return { ok: true, refunded: 0, remaining: 0, failures: [], markedFailed: true };
  }

  let ok = 0;
  const failures: { backerWallet: string; error?: string }[] = [];
  for (const b of backings) {
    const r = await refundFromPool(
      meme.encrypted_pool_key,
      meme.pool_wallet,
      b.backer_wallet,
      Number(b.amount_sol),
      0 // failed meme — full refund, no fee
    );
    if (r.success) {
      await supabase
        .from('backings')
        .update({ status: 'refunded', refund_tx: r.signature })
        .eq('id', b.id);
      ok++;
      log('reconcile_refunded', {
        backerWallet: b.backer_wallet,
        signature: r.signature,
        detail: { amountSol: r.amountRefunded, reason: 'pool refund (meme failed)' },
      });
    } else {
      failures.push({ backerWallet: b.backer_wallet, error: r.error });
      log('reconcile_error', {
        backerWallet: b.backer_wallet,
        ok: false,
        detail: { stage: 'pool refund', error: r.error },
      });
    }
  }

  let markedFailed = false;
  if (failures.length === 0 && meme.status !== 'failed') {
    await supabase.from('memes').update({ status: 'failed' }).eq('id', memeId);
    markedFailed = true;
  }

  return {
    ok: failures.length === 0,
    refunded: ok,
    remaining: failures.length,
    failures,
    markedFailed,
  };
}

// =============================================================
// Per-coin trading-fee collection + per-backer accrual (Phase 4)
// =============================================================
//
// For coins launched with a per-meme sub-escrow as `coin_creator`
// (Phase 2+3): pump auto-routes trading creator fees into the
// sub-escrow's `creator-vault` PDA. This function:
//
//   1) Collects the vault (anyone can poke; escrow pays gas)
//   2) Drains the sub-escrow into the shared escrow (drain-to-zero —
//      same lesson refundFromPool just learned)
//   3) Credits each distributed backer's `claimable_fees_sol` by their
//      proportional share of 90% of what landed in escrow; 10% is
//      retained as platform revenue (just by NOT crediting it)
//
// Idempotent in the only way it needs to be: the on-chain vault is
// the source of truth. If a tick already collected (vault=0 now),
// next tick sees nothing to do and skips. The window where Step C's
// per-backer credit loop could crash mid-iteration is tiny in
// practice (DB writes are fast, cron is non-parallel) and detectable
// via on-chain↔DB delta. Audit log table can come later.
//
// Two separate txs (collect, then drain) rather than one combined
// tx — slight extra gas (~5k lamports) vs greatly simpler retry
// semantics if either step fails.

const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
// Default split when a meme has no per-meme fee config (legacy / pre-Phase-2):
// 10% platform / 90% backers. Phase-2+ memes override via meme.fee_backer_pct.
const DEFAULT_PLATFORM_FEE_CUT = 0.10;
const COLLECT_THRESHOLD_LAMPORTS = 50_000; // skip if vault < this (~$0.0075) — amortizes 2 × 5k tx fees with safety margin

function loadEscrow(): Keypair {
  const k = process.env.ESCROW_WALLET_PRIVATE_KEY;
  if (!k) throw new Error('ESCROW_WALLET_PRIVATE_KEY not set');
  return Keypair.fromSecretKey(bs58.decode(k));
}
function decryptKeypair(enc: string): Keypair {
  return Keypair.fromSecretKey(bs58.decode(decryptPrivateKey(enc)));
}

export interface CollectAndCreditResult {
  ok: boolean;
  skipped?: string;
  collectedLamports?: number;
  platformLamports?: number;
  backerLamports?: number;
  backerCount?: number;
  collectSig?: string;
  drainSig?: string;
  error?: string;
}

export async function collectAndCreditFees(
  supabase: SupabaseClient,
  memeId: string,
  log: LaunchLogger = createLaunchLogger(memeId)
): Promise<CollectAndCreditResult> {
  const { data: meme, error: memeErr } = await supabase
    .from('memes')
    .select('id, status, creator_subescrow_pubkey, encrypted_creator_subescrow_key, mint_address, fee_distribution_mode, fee_backer_pct, fee_holder_rewards_pct, fee_platform_pct, buyback_bot_enabled, buyback_bot_fee_pct, buyback_bot_wallet, quote_currency, partner_id')
    .eq('id', memeId)
    .single();
  if (memeErr || !meme) return { ok: false, error: 'meme not found' };
  if (meme.status !== 'live') return { ok: true, skipped: `not live (status=${meme.status})` };
  if (!meme.creator_subescrow_pubkey || !meme.encrypted_creator_subescrow_key) {
    return { ok: true, skipped: 'legacy meme (no sub-escrow; trading fees route to shared escrow as platform revenue)' };
  }

  // Decrypt sub-escrow keypair + pubkey-match safety gate
  let subKp: Keypair;
  try { subKp = decryptKeypair(meme.encrypted_creator_subescrow_key); }
  catch (e) { return { ok: false, error: `sub-escrow decrypt failed: ${e instanceof Error ? e.message : String(e)}` }; }
  if (subKp.publicKey.toBase58() !== meme.creator_subescrow_pubkey) {
    return { ok: false, error: 'sub-escrow key mismatch — refusing to touch' };
  }

  const conn = new Connection(RPC_URL, 'confirmed');
  const sdk = new OnlinePumpSdk(conn);

  // Check BOTH the BC creator-vault AND the sub-escrow wallet itself.
  // Normal case: vault has fresh fees, sub-escrow is empty → collect + drain.
  // Recovery case: vault is empty (collect already happened), sub-escrow
  //   has orphaned SOL from a previous half-completed run (drain failed,
  //   or timing race made the immediate drain fail) → skip collect, just
  //   drain + credit. Fixes the bug where a transient RPC propagation
  //   delay between collect and drain leaves SOL stuck in sub-escrow
  //   forever, because the next cron tick would see vault=empty and skip.
  const vaultBN = await sdk.getCreatorVaultBalance(subKp.publicKey);
  const vaultLamports = Number(vaultBN.toString());
  const escrow = loadEscrow();
  const subBalancePre = await conn.getBalance(subKp.publicKey);
  const ORPHANED_FLOOR = COLLECT_THRESHOLD_LAMPORTS; // same threshold

  // Probe the AMM-side surfaces and sub-escrow's wSOL ATA so the early
  // exit considers ALL drainable lamports, not just BC vault + native
  // SOL on sub-escrow. Without this, a graduated token whose BC vault
  // is empty would short-circuit here even when its AMM vault holds
  // SOL — exactly the bug that let GO's PumpSwap fees pile up to ~4 SOL.
  const [ammAuth] = PublicKey.findProgramAddressSync(
    [Buffer.from('creator_vault'), subKp.publicKey.toBuffer()],
    PUMP_AMM_PROGRAM_ID,
  );
  const ammWsolAtaProbe = getAssociatedTokenAddressSync(NATIVE_MINT, ammAuth, true);
  const subWsolAtaProbe = getAssociatedTokenAddressSync(NATIVE_MINT, subKp.publicKey, true);
  const [ammAuthBalProbe, ammWsolInfoProbe, subWsolInfoProbe] = await Promise.all([
    conn.getBalance(ammAuth),
    conn.getAccountInfo(ammWsolAtaProbe),
    conn.getAccountInfo(subWsolAtaProbe),
  ]);
  const ammAuthFeesProbe = Math.max(0, ammAuthBalProbe - RENT_EXEMPT_SYSTEM_ACCOUNT_LAMPORTS);
  const ammWsolBalProbe = ammWsolInfoProbe ? Number(ammWsolInfoProbe.data.readBigUInt64LE(64)) : 0;
  const subWsolBalProbe = subWsolInfoProbe ? Number(subWsolInfoProbe.data.readBigUInt64LE(64)) : 0;
  const ammDrainableProbe = ammAuthFeesProbe + ammWsolBalProbe;
  const totalDrainable = vaultLamports + subBalancePre + ammDrainableProbe + subWsolBalProbe;

  if (totalDrainable < COLLECT_THRESHOLD_LAMPORTS) {
    return { ok: true, skipped: `total drainable ${totalDrainable} lamports across all surfaces below threshold ${COLLECT_THRESHOLD_LAMPORTS}` };
  }

  // Step A: collect_creator_fee — ONLY if there's something in the vault.
  // creator is NOT a signer (verified in IDL); anyone can poke. Escrow
  // as feePayer (~5k lamports).
  let collectSig: string | null = null;
  if (vaultLamports >= COLLECT_THRESHOLD_LAMPORTS) {
    try {
      const collectIxs = await sdk.collectCoinCreatorFeeInstructions(subKp.publicKey, escrow.publicKey);
      const tx = new Transaction().add(...collectIxs);
      tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
      tx.feePayer = escrow.publicKey;
      // SOL-029: simulate before send.
      collectSig = await simulateAndSend(conn, tx, [escrow], { label: 'collect-creator-fee' });
      await conn.confirmTransaction(collectSig, 'confirmed');
      log('reconcile_recovered', { detail: { stage: 'collect_creator_fee', sig: collectSig, vaultLamports } });
    } catch (e) {
      return { ok: false, error: `collect failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  } else {
    log('reconcile_recovered', { detail: { stage: 'recovery_drain', subBalancePre, vaultLamports, note: 'orphaned sub-escrow SOL from prior run, draining without re-collect' } });
  }

  // Step A2: PumpSwap creator vault collect. Tokens that graduated from
  // pump.fun's bonding curve continue earning creator-fees, but the new
  // fees flow to a SEPARATE vault under the PumpSwap AMM program. Until
  // 2026-06-16 we never collected from this — GO's first day produced
  // ~4.3 SOL that piled up here and on the sub-escrow's wSOL ATA before
  // a one-shot script recovered it. This step prevents that drift from
  // ever recurring. The SDK call drains both the auth-PDA native SOL
  // and the auth-PDA-owned wSOL ATA in one tx, into the sub-escrow's
  // wSOL ATA (which the close step below unwraps to native SOL).
  let ammCollectSig: string | null = null;
  let ammCollectedLamports = 0;
  try {
    const { OnlinePumpAmmSdk, PumpAmmSdk } = await import('@pump-fun/pump-swap-sdk');
    const ammSdk = new OnlinePumpAmmSdk(conn);
    const offlineAmmSdk = new PumpAmmSdk();

    const [ammAuth] = PublicKey.findProgramAddressSync(
      [Buffer.from('creator_vault'), subKp.publicKey.toBuffer()],
      PUMP_AMM_PROGRAM_ID,
    );
    const ammWsolAta = getAssociatedTokenAddressSync(NATIVE_MINT, ammAuth, true);
    const [ammAuthBal, ammWsolInfo] = await Promise.all([
      conn.getBalance(ammAuth),
      conn.getAccountInfo(ammWsolAta),
    ]);
    const ammAuthFees = Math.max(0, ammAuthBal - RENT_EXEMPT_SYSTEM_ACCOUNT_LAMPORTS);
    const ammWsolBal = ammWsolInfo ? Number(ammWsolInfo.data.readBigUInt64LE(64)) : 0;
    ammCollectedLamports = ammAuthFees + ammWsolBal;

    if (ammCollectedLamports >= COLLECT_THRESHOLD_LAMPORTS) {
      const subWsolAta = getAssociatedTokenAddressSync(NATIVE_MINT, subKp.publicKey, true);
      const state = await ammSdk.collectCoinCreatorFeeSolanaState(subKp.publicKey, subWsolAta);
      const collectIxs = await offlineAmmSdk.collectCoinCreatorFee(state, escrow.publicKey);
      const tx = new Transaction();
      tx.add(createAssociatedTokenAccountIdempotentInstruction(
        escrow.publicKey, subWsolAta, subKp.publicKey, NATIVE_MINT, TOKEN_PROGRAM_ID,
      ));
      tx.add(...collectIxs);
      tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
      tx.feePayer = escrow.publicKey;
      ammCollectSig = await simulateAndSend(conn, tx, [escrow], { label: 'pump-amm-creator-collect' });
      await conn.confirmTransaction(ammCollectSig, 'confirmed');
      log('reconcile_recovered', { detail: { stage: 'pump_amm_collect', sig: ammCollectSig, ammCollectedLamports } });
    }
  } catch (e) {
    // Don't fail the whole pipeline — BC collect may have succeeded and
    // we want that SOL to flow through. The next cron tick retries the
    // AMM collect.
    log('reconcile_error', { detail: { stage: 'pump_amm_collect_failed', err: e instanceof Error ? e.message : String(e) } });
  }

  // Step A3: Close sub-escrow's wSOL ATA. Catches wrapped SOL left over
  // from BOTH the BC collect and the AMM collect just done. Without this,
  // wSOL accumulates on the sub-escrow's ATA forever — the drain below
  // reads native-SOL balance and is blind to wSOL. (How we found this:
  // 2.5 SOL of orphaned wSOL on GO's sub-escrow 2026-06-16.)
  try {
    const subWsolAta = getAssociatedTokenAddressSync(NATIVE_MINT, subKp.publicKey, true);
    const subWsolInfo = await conn.getAccountInfo(subWsolAta);
    if (subWsolInfo) {
      const closeTx = new Transaction().add(
        createCloseAccountInstruction(subWsolAta, subKp.publicKey, subKp.publicKey, [], TOKEN_PROGRAM_ID),
      );
      closeTx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
      closeTx.feePayer = escrow.publicKey;
      const closeSig = await simulateAndSend(conn, closeTx, [escrow, subKp], { label: 'close-sub-wsol' });
      await conn.confirmTransaction(closeSig, 'confirmed');
      log('reconcile_recovered', { detail: { stage: 'close_sub_wsol_ata', sig: closeSig } });
    }
  } catch (e) {
    log('reconcile_error', { detail: { stage: 'close_sub_wsol_failed', err: e instanceof Error ? e.message : String(e) } });
  }

  // Steps B + C — drain sub-escrow + credit backers / bots — are entirely
  // platform-agnostic (sub-escrow holds SOL after EITHER pump.fun's
  // collect_creator_fee or Meteora's claimCreatorTradingFee). Delegated
  // to the shared helper so both fee-collection cron paths converge here.
  return drainAndCreditFromSubEscrow({
    supabase, meme, subKp, conn, escrow, collectSig, log,
  });
}

// Shared post-collect pipeline. Called by both:
//   - collectAndCreditFees (pump.fun: after collect_creator_fee)
//   - drainAndCreditAfterPlatformClaim (Meteora: after claimCreatorTradingFee)
//
// Assumes SOL has already landed in subKp.publicKey by the time it runs.
// Idempotent up to balance availability: if sub-escrow is empty (orphaned
// or already drained), returns ok:false so the caller can decide.
interface MemeForCredit {
  id: string;
  mint_address?: string | null;
  fee_distribution_mode?: string | null;
  fee_backer_pct?: number | null;
  // Configured holder-rewards / platform split. NULL on legacy memes →
  // treated as 0/10 by the splitter so behavior is unchanged. Standard
  // preset (post-2026-06-23) sets these to 5/5.
  fee_holder_rewards_pct?: number | null;
  fee_platform_pct?: number | null;
  // Quote currency drives the drain + bot-delegation transfer paths.
  // 'sol' (default for legacy + pump.fun) uses lamports + SystemProgram.transfer.
  // 'usdc' reads the sub-escrow's USDC ATA + SPL TransferChecked.
  quote_currency?: 'sol' | 'usdc' | null;
  // Non-null = partner-originated launch; distribution sub-splits the
  // platform fee per partners.rev_share_bps. NULL = direct launch.
  partner_id?: string | null;
}

async function drainAndCreditFromSubEscrow(args: {
  supabase: SupabaseClient;
  meme: MemeForCredit;
  subKp: Keypair;
  conn: Connection;
  escrow: Keypair;
  collectSig?: string | null;
  log: LaunchLogger;
}): Promise<CollectAndCreditResult> {
  const { supabase, meme, subKp, conn, escrow, collectSig, log } = args;

  // Default to legacy_flat if the column is null (handles pre-migration rows)
  const feeMode: 'legacy_flat' | 'hold_weighted' =
    meme.fee_distribution_mode === 'hold_weighted' ? 'hold_weighted' : 'legacy_flat';

  // Quote currency drives the drain. SOL flow byte-identical to pre-USDC;
  // USDC reads the sub-escrow's USDC ATA + SPL transfer.
  const qc: 'sol' | 'usdc' = meme.quote_currency === 'usdc' ? 'usdc' : 'sol';

  // Step B: drain sub-escrow → shared escrow, drain-to-zero.
  // Retry the balance read up to 5 times with 1s delay to handle the
  // collect→drain timing race where RPC nodes haven't yet propagated
  // the new sub-escrow balance. Each loop iteration also re-reads the
  // balance, so a slow-confirming collect won't trick us into thinking
  // sub-escrow is empty.
  const BASE_FEE = 5000;
  const { readQuoteBalance, buildQuoteTransferIxs, ensureGasReserveAndSend } = await import('@/lib/quoteAsset');

  let subQuoteRaw: bigint = BigInt(0);
  for (let attempt = 0; attempt < 5; attempt++) {
    subQuoteRaw = await readQuoteBalance(conn, subKp.publicKey, qc);
    if (qc === 'sol' ? subQuoteRaw > BigInt(BASE_FEE) : subQuoteRaw > BigInt(0)) break;
    if (attempt < 4) await new Promise(r => setTimeout(r, 1000));
  }
  // SOL: leave BASE_FEE behind for the drain tx fee. USDC: drain the full
  // USDC ATA (gas comes from native SOL, topped up below).
  const transferRaw = qc === 'sol'
    ? subQuoteRaw - BigInt(BASE_FEE)
    : subQuoteRaw;
  if (transferRaw <= BigInt(0)) {
    return { ok: false, error: `sub-escrow balance ${subQuoteRaw} too low for drain (collectSig ${collectSig ?? 'none — recovery path'}; investigate manually)` };
  }

  // USDC path: sub-escrow may have 0 SOL for gas (USDC-only memes never
  // funded their sub-escrow with SOL). Top up enough for the drain tx.
  // ~0.0015 SOL covers ATA-create + transferChecked + buffer. Idempotent.
  if (qc === 'usdc') {
    try {
      const topup = await ensureGasReserveAndSend({
        conn, wallet: subKp.publicKey, minLamports: 1_500_000,
        funder: escrow, label: `usdc-subescrow-gas:${meme.id}`,
      });
      if (topup.toppedUpLamports > 0) {
        log('reconcile_recovered', { detail: { stage: 'usdc_subescrow_gas_topup', sig: topup.sig, lamports: topup.toppedUpLamports } });
      }
    } catch (e) {
      return {
        ok: false,
        error: `usdc sub-escrow gas top-up failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

  let drainSig: string;
  try {
    const tx = new Transaction();
    for (const ix of buildQuoteTransferIxs({
      from: subKp.publicKey,
      to: escrow.publicKey,
      amountRaw: transferRaw,
      qc,
      payer: subKp.publicKey,
    })) tx.add(ix);
    tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
    tx.feePayer = subKp.publicKey;
    // SOL-029: simulate before send.
    drainSig = await simulateAndSend(conn, tx, [subKp], { label: 'drain-subescrow' });
    await conn.confirmTransaction(drainSig, 'confirmed');
    log('reconcile_recovered', { detail: { stage: 'drain_subescrow_to_escrow', sig: drainSig, lamports: transferRaw.toString(), quote: qc } });
  } catch (e) {
    // Drain failed but collect succeeded (or this was a recovery run).
    // Funds are in sub-escrow safely. Next cron tick will catch it.
    return {
      ok: false,
      error: `drain failed: ${e instanceof Error ? e.message : String(e)} — sub-escrow holds ${subQuoteRaw} ${qc.toUpperCase()} raw units (collectSig ${collectSig ?? 'recovery'})`,
    };
  }

  // Step C: credit backers proportionally.
  // Backer cut comes from the per-meme config (fee_backer_pct, Phase 2+).
  // Legacy memes (no config) fall back to the historical 90/10 split.
  // Everything not credited to backers stays in escrow as platform
  // retention; unimplemented destinations (holder rewards, burn, charity)
  // are not yet wired and the submit API blocks setting them above 0.
  //
  // Backer pool is then split by mode:
  //   legacy_flat:    pure pro-rata by stake (every backer earns regardless of hold)
  //   hold_weighted:  pro-rata × current hold % (capped 100%). The ENTIRE
  //                   freed-up portion from dumpers flows to the holder
  //                   airdrop pool. Brand: every backer dump on every meme
  //                   pays every PROOF holder.
  const backerCut =
    typeof meme.fee_backer_pct === 'number' && meme.fee_backer_pct >= 0 && meme.fee_backer_pct <= 100
      ? meme.fee_backer_pct / 100
      : 1 - DEFAULT_PLATFORM_FEE_CUT;
  // From here down, "lamports" is a misnomer for USDC memes — values are
  // actually USDC raw (6-decimals) units. The math is identical because
  // every operation is proportional splits. Display layers read
  // meme.quote_currency to pick the right unit label.
  const collectedLamports = Number(transferRaw);
  const rawBackerPoolLamports = Math.floor(collectedLamports * backerCut);

  // Phase B — Bot stack fee delegation. Read the meme's bot stack from
  // meme_bots and route each bot's share of the backer pool to its
  // own dedicated wallet. Backer pool is reduced by the sum of all
  // bot shares; platform's cut stays unchanged.
  //
  // Example for a stack of 2 bots at 20% (BURN) + 25% (SOL→HOLDERS):
  //   - rawBackerPool = 90% of collected
  //   - bot1 gets 20% of rawBackerPool, sent to bot1.wallet
  //   - bot2 gets 25% of rawBackerPool, sent to bot2.wallet
  //   - remaining 55% of rawBackerPool distributed to backers
  //
  // Each transfer is independent — if one bot's transfer fails, the
  // others still happen. Failed transfers leave SOL in escrow for the
  // next collection cycle to retry.
  // Migration 055: expired bots are skipped here so their share of new
  // fees flows back to backers instead of accumulating in a wallet that
  // can't act on it. The filter is applied in SQL so the bot isn't even
  // pulled from the DB once it's past its cutoff.
  const nowIso = new Date().toISOString();
  const { data: bots } = await supabase
    .from('meme_bots')
    .select('id, action, fee_pct, bot_wallet, expires_at')
    .eq('meme_id', meme.id)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .order('slot_order', { ascending: true });

  type BotPayout = { id: string; action: string; pct: number; wallet: string; lamports: number; sig?: string; error?: string };
  const botPayouts: BotPayout[] = [];
  let totalBotShareLamports = 0;
  for (const bot of bots || []) {
    const pct = Number(bot.fee_pct) / 100;
    const shareLam = Math.floor(rawBackerPoolLamports * pct);
    botPayouts.push({ id: bot.id, action: bot.action, pct, wallet: bot.bot_wallet, lamports: shareLam });
    totalBotShareLamports += shareLam;
  }

  const backerPoolLamports = rawBackerPoolLamports - totalBotShareLamports;
  // Non-backer/non-bot residue is split between $PROOF holder rewards and
  // the platform per the meme's configured ratio. Pre-2026-06-23 behavior:
  // fee_holder_rewards_pct defaulted to 0 → 100% retained as platform. Per
  // the standing roadmap commitment, the 'standard' preset now defaults
  // to 5/5 (holder/platform) — see src/app/submit/page.tsx FEE_PRESETS.
  // Memes launched under the legacy 90/0/10 default still split 0/10 here,
  // so this is fully backward-compatible.
  const nonBackerLamports = collectedLamports - backerPoolLamports - totalBotShareLamports;
  const holderPct = Number(meme.fee_holder_rewards_pct ?? 0);
  const platformPct = Number(meme.fee_platform_pct ?? 10);
  const nonBackerPctTotal = holderPct + platformPct;
  const holderRewardsConfigLamports = nonBackerPctTotal > 0
    ? Math.floor(nonBackerLamports * holderPct / nonBackerPctTotal)
    : 0;
  const platformLamports = nonBackerLamports - holderRewardsConfigLamports;

  // Pay $PROOF holder rewards UP FRONT — before any bot/partner/backer
  // paths or early-exit returns. The 5%-to-stakers-forever obligation
  // is independent of whether the meme has backers, dumpers, or partners;
  // it's a token-holder yield obligation paid out of the platform cut.
  // Fires once per drain cycle even if downstream credit paths early-exit.
  let holderRewardsConfigSig: string | undefined;
  if (holderRewardsConfigLamports > 0) {
    const holderRewardsAddr = process.env.HOLDER_REWARDS_WALLET_ADDRESS;
    if (holderRewardsAddr) {
      try {
        const tx = new Transaction();
        for (const ix of buildQuoteTransferIxs({
          from: escrow.publicKey,
          to: new PublicKey(holderRewardsAddr),
          amountRaw: BigInt(holderRewardsConfigLamports),
          qc,
          payer: escrow.publicKey,
        })) tx.add(ix);
        tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
        tx.feePayer = escrow.publicKey;
        holderRewardsConfigSig = await simulateAndSend(conn, tx, [escrow], { label: 'configured-holder-rewards' });
        await conn.confirmTransaction(holderRewardsConfigSig, 'confirmed');
        log('reconcile_recovered', { detail: { stage: 'configured_holder_rewards', sig: holderRewardsConfigSig, lamports: holderRewardsConfigLamports, holderPct, quote: qc } });
      } catch (e) {
        log('reconcile_error', { ok: false, detail: { stage: 'configured_holder_rewards', err: e instanceof Error ? e.message : String(e), lamports: holderRewardsConfigLamports, quote: qc } });
      }
    }
  }

  // Transfer each bot its share. We use one tx per bot for clean
  // per-bot tx receipts (auditable on Solscan). Total bot count is
  // capped at 6 by UNIQUE (meme_id, action) so this loop is bounded.
  // SOL: SystemProgram.transfer; USDC: idempotent ATA-create + SPL
  // TransferChecked. Escrow pays both gas and ATA rent (~0.002 SOL
  // per first-time bot wallet on USDC memes).
  for (const p of botPayouts) {
    if (p.lamports <= 0) continue;
    try {
      const tx = new Transaction();
      for (const ix of buildQuoteTransferIxs({
        from: escrow.publicKey,
        to: new PublicKey(p.wallet),
        amountRaw: BigInt(p.lamports),
        qc,
        payer: escrow.publicKey,
      })) tx.add(ix);
      tx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
      tx.feePayer = escrow.publicKey;
      // SOL-029: simulate before send.
      p.sig = await simulateAndSend(conn, tx, [escrow], { label: `bot-fee-delegation:${p.id}` });
      await conn.confirmTransaction(p.sig, 'confirmed');
      log('reconcile_recovered', { detail: { stage: 'bot_fee_delegation', botId: p.id, action: p.action, sig: p.sig, lamports: p.lamports, pct: p.pct, quote: qc } });
    } catch (e) {
      p.error = e instanceof Error ? e.message : String(e);
      log('reconcile_error', { ok: false, detail: { stage: 'bot_fee_delegation', botId: p.id, action: p.action, err: p.error, lamports: p.lamports, quote: qc } });
    }
  }

  // ── Partner rev-share payout ──────────────────────────────────────
  // If this meme was originated via a partner API integration (Pump
  // Tracks etc.), the platform 10% gets sub-split per the partner's
  // rev_share_bps. Default config when a partner is set but bps is 0
  // is "no rev share" — the platform retains 100% of its slice.
  //
  // We INSERT a 'pending' partner_payouts row before the transfer so
  // the ledger always reflects intent, then UPDATE to 'sent' on
  // confirm or 'failed' on error. This way a mid-flight crash never
  // loses track of a payout.
  //
  // The platform retains (platformLamports - partnerShareLamports).
  // Both stay in escrow as platform revenue when no partner is set
  // (existing behavior preserved).
  let partnerShareLamports = 0;
  if (meme.partner_id && qc === 'sol' && platformLamports > 0) {
    const { data: partner } = await supabase
      .from('partners')
      .select('id, partner_wallet, rev_share_bps, enabled')
      .eq('id', meme.partner_id)
      .maybeSingle();
    if (partner && partner.enabled && partner.partner_wallet && partner.rev_share_bps > 0) {
      partnerShareLamports = Math.floor(platformLamports * partner.rev_share_bps / 10_000);
      if (partnerShareLamports > 0) {
        const { data: payoutRow } = await supabase
          .from('partner_payouts')
          .insert({
            partner_id: partner.id,
            meme_id: meme.id,
            drain_sig: drainSig,
            payout_wallet: partner.partner_wallet,
            amount_lamports: partnerShareLamports,
            rev_share_bps: partner.rev_share_bps,
            platform_lamports_at_payout: platformLamports,
            status: 'pending',
          })
          .select('id')
          .single();
        try {
          const tx = new Transaction();
          tx.add(SystemProgram.transfer({
            fromPubkey: escrow.publicKey,
            toPubkey: new PublicKey(partner.partner_wallet),
            lamports: partnerShareLamports,
          }));
          tx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
          tx.feePayer = escrow.publicKey;
          const partnerSig = await simulateAndSend(conn, tx, [escrow], { label: `partner-payout:${partner.id}` });
          // simulateAndSend now confirms + throws on revert (2026-06-17 fix).
          await supabase
            .from('partner_payouts')
            .update({ status: 'sent', transfer_sig: partnerSig, confirmed_at: new Date().toISOString() })
            .eq('id', payoutRow?.id);
          await supabase.rpc('increment_partner_fee', {
            p_meme_id: meme.id,
            p_amount: partnerShareLamports,
          }).then(async (rpcResult) => {
            // Fallback: if the RPC doesn't exist yet (V0), do it manually.
            if (rpcResult.error) {
              const { data: cur } = await supabase
                .from('memes').select('partner_fee_lamports').eq('id', meme.id).single();
              await supabase.from('memes').update({
                partner_fee_lamports: Number(cur?.partner_fee_lamports || 0) + partnerShareLamports,
              }).eq('id', meme.id);
            }
          });
          log('reconcile_recovered', { detail: { stage: 'partner_payout', partnerId: partner.id, sig: partnerSig, lamports: partnerShareLamports, bps: partner.rev_share_bps } });
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          await supabase
            .from('partner_payouts')
            .update({ status: 'failed', error: errMsg.slice(0, 500) })
            .eq('id', payoutRow?.id);
          log('reconcile_error', { ok: false, detail: { stage: 'partner_payout_failed', partnerId: partner.id, err: errMsg, lamports: partnerShareLamports } });
          // Don't bail the whole drain — backer credits still happen.
          // The pending ledger row records the failure for follow-up.
          partnerShareLamports = 0;
        }
      }
    }
  }

  const { data: backings } = await supabase
    .from('backings')
    .select('id, backer_wallet, amount_sol, claimable_fees_sol, tokens_received')
    .eq('meme_id', meme.id)
    .eq('status', 'distributed');

  if (!backings || backings.length === 0) {
    return {
      ok: true,
      skipped: 'no distributed backings to credit — full amount retained as platform revenue',
      collectedLamports, platformLamports: collectedLamports, backerLamports: 0, backerCount: 0,
      collectSig: collectSig ?? undefined, drainSig,
    };
  }

  const totalBacking = backings.reduce((s, b) => s + Number(b.amount_sol), 0);
  if (totalBacking <= 0) return { ok: false, error: 'totalBacking <= 0 — cannot split' };

  // ── Compute each backer's effective share ──────────────────────────
  // For legacy_flat: effective = stake / totalBacking (no weighting)
  // For hold_weighted: effective = (stake / totalBacking) × hold_pct (capped 1.0)
  type BackerCredit = {
    id: string; wallet: string; existingClaimable: number;
    stakeFraction: number;     // share of total backing pool
    holdPct: number;            // 0..1, capped at 1.0
    effectiveShareLam: number;  // actual lamports earned this round
  };

  const credits: BackerCredit[] = [];
  let totalEffectiveLam = 0;

  if (feeMode === 'legacy_flat') {
    for (const b of backings) {
      const stakeFraction = Number(b.amount_sol) / totalBacking;
      const lam = Math.floor(stakeFraction * backerPoolLamports);
      credits.push({
        id: b.id, wallet: b.backer_wallet, existingClaimable: Number(b.claimable_fees_sol) || 0,
        stakeFraction, holdPct: 1.0, effectiveShareLam: lam,
      });
      totalEffectiveLam += lam;
    }
  } else {
    // hold_weighted: fetch each backer's current hold % (wallet + Streamflow-locked)
    const mintAddress = meme.mint_address;
    if (!mintAddress) {
      return { ok: false, error: 'mint_address required for hold_weighted but missing' };
    }
    const streamClient = new SolanaStreamClient(RPC_URL, ICluster.Mainnet, 'confirmed');
    const mint = new PublicKey(mintAddress);

    // Per-backer hold % — fetched in parallel
    const holdPcts = await Promise.all(backings.map(async (b) => {
      const allocated = b.tokens_received ? BigInt(b.tokens_received) : BigInt(0);
      if (allocated === BigInt(0)) return { id: b.id, pct: 0 }; // no allocation = no fee share
      try {
        const owner = new PublicKey(b.backer_wallet);
        // Direct wallet balance
        const accts = await conn.getParsedTokenAccountsByOwner(owner, { mint });
        const directRaw = accts.value.reduce((s, a) => {
          const amt = a.account.data.parsed.info.tokenAmount.amount;
          return s + BigInt(amt || '0');
        }, BigInt(0));
        // Streamflow-locked (search by sender = wallet — matches Roster pattern)
        let lockedRaw = BigInt(0);
        try {
          const streams = await streamClient.searchStreams({ mint: mintAddress, sender: b.backer_wallet });
          if (streams && streams.length > 0) {
            const lockBals = await Promise.all(streams.map(async (s) => {
              try {
                const raw = (s.account as { escrowTokens?: unknown })?.escrowTokens;
                if (!raw) return BigInt(0);
                const pk = typeof raw === 'string'
                  ? new PublicKey(raw)
                  : new PublicKey((raw as { toBase58?: () => string }).toBase58 ? (raw as { toBase58: () => string }).toBase58() : raw as never);
                const info = await conn.getAccountInfo(pk);
                if (!info) return BigInt(0);
                return info.data.readBigUInt64LE(64);
              } catch { return BigInt(0); }
            }));
            lockedRaw = lockBals.reduce((s, x) => s + x, BigInt(0));
          }
        } catch { /* no streams for this wallet */ }
        const effective = directRaw + lockedRaw;
        // Cap at 100% (anti-gaming: buying extra beyond allocation doesn't boost share)
        const rawPct = Number((effective * BigInt(10_000)) / allocated) / 10_000;
        return { id: b.id, pct: Math.min(1.0, rawPct) };
      } catch (e) {
        log('reconcile_error', { ok: false, detail: { stage: 'hold_pct_read', wallet: b.backer_wallet, err: e instanceof Error ? e.message : String(e) } });
        return { id: b.id, pct: 0 }; // fail-closed: zero share on RPC error
      }
    }));

    for (const b of backings) {
      const holdPct = holdPcts.find(h => h.id === b.id)?.pct ?? 0;
      const stakeFraction = Number(b.amount_sol) / totalBacking;
      const effective = Math.floor(stakeFraction * holdPct * backerPoolLamports);
      credits.push({
        id: b.id, wallet: b.backer_wallet, existingClaimable: Number(b.claimable_fees_sol) || 0,
        stakeFraction, holdPct, effectiveShareLam: effective,
      });
      totalEffectiveLam += effective;
    }
  }

  // ── Compute freed-up amount → entirely to holder airdrop pool ──────
  // (No per-backer redistribution. Diamond hands already earn full pro-rata
  //  via their 100% hold. Freed shares from dumpers go to ALL PROOF holders
  //  via the daily airdrop pool. Backers who also hold PROOF earn there too.)
  const freedLam = backerPoolLamports - totalEffectiveLam;
  const freedToHolderRewardsLam = feeMode === 'hold_weighted' ? Math.max(0, freedLam) : 0;

  // ── Send the freed holder-rewards portion to HOLDER_REWARDS_WALLET ──
  let holderRewardsSig: string | undefined;
  if (freedToHolderRewardsLam > 0) {
    const holderRewardsAddr = process.env.HOLDER_REWARDS_WALLET_ADDRESS;
    if (holderRewardsAddr) {
      try {
        const tx = new Transaction();
        for (const ix of buildQuoteTransferIxs({
          from: escrow.publicKey,
          to: new PublicKey(holderRewardsAddr),
          amountRaw: BigInt(freedToHolderRewardsLam),
          qc,
          payer: escrow.publicKey,
        })) tx.add(ix);
        tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
        tx.feePayer = escrow.publicKey;
        // SOL-029: simulate before send.
        holderRewardsSig = await simulateAndSend(conn, tx, [escrow], { label: 'freed-to-holder-rewards' });
        await conn.confirmTransaction(holderRewardsSig, 'confirmed');
        log('reconcile_recovered', { detail: { stage: 'freed_to_holder_rewards', sig: holderRewardsSig, lamports: freedToHolderRewardsLam, quote: qc } });
      } catch (e) {
        log('reconcile_error', { ok: false, detail: { stage: 'freed_to_holder_rewards', err: e instanceof Error ? e.message : String(e), lamports: freedToHolderRewardsLam, quote: qc } });
        // Non-fatal: funds stay in escrow, can be swept manually next cycle
      }
    }
  }

  // (The configured-holder-rewards transfer used to live here — moved up
  // above the no-backings early-exit so PROOF stakers get paid even when
  // a meme drains fees but has no distributed backers.)

  // ── Credit backers in DB ────────────────────────────────────────────
  // Column name is claimable_fees_sol but the stored value is in the
  // meme's quote currency (SOL or USDC). SOL: divide raw by 1e9.
  // USDC: divide raw by 1e6. The UI reads meme.quote_currency to pick
  // the display label.
  const quoteDenom = qc === 'usdc' ? 1_000_000 : LAMPORTS_PER_SOL;
  const errors: string[] = [];
  let credited = 0;
  for (const c of credits) {
    const shareUnit = c.effectiveShareLam / quoteDenom;
    const newClaimable = c.existingClaimable + shareUnit;
    const { error: upErr } = await supabase
      .from('backings')
      .update({ claimable_fees_sol: newClaimable })
      .eq('id', c.id);
    if (upErr) errors.push(`${c.wallet.slice(0, 8)}: ${upErr.message}`);
    else credited++;
  }

  if (errors.length > 0) {
    log('reconcile_error', { ok: false, detail: { stage: 'credit_backers', errors, credited, feeMode } });
    return {
      ok: false,
      error: `${errors.length} backer credit(s) failed: ${errors.slice(0, 3).join('; ')}`,
      collectedLamports, platformLamports, backerLamports: totalEffectiveLam, backerCount: credited,
      collectSig: collectSig ?? undefined, drainSig,
    };
  }

  log('reconcile_recovered', {
    detail: {
      stage: 'credit_backers_done',
      feeMode,
      collectedLamports,
      platformLamports,
      backerLamports: totalEffectiveLam,
      freedLamports: freedLam,
      freedToHolderRewardsLam,
      holderRewardsSig: holderRewardsSig ?? null,
      backerCount: credited,
    },
  });

  return {
    ok: true,
    collectedLamports, platformLamports, backerLamports: totalEffectiveLam, backerCount: credited,
    collectSig: collectSig ?? undefined, drainSig,
  };
}

// Public entry point for non-pump.fun cron paths (Meteora, etc.) that
// have already run their own platform-specific fee claim (Step A) and
// just need Steps B + C: drain sub-escrow → escrow, route to bots,
// credit backers' claimable_fees_sol.
//
// Idempotent and safe-by-default — returns ok:false (or ok:true skipped)
// if there's nothing to drain. Caller doesn't need to know the exact
// state of the sub-escrow; this function handles both fresh-fee and
// orphaned-SOL-recovery cases the same way as collectAndCreditFees does
// for pump.fun.
export async function drainAndCreditAfterPlatformClaim(
  supabase: SupabaseClient,
  memeId: string,
  log: LaunchLogger = createLaunchLogger(memeId),
): Promise<CollectAndCreditResult> {
  const { data: meme, error: memeErr } = await supabase
    .from('memes')
    .select('id, status, creator_subescrow_pubkey, encrypted_creator_subescrow_key, mint_address, fee_distribution_mode, fee_backer_pct, fee_platform_pct, quote_currency')
    .eq('id', memeId)
    .single();
  if (memeErr || !meme) return { ok: false, error: 'meme not found' };
  if (meme.status !== 'live') return { ok: true, skipped: `not live (status=${meme.status})` };
  if (!meme.creator_subescrow_pubkey || !meme.encrypted_creator_subescrow_key) {
    return { ok: true, skipped: 'no sub-escrow (legacy pre-P2 meme)' };
  }

  let subKp: Keypair;
  try { subKp = decryptKeypair(meme.encrypted_creator_subescrow_key); }
  catch (e) { return { ok: false, error: `sub-escrow decrypt failed: ${e instanceof Error ? e.message : String(e)}` }; }
  if (subKp.publicKey.toBase58() !== meme.creator_subescrow_pubkey) {
    return { ok: false, error: 'sub-escrow key mismatch — refusing to touch' };
  }

  const conn = new Connection(RPC_URL, 'confirmed');
  const escrow = loadEscrow();

  return drainAndCreditFromSubEscrow({
    supabase, meme, subKp, conn, escrow, collectSig: undefined, log,
  });
}
