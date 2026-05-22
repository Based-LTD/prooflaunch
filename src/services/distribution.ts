import type { SupabaseClient } from '@supabase/supabase-js';
import { distributeFromPool, refundFromPool } from './pumpfun';
import { createLaunchLogger, type LaunchLogger } from '@/lib/launchLog';
import { Connection, PublicKey, Keypair, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { OnlinePumpSdk } from '@pump-fun/pump-sdk';
import bs58 from 'bs58';
import { decryptPrivateKey } from '@/lib/crypto';

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
const PLATFORM_FEE_CUT = 0.10; // 10% platform / 90% backers (same ratio old feeTracker used)
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
    .select('id, status, creator_subescrow_pubkey, encrypted_creator_subescrow_key')
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

  if (vaultLamports < COLLECT_THRESHOLD_LAMPORTS && subBalancePre < ORPHANED_FLOOR) {
    return { ok: true, skipped: `vault ${vaultLamports} lamports below threshold ${COLLECT_THRESHOLD_LAMPORTS}` };
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
      collectSig = await conn.sendTransaction(tx, [escrow]);
      await conn.confirmTransaction(collectSig, 'confirmed');
      log('reconcile_recovered', { detail: { stage: 'collect_creator_fee', sig: collectSig, vaultLamports } });
    } catch (e) {
      return { ok: false, error: `collect failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  } else {
    log('reconcile_recovered', { detail: { stage: 'recovery_drain', subBalancePre, vaultLamports, note: 'orphaned sub-escrow SOL from prior run, draining without re-collect' } });
  }

  // Step B: drain sub-escrow → shared escrow, drain-to-zero (sub-escrow
  // ends at exactly 0; same Solana-rent-floor rule that bit refundFromPool).
  // Retry the balance read up to 5 times with 1s delay to handle the
  // collect→drain timing race where RPC nodes haven't yet propagated
  // the new sub-escrow balance. Each loop iteration also re-reads the
  // balance, so a slow-confirming collect won't trick us into thinking
  // sub-escrow is empty.
  const BASE_FEE = 5000;
  let subBalance = 0;
  for (let attempt = 0; attempt < 5; attempt++) {
    subBalance = await conn.getBalance(subKp.publicKey);
    if (subBalance > BASE_FEE) break;
    if (attempt < 4) await new Promise(r => setTimeout(r, 1000));
  }
  const transferLamports = subBalance - BASE_FEE;
  if (transferLamports <= 0) {
    return { ok: false, error: `sub-escrow balance ${subBalance} too low for drain (collectSig ${collectSig ?? 'none — recovery path'}; investigate manually)` };
  }

  let drainSig: string;
  try {
    const tx = new Transaction().add(
      SystemProgram.transfer({ fromPubkey: subKp.publicKey, toPubkey: escrow.publicKey, lamports: transferLamports })
    );
    tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
    tx.feePayer = subKp.publicKey;
    drainSig = await conn.sendTransaction(tx, [subKp]);
    await conn.confirmTransaction(drainSig, 'confirmed');
    log('reconcile_recovered', { detail: { stage: 'drain_subescrow_to_escrow', sig: drainSig, lamports: transferLamports } });
  } catch (e) {
    // Drain failed but collect succeeded (or this was a recovery run).
    // SOL is in sub-escrow safely. Next cron tick will catch it via the
    // recovery branch above (vault empty + sub-escrow has SOL → drain).
    return {
      ok: false,
      error: `drain failed: ${e instanceof Error ? e.message : String(e)} — sub-escrow holds ${subBalance} lamports (collectSig ${collectSig ?? 'recovery'})`,
    };
  }

  // Step C: credit backers proportionally (10% platform / 90% backers)
  const collectedLamports = transferLamports;
  const platformLamports = Math.floor(collectedLamports * PLATFORM_FEE_CUT);
  const backerLamports = collectedLamports - platformLamports;

  const { data: backings } = await supabase
    .from('backings')
    .select('id, backer_wallet, amount_sol, claimable_fees_sol')
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

  const backerSol = backerLamports / LAMPORTS_PER_SOL;
  const errors: string[] = [];
  let credited = 0;
  for (const b of backings) {
    const share = (Number(b.amount_sol) / totalBacking) * backerSol;
    const newClaimable = (Number(b.claimable_fees_sol) || 0) + share;
    const { error: upErr } = await supabase
      .from('backings')
      .update({ claimable_fees_sol: newClaimable })
      .eq('id', b.id);
    if (upErr) errors.push(`${b.backer_wallet.slice(0, 8)}: ${upErr.message}`);
    else credited++;
  }

  if (errors.length > 0) {
    log('reconcile_error', { ok: false, detail: { stage: 'credit_backers', errors, credited } });
    return {
      ok: false,
      error: `${errors.length} backer credit(s) failed: ${errors.slice(0, 3).join('; ')}`,
      collectedLamports, platformLamports, backerLamports, backerCount: credited,
      collectSig: collectSig ?? undefined, drainSig,
    };
  }

  return {
    ok: true,
    collectedLamports, platformLamports, backerLamports, backerCount: credited,
    collectSig: collectSig ?? undefined, drainSig,
  };
}
