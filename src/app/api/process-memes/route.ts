import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { refundFromBurnerWallet } from '@/services/pumpfun';
import { refundMemePool } from '@/services/distribution';
import { authorizeCron } from '@/lib/cronAuth';

// This endpoint should be called by a cron job or manually to process memes
// It handles both launching funded memes and refunding failed ones

// Shared processor — runs the launch/refund logic for all backing memes
async function runProcessor() {
  const supabase = createServerClient();
  const results = {
      launched: [] as string[],
      refunded: [] as string[],
      errors: [] as { memeId: string; error: string }[],
    };

    // 1. Find memes that have reached their goal and need to be launched
    const { data: fundedMemes, error: fundedError } = await supabase
      .from('memes')
      .select('*, backings(*)')
      .eq('status', 'backing')
      .gte('current_backing_sol', supabase.rpc('get_backing_goal_sol')); // This won't work directly

    // Deadline-driven refund applies ONLY to memes that never filled.
    // Product rule: once a meme is fully backed ('funded') it is a
    // committed pool and does NOT expire — it waits for the creator to
    // launch, indefinitely. Only 'backing' memes (slots still open) that
    // pass their deadline without filling get auto-refunded. A meme that
    // filled would already be 'funded', so scanning 'backing' alone is
    // exactly "did not fill by the deadline".
    const { data: backingMemes, error: backingError } = await supabase
      .from('memes')
      .select('*')
      .eq('status', 'backing');

    if (backingError) {
      console.error('Failed to fetch memes:', backingError);
      return NextResponse.json({ error: backingError.message }, { status: 500 });
    }

    const now = new Date();

    for (const meme of backingMemes || []) {
      const deadline = new Date(meme.backing_deadline);
      const currentBacking = Number(meme.current_backing_sol);
      const goal = Number(meme.backing_goal_sol);
      const isPastDeadline = deadline < now;
      const hasReachedGoal = currentBacking >= goal;

      // Case 1: Goal reached - Launch the token
      // Case 1: Goal reached — creators trigger launch manually via /api/launch
      //   (which uses launchWithBatchedBuys to execute backer buys properly).
      //   The cron used to attempt auto-launch via the deprecated launchToken
      //   path, which would create the token without executing backer buys —
      //   funds would stay trapped in burners and the token would launch
      //   with no holders. Removed entirely; only refund logic remains here.

      // Case 2: 'backing' meme passed its deadline WITHOUT filling - refund.
      // (Funded memes are excluded by the query above and never expire.)
      if (isPastDeadline && meme.auto_refund) {
        console.log(`Auto-refunding unfilled expired meme ${meme.id}: ${meme.name}`);

        // Pooled model: one shared pool wallet per meme. The shared,
        // idempotent settler refunds every confirmed backer at 0% fee
        // and flips the meme to 'failed' itself. Legacy burner memes
        // fall through to the per-burner loop below.
        if (meme.pool_wallet) {
          try {
            const pooled = await refundMemePool(supabase, meme.id);
            if (pooled.ok) {
              if (pooled.refunded > 0 || pooled.markedFailed) results.refunded.push(meme.id);
            } else if (!pooled.legacy) {
              for (const f of pooled.failures) {
                results.errors.push({ memeId: meme.id, error: `Pool refund failed for ${f.backerWallet}: ${f.error}` });
              }
              if (pooled.error) results.errors.push({ memeId: meme.id, error: pooled.error });
            }
            // Pooled meme handled (or hard-failed for retry next run) —
            // never also run the burner path on it.
            if (!pooled.legacy) continue;
          } catch (err) {
            results.errors.push({ memeId: meme.id, error: `Pool refund error: ${err instanceof Error ? err.message : 'Unknown'}` });
            continue;
          }
        }

        // Get all confirmed backings for this meme
        const { data: backings, error: backingsError } = await supabase
          .from('backings')
          .select('*')
          .eq('meme_id', meme.id)
          .eq('status', 'confirmed');

        if (backingsError) {
          results.errors.push({ memeId: meme.id, error: backingsError.message });
          continue;
        }

        let allRefundsSuccessful = true;

        for (const backing of backings || []) {
          try {
            // Auto-refund pulls from the backer's burner wallet (where their SOL actually
            // sits) — not from escrow. 0% fee on failed-meme refunds (only manual
            // pre-deadline withdrawals incur the 2% fee).
            if (!backing.encrypted_private_key || !backing.burner_wallet) {
              allRefundsSuccessful = false;
              results.errors.push({
                memeId: meme.id,
                error: `No burner wallet on backing ${backing.id}`,
              });
              continue;
            }

            const refundResult = await refundFromBurnerWallet(
              backing.encrypted_private_key,
              backing.burner_wallet,
              backing.backer_wallet,
              Number(backing.amount_sol),
              0 // no fee on auto-refund (meme failed through no fault of the backer)
            );

            if (refundResult.success) {
              // Update backing status
              await supabase
                .from('backings')
                .update({
                  status: 'refunded',
                  refund_tx: refundResult.signature,
                })
                .eq('id', backing.id);

              console.log(`Refunded ${backing.amount_sol} SOL to ${backing.backer_wallet}`);
            } else {
              allRefundsSuccessful = false;
              results.errors.push({
                memeId: meme.id,
                error: `Refund failed for ${backing.backer_wallet}: ${refundResult.error}`,
              });
            }
          } catch (err) {
            allRefundsSuccessful = false;
            results.errors.push({
              memeId: meme.id,
              error: `Refund error for ${backing.backer_wallet}: ${err instanceof Error ? err.message : 'Unknown'}`,
            });
          }
        }

        // Update meme status
        if (allRefundsSuccessful) {
          await supabase
            .from('memes')
            .update({ status: 'failed' })
            .eq('id', meme.id);

          results.refunded.push(meme.id);
        }
      }
      // Case 3: Deadline passed, no auto-refund - just mark as failed
      else if (isPastDeadline && !meme.auto_refund) {
        await supabase
          .from('memes')
          .update({ status: 'failed' })
          .eq('id', meme.id);

        results.refunded.push(meme.id);
        console.log(`Marked meme ${meme.id} as failed (manual refunds required)`);
      }
    }

    // === Funded memes that blew past their launch_deadline ===
    // Migration 027 (2026-05-26) added a 48h launch window for funded
    // memes, creator-resettable via POST /api/memes/{id}/reset-launch-window.
    // If the deadline passes without launch OR reset, the creator has
    // effectively abandoned the meme and backers get auto-refunded — same
    // refund path as expired backing-phase memes.
    const { data: expiredFunded } = await supabase
      .from('memes')
      .select('id, name, symbol, pool_wallet, encrypted_pool_key')
      .eq('status', 'funded')
      .lt('launch_deadline', now.toISOString());

    for (const meme of expiredFunded || []) {
      console.log(`Auto-refunding funded-but-not-launched expired meme ${meme.id}: ${meme.symbol} (${meme.name})`);
      if (!meme.pool_wallet) {
        results.errors.push({ memeId: meme.id, error: 'Funded meme has no pool_wallet — cannot auto-refund' });
        continue;
      }
      try {
        const pooled = await refundMemePool(supabase, meme.id);
        if (pooled.ok) {
          if (pooled.refunded > 0 || pooled.markedFailed) results.refunded.push(meme.id);
        } else {
          for (const f of pooled.failures || []) {
            results.errors.push({ memeId: meme.id, error: `Funded refund failed for ${f.backerWallet}: ${f.error}` });
          }
          if (pooled.error) results.errors.push({ memeId: meme.id, error: pooled.error });
        }
      } catch (err) {
        results.errors.push({ memeId: meme.id, error: `Funded refund error: ${err instanceof Error ? err.message : 'Unknown'}` });
      }
    }

    return {
      success: true,
      processed: backingMemes?.length || 0,
      fundedExpiredProcessed: expiredFunded?.length || 0,
      launched: results.launched.length,
      refunded: results.refunded.length,
      errors: results.errors,
    };
}

