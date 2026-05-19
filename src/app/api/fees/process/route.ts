import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { getRecentFeeTransactions, calculateFeeDistribution } from '@/services/feeTracker';

// Shared fee processing logic
async function processFees() {
  const supabase = createServerClient();

  // Get the last processed signature to avoid reprocessing
  const { data: lastProcessed } = await supabase
    .from('fee_transactions')
    .select('tx_signature')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  // Fetch recent fee transactions
  const feeTransactions = await getRecentFeeTransactions(
    lastProcessed?.tx_signature,
    50
  );

  console.log(`Found ${feeTransactions.length} new fee transactions`);

  let processedCount = 0;
  let totalFeesProcessed = 0;

  for (const feeTx of feeTransactions) {
    // Check if already processed
    const { data: existing } = await supabase
      .from('fee_transactions')
      .select('id')
      .eq('tx_signature', feeTx.signature)
      .single();

    if (existing) continue;

    // Resolve the meme by intersecting the tx's candidate pubkeys with
    // our own live-meme mints — authoritative, suffix-agnostic, and
    // cannot mis-attribute (only exact matches to a known live mint).
    const { data: memeMatches } = await supabase
      .from('memes')
      .select('id, backer_share_pct, creator_fee_pct, creator_wallet, mint_address')
      .in('mint_address', feeTx.candidateMints)
      .eq('status', 'live');
    const meme = memeMatches && memeMatches.length === 1 ? memeMatches[0] : null;

    if (!meme) {
      const why = memeMatches && memeMatches.length > 1 ? 'ambiguous (multiple live mints in tx)' : 'no live meme mint among candidates';
      console.log(`Fee tx ${feeTx.signature}: ${why} — recording unattributed for reprocessing`);
      // Funds are safe in escrow; record so a later pass can credit it.
      await supabase.from('fee_transactions').insert({
        mint_address: null,
        tx_signature: feeTx.signature,
        amount_sol: feeTx.amountSol,
        processed: false,
      });
      continue;
    }

    // Get backers for this meme
    const { data: backers } = await supabase
      .from('backings')
      .select('id, backer_wallet, amount_sol')
      .eq('meme_id', meme.id)
      .eq('status', 'distributed');

    if (!backers || backers.length === 0) {
      console.log(`No distributed backers found for meme ${meme.id}`);
      continue;
    }

    // Calculate fee distribution (all backers split 90% equally based on backing amount)
    const distribution = calculateFeeDistribution(
      feeTx.amountSol,
      backers.map((b) => ({ wallet: b.backer_wallet, backingAmount: Number(b.amount_sol) }))
    );

    // Update backer claimable fees
    for (const backerDist of distribution.backerAmounts) {
      const backing = backers.find((b) => b.backer_wallet === backerDist.wallet);
      if (backing) {
        const { data: currentBacking } = await supabase
          .from('backings')
          .select('claimable_fees_sol')
          .eq('id', backing.id)
          .single();

        await supabase
          .from('backings')
          .update({
            claimable_fees_sol: (Number(currentBacking?.claimable_fees_sol) || 0) + backerDist.amount,
          })
          .eq('id', backing.id);
      }
    }

    // Note: Creators get their share as backers now (no special creator cut)
    // If the creator backed, their share is already included in backerAmounts

    // Update token_fees total
    const { data: existingFees } = await supabase
      .from('token_fees')
      .select('id, total_fees_sol')
      .eq('meme_id', meme.id)
      .single();

    if (existingFees) {
      await supabase
        .from('token_fees')
        .update({
          total_fees_sol: Number(existingFees.total_fees_sol) + feeTx.amountSol,
          last_updated: new Date().toISOString(),
        })
        .eq('id', existingFees.id);
    } else {
      await supabase.from('token_fees').insert({
        meme_id: meme.id,
        mint_address: meme.mint_address,
        total_fees_sol: feeTx.amountSol,
      });
    }

    // Record the processed transaction
    await supabase.from('fee_transactions').insert({
      meme_id: meme.id,
      mint_address: meme.mint_address,
      tx_signature: feeTx.signature,
      amount_sol: feeTx.amountSol,
      processed: true,
    });

    processedCount++;
    totalFeesProcessed += feeTx.amountSol;

    console.log(`Processed fee tx ${feeTx.signature}: ${feeTx.amountSol} SOL for ${meme.id} (platform: ${distribution.platformAmount.toFixed(4)} SOL)`);
  }

  return {
    success: true,
    transactionsFound: feeTransactions.length,
    transactionsProcessed: processedCount,
    totalFeesProcessed,
  };
}

// POST - manual trigger with auth
export async function POST(request: NextRequest) {
  try {
    // Check for manual auth
    const authHeader = request.headers.get('authorization');
    const expectedKey = process.env.CRON_SECRET || 'prooflaunch-fees';

    if (authHeader !== `Bearer ${expectedKey}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = await processFees();
    return NextResponse.json(result);
  } catch (error) {
    console.error('Fee processing error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// GET - handles Vercel cron trigger (every 5 minutes) or status check
export async function GET(request: NextRequest) {
  // Check if this is a Vercel cron trigger
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';

  if (isVercelCron) {
    // Run the fee processing logic
    try {
      const result = await processFees();
      return NextResponse.json(result);
    } catch (error) {
      console.error('Cron fee processing error:', error);
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Unknown error' },
        { status: 500 }
      );
    }
  }

  // Otherwise return status
  try {
    const supabase = createServerClient();

    const { data: stats } = await supabase
      .from('token_fees')
      .select('total_fees_sol');

    const totalFees = stats?.reduce((sum, t) => sum + Number(t.total_fees_sol), 0) || 0;

    const { count: txCount } = await supabase
      .from('fee_transactions')
      .select('*', { count: 'exact', head: true })
      .eq('processed', true);

    return NextResponse.json({
      totalFeesTracked: totalFees,
      processedTransactions: txCount || 0,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to get fee stats' },
      { status: 500 }
    );
  }
}
