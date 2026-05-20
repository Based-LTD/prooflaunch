import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount } from '@solana/spl-token';
import type { SupabaseClient } from '@supabase/supabase-js';
import { refundFromBurnerWallet, getMintTokenProgram } from './pumpfun';
import { settlePoolDistribution } from './distribution';
import { createLaunchLogger } from '@/lib/launchLog';

// Reconciliation + auto-recovery.
//
// This is the safety net that makes a launch bulletproof: after the dust
// settles, it compares every burner's ON-CHAIN truth against the DB and
// makes things right with NO human in the loop.
//
//   - burner holds the token  -> ensure it's recorded as distributed
//                                 (fixes silent false-negatives like the
//                                  $TEST `|| noError` class of bug)
//   - burner still holds SOL,
//     no token, launch is over -> the buy never landed; AUTO-REFUND the
//                                  backer in full (0% fee, platform fault)
//   - burner drained, no token -> funds already left by some other path;
//                                  flag for manual review, never guess
//
// It is idempotent and safe to run on a schedule. It refuses to touch a
// meme whose launch could still be in flight (grace windows below).

const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

// A normal launch create->buys->record completes in seconds. Wait well
// past that before assuming a still-SOL-funded burner means a failed buy.
const LIVE_GRACE_MS = 10 * 60 * 1000;        // 'live' memes: 10 min after launched_at
const LAUNCHING_STUCK_MS = 15 * 60 * 1000;   // 'launching' memes: stuck >15 min = crashed mid-launch

// Burner is considered "still holds the backing" (buy never happened) if it
// has more than this much SOL. Below this it's just dust / rent and the
// funds clearly already moved elsewhere.
const STUCK_SOL_THRESHOLD = 0.005 * LAMPORTS_PER_SOL;

interface BackingRow {
  id: string;
  meme_id: string;
  backer_wallet: string;
  amount_sol: number;
  status: string;
  burner_wallet: string | null;
  encrypted_private_key: string | null;
  burner_buy_executed: boolean | null;
  burner_buy_signature: string | null;
  tokens_received: number | null;
}

interface MemeRow {
  id: string;
  name: string;
  status: string;
  mint_address: string | null;
  launched_at: string | null;
  updated_at: string;
  pool_wallet: string | null;
}

const MEME_COLS = 'id, name, status, mint_address, launched_at, updated_at, pool_wallet';

export interface ReconcileActionResult {
  memeId: string;
  memeName: string;
  mint: string | null;
  recovered: string[];   // backers whose DB was corrected to distributed
  refunded: string[];    // backers auto-refunded (stuck SOL)
  needsManual: string[]; // backers we refuse to guess on
  errors: string[];
  skipped?: string;      // reason the whole meme was skipped
}

// Resolve the mint for a meme even if the launch crashed before writing it
// to memes.mint_address — pull it from the durable launch_events log.
async function resolveMint(
  supabase: SupabaseClient,
  meme: MemeRow
): Promise<string | null> {
  if (meme.mint_address) return meme.mint_address;

  const { data } = await supabase
    .from('launch_events')
    .select('detail')
    .eq('meme_id', meme.id)
    .in('phase', ['create_sent', 'curve_ready', 'launch_complete'])
    .order('created_at', { ascending: false })
    .limit(1);

  const detail = data?.[0]?.detail as { mint?: string } | null;
  return detail?.mint ?? null;
}

