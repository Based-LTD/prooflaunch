import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { refundFromBurnerWallet } from '@/services/pumpfun';

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

    // Actually, let's do a simpler query
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

      // Case 2: Deadline passed without reaching goal - Process refunds
      if (isPastDeadline && meme.auto_refund) {
        console.log(`Processing refunds for failed meme ${meme.id}: ${meme.name}`);

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

    return {
      success: true,
      processed: backingMemes?.length || 0,
      launched: results.launched.length,
      refunded: results.refunded.length,
      errors: results.errors,
    };
}

// POST /api/process-memes - Manual trigger with auth
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
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
  // Vercel cron jobs send x-vercel-cron: 1 — run the processor
  if (request.headers.get('x-vercel-cron') === '1') {
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