// POST /api/process-memes - Manual trigger with auth
export async function POST(request: NextRequest) {
  const auth = authorizeCron(request);
  if (!auth.ok) return auth.response;
  try {
    const result = await runProcessor();
    return NextResponse.json(result);
  } catch (error) {
    console.error('Process memes error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// GET /api/process-memes - Vercel cron trigger OR status check
export async function GET(request: NextRequest) {
  // Vercel cron auth: when CRON_SECRET is set as an env var, Vercel
  // sends `Authorization: Bearer <CRON_SECRET>` on cron invocations
  // (and may or may not also send `x-vercel-cron: 1`). Accept either
  // signal. If neither matches, fall through to the read-only status
  // branch below.
  const auth = authorizeCron(request);
  if (auth.ok) {
    try {
      const result = await runProcessor();
      return NextResponse.json(result);
    } catch (error) {
      console.error('Cron process memes error:', error);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  }

  // Otherwise: return status of memes that need action
  try {
    const supabase = createServerClient();

    const { data: memes, error } = await supabase
      .from('memes')
      .select('id, name, status, current_backing_sol, backing_goal_sol, backing_deadline, auto_refund')
      .eq('status', 'backing');

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const now = new Date();
    const needsAction = (memes || []).map(meme => {
      const deadline = new Date(meme.backing_deadline);
      const currentBacking = Number(meme.current_backing_sol);
      const goal = Number(meme.backing_goal_sol);
      const isPastDeadline = deadline < now;
      const hasReachedGoal = currentBacking >= goal;

      return {
        ...meme,
        progress: ((currentBacking / goal) * 100).toFixed(1) + '%',
        isPastDeadline,
        hasReachedGoal,
        action: hasReachedGoal ? 'LAUNCH' : isPastDeadline ? 'REFUND' : 'WAITING',
      };
    });

    return NextResponse.json({
      total: memes?.length || 0,
      needsLaunch: needsAction.filter(m => m.action === 'LAUNCH').length,
      needsRefund: needsAction.filter(m => m.action === 'REFUND').length,
      waiting: needsAction.filter(m => m.action === 'WAITING').length,
      memes: needsAction,
    });
  } catch (error) {
    console.error('Get process status error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