async function reconcileMeme(
  supabase: SupabaseClient,
  connection: Connection,
  meme: MemeRow
): Promise<ReconcileActionResult> {
  const log = createLaunchLogger(meme.id);
  const result: ReconcileActionResult = {
    memeId: meme.id,
    memeName: meme.name,
    mint: null,
    recovered: [],
    refunded: [],
    needsManual: [],
    errors: [],
  };

  // --- Grace windows: never touch a launch that could still be in flight ---
  const now = Date.now();
  if (meme.status === 'live') {
    const launchedAt = meme.launched_at ? new Date(meme.launched_at).getTime() : 0;
    if (launchedAt && now - launchedAt < LIVE_GRACE_MS) {
      result.skipped = 'within live grace window';
      return result;
    }
  } else if (meme.status === 'launching') {
    const stuckSince = new Date(meme.updated_at).getTime();
    if (now - stuckSince < LAUNCHING_STUCK_MS) {
      result.skipped = 'launching, still within stuck window';
      return result;
    }
  } else {
    result.skipped = `status ${meme.status} not reconcilable`;
    return result;
  }

  // --- Pooled model: one pool wallet per meme, no per-backer burners ---
  // The on-chain truth for a pooled meme is the pool's token balance, not
  // 30 burners. The honest "make it right with no human" action for a
  // 'live' pooled meme is to FINISH distribution: settlePoolDistribution
  // is idempotent and only sends to backers without a claim_tx, so this
  // safely completes a launch whose creator never hit Distribute.
  if (meme.pool_wallet) {
    if (meme.status === 'live') {
      result.mint = meme.mint_address;
      const s = await settlePoolDistribution(supabase, meme.id, log);
      if (s.error) {
        result.skipped = `pooled live, not settleable: ${s.error}`;
      } else if (s.alreadyComplete) {
        result.skipped = 'pooled live, all backers already distributed';
      } else {
        // Treat completed sends as "recovered" (DB now matches chain).
        for (let i = 0; i < s.distributed; i++) result.recovered.push('pool-distributed');
        for (const f of s.failures) result.errors.push(`${f.backerWallet}: ${f.error}`);
      }
      return result;
    }
    // status 'launching', past the stuck window. If a token was never
    // created, bounce back to 'funded' so the creator can retry — the
    // pool's funds are untouched. If a mint DID get created the launch
    // likely landed but the DB write crashed: don't guess on money,
    // surface for targeted manual reconcile.
    const launchingMint = await resolveMint(supabase, meme);
    result.mint = launchingMint;
    if (!launchingMint) {
      // Reset funded_at on revert: the original 24h countdown might
      // have nearly elapsed during the stalled launch attempt; give
      // the creator a fair fresh window to retry. (Not exploitable —
      // each launch attempt costs the creator gas + Jito fees.)
      await supabase.from('memes').update({ status: 'funded', funded_at: new Date().toISOString() }).eq('id', meme.id);
      log('reconcile_error', { ok: false, detail: { reason: 'pooled launching, no mint — reverted to funded' } });
      result.skipped = 'pooled launching, no mint (reverted -> funded)';
    } else {
      result.needsManual.push('pool');
      log('reconcile_needs_manual', { ok: false, detail: { reason: 'pooled launching with mint — verify pool then settle', mint: launchingMint } });
    }
    return result;
  }

  const mintStr = await resolveMint(supabase, meme);
  result.mint = mintStr;

  if (!mintStr) {
    // No token was ever created (launch crashed before create, or never
    // ran). Bounce a stuck 'launching' meme back to 'funded' so the
    // creator can safely retry — funds are untouched in burners.
    if (meme.status === 'launching') {
      // Reset funded_at — see comment above on the other revert path.
      await supabase.from('memes').update({ status: 'funded', funded_at: new Date().toISOString() }).eq('id', meme.id);
      log('reconcile_error', { ok: false, detail: { reason: 'no mint found, reverted launching -> funded' } });
      result.skipped = 'no mint (reverted launching -> funded)';
    } else {
      result.skipped = 'live but no mint resolvable';
    }
    return result;
  }

  const mint = new PublicKey(mintStr);

  const { data: backings, error: backErr } = await supabase
    .from('backings')
    .select('id, meme_id, backer_wallet, amount_sol, status, burner_wallet, encrypted_private_key, burner_buy_executed, burner_buy_signature, tokens_received')
    .eq('meme_id', meme.id)
    .not('status', 'in', '(refunded,withdrawn)');

  if (backErr) {
    result.errors.push(`load backings: ${backErr.message}`);
    return result;
  }

  log('reconcile_scan', { detail: { mint: mintStr, backings: backings?.length || 0 } });

  for (const b of (backings as BackingRow[]) || []) {
    if (!b.burner_wallet || !b.encrypted_private_key) {
      result.needsManual.push(b.backer_wallet);
      log('reconcile_needs_manual', { backerWallet: b.backer_wallet, ok: false, detail: { reason: 'no burner on backing' } });
      continue;
    }

    try {
      const burner = new PublicKey(b.burner_wallet);

      // On-chain truth #1: does the burner hold this token?
      // Token-2022-aware (createV2 mints) with classic fallback.
      let tokenBalance = 0;
      try {
        const tokenProgram = await getMintTokenProgram(connection, mint);
        const ata = await getAssociatedTokenAddress(mint, burner, false, tokenProgram);
        const acct = await getAccount(connection, ata, 'confirmed', tokenProgram);
        tokenBalance = Number(acct.amount);
      } catch {
        tokenBalance = 0; // no ATA / no balance
      }

      if (tokenBalance > 0) {
        // The buy DID land. Make sure the DB says so. This is the
        // false-negative fix — exactly the failure mode that made past
        // "successful" launches untrustworthy.
        const alreadyCorrect = b.status === 'distributed' && b.burner_buy_executed === true;
        if (!alreadyCorrect) {
          const { error } = await supabase
            .from('backings')
            .update({
              status: 'distributed',
              burner_buy_executed: true,
              tokens_received: tokenBalance,
            })
            .eq('id', b.id);
          if (error) {
            result.errors.push(`${b.backer_wallet}: DB fix failed: ${error.message}`);
          } else {
            result.recovered.push(b.backer_wallet);
            log('reconcile_recovered', { backerWallet: b.backer_wallet, detail: { tokenBalance } });
          }
        }
        continue;
      }

      // On-chain truth #2: no token. Does the burner still hold the SOL?
      const solBalance = await connection.getBalance(burner);

      if (solBalance > STUCK_SOL_THRESHOLD) {
        // Buy never landed and funds are stranded. The launch window is
        // long past (grace checked above), so this will never self-heal.
        // Make the backer whole automatically, 0% fee (platform fault).
        const refund = await refundFromBurnerWallet(
          b.encrypted_private_key,
          b.burner_wallet,
          b.backer_wallet,
          Number(b.amount_sol),
          0
        );

        if (refund.success) {
          await supabase
            .from('backings')
            .update({ status: 'refunded', refund_tx: refund.signature })
            .eq('id', b.id);
          result.refunded.push(b.backer_wallet);
          log('reconcile_refunded', {
            backerWallet: b.backer_wallet,
            signature: refund.signature,
            detail: { amountSol: refund.amountRefunded },
          });
        } else {
          result.errors.push(`${b.backer_wallet}: auto-refund failed: ${refund.error}`);
          log('reconcile_error', { backerWallet: b.backer_wallet, ok: false, detail: { error: refund.error } });
        }
        continue;
      }

      // No token AND no SOL: funds already left via some other path
      // (manual refund/sweep) without the DB catching up. Don't guess —
      // surface for human review.
      result.needsManual.push(b.backer_wallet);
      log('reconcile_needs_manual', {
        backerWallet: b.backer_wallet,
        ok: false,
        detail: { reason: 'burner empty, no token — funds moved off-book', solBalance },
      });
    } catch (e) {
      result.errors.push(`${b.backer_wallet}: ${e instanceof Error ? e.message : 'unknown'}`);
      log('reconcile_error', { backerWallet: b.backer_wallet, ok: false, detail: { error: String(e) } });
    }
  }

  // If a crashed 'launching' meme actually has on-chain holders, promote it
  // to 'live' so its state matches reality.
  if (meme.status === 'launching' && result.recovered.length > 0) {
    await supabase
      .from('memes')
      .update({ status: 'live', mint_address: mintStr, launched_at: new Date().toISOString() })
      .eq('id', meme.id);
  }

  return result;
}

