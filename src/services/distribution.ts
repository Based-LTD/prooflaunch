import type { SupabaseClient } from '@supabase/supabase-js';
import { distributeFromPool, refundFromPool } from './pumpfun';
import { createLaunchLogger, type LaunchLogger } from '@/lib/launchLog';

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
