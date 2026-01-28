import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { launchToken, refundBacker } from '@/services/pumpfun';

// This endpoint should be called by a cron job or manually to process memes
// It handles both launching funded memes and refunding failed ones

// POST /api/process-memes - Process all memes that need action
export async function POST(request: NextRequest) {
  try {
    // Optional: Add auth check for cron secret
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

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
      if (hasReachedGoal) {
        console.log(`Launching meme ${meme.id}: ${meme.name}`);

        // Update status to launching
        await supabase
          .from('memes')
          .update({ status: 'launching' })
          .eq('id', meme.id);

        try {
          const launchResult = await launchToken({
            name: meme.name,
            symbol: meme.symbol,
            description: meme.description,
            imageUrl: meme.image_url,
            twitter: meme.twitter,
            telegram: meme.telegram,
            discord: meme.discord,
            website: meme.website,
            totalBackingSol: currentBacking,
            creatorWallet: meme.creator_wallet,
          });

          if (launchResult.success) {
            // Update meme with launch info
            await supabase
              .from('memes')
              .update({
                status: 'live',
                mint_address: launchResult.mintAddress,
                pump_fun_url: launchResult.pumpFunUrl,
                launched_at: new Date().toISOString(),
              })
              .eq('id', meme.id);

            results.launched.push(meme.id);
            console.log(`Successfully launched ${meme.name}: ${launchResult.pumpFunUrl}`);
          } else {
            // Launch failed - revert to backing status
            await supabase
              .from('memes')
              .update({ status: 'backing' })
              .eq('id', meme.id);

            results.errors.push({ memeId: meme.id, error: launchResult.error || 'Launch failed' });
          }
        } catch (err) {
          await supabase
            .from('memes')
            .update({ status: 'backing' })
            .eq('id', meme.id);

          results.errors.push({
            memeId: meme.id,
            error: err instanceof Error ? err.message : 'Unknown launch error',
          });
        }
      }
      // Case 2: Deadline passed without reaching goal - Process refunds
      else if (isPastDeadline && meme.auto_refund) {
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
            const refundResult = await refundBacker(backing.backer_wallet, backing.amount_sol);

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

    return NextResponse.json({
      success: true,
      processed: backingMemes?.length || 0,
      launched: results.launched.length,
      refunded: results.refunded.length,
      errors: results.errors,
    });
  } catch (error) {
    console.error('Process memes error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// GET /api/process-memes - Check status of memes needing action
export async function GET() {
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