// Reconcile a single meme by id (manual trigger / targeted recovery).
export async function reconcileMemeById(
  supabase: SupabaseClient,
  memeId: string
): Promise<ReconcileActionResult | { error: string }> {
  const { data: meme, error } = await supabase
    .from('memes')
    .select(MEME_COLS)
    .eq('id', memeId)
    .single();

  if (error || !meme) return { error: error?.message || 'meme not found' };

  const connection = new Connection(RPC_URL, 'confirmed');
  return reconcileMeme(supabase, connection, meme as MemeRow);
}

// Sweep every meme that could have stranded funds (scheduled safety net).
export async function reconcileAll(
  supabase: SupabaseClient
): Promise<{ scanned: number; results: ReconcileActionResult[] }> {
  const connection = new Connection(RPC_URL, 'confirmed');

  const { data: memes, error } = await supabase
    .from('memes')
    .select(MEME_COLS)
    .in('status', ['live', 'launching'])
    .order('updated_at', { ascending: false })
    .limit(100);

  if (error) return { scanned: 0, results: [] };

  const results: ReconcileActionResult[] = [];
  for (const meme of (memes as MemeRow[]) || []) {
    try {
      const r = await reconcileMeme(supabase, connection, meme);
      // Only report memes where something actually happened or needs eyes.
      if (
        r.recovered.length ||
        r.refunded.length ||
        r.needsManual.length ||
        r.errors.length
      ) {
        results.push(r);
      }
    } catch (e) {
      results.push({
        memeId: meme.id,
        memeName: meme.name,
        mint: null,
        recovered: [],
        refunded: [],
        needsManual: [],
        errors: [e instanceof Error ? e.message : 'unknown'],
      });
    }
  }

  return { scanned: memes?.length || 0, results };
}
