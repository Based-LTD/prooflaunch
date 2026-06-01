import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { getRecentFeeTransactions, calculateFeeDistribution } from '@/services/feeTracker';
import { collectAndCreditFees } from '@/services/distribution';
import { distributeAllLegacyMemes } from '@/services/legacyFeeDistribution';
import { collectMeteoraFeesForCron } from '@/services/fees/meteora-dbc';
import { authorizeCron } from '@/lib/cronAuth';

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

  // === Per-coin sub-escrow fee collection (P5: the new model) ===
  // For each LIVE meme with a sub-escrow (i.e. submitted post-P2):
  // proactively collect from its creator-vault into shared escrow and
  // credit backers' claimable_fees_sol per-coin. Legacy memes (no
  // sub-escrow, like PROOF) are skipped — their fees route to shared
  // escrow as platform revenue via the older path above, unchanged.
  //
  // Dispatched by launch_platform: pump.fun memes use the existing
  // collectAndCreditFees (collect_creator_fee → drain + split).
  // Meteora memes use collectMeteoraFeesForCron (claimCreatorTradingFee).
  // The platform-agnostic drain-and-credit-backers half is reused once
  // we have real Meteora fee flow to validate against.
  const subescrowResults: Array<{ memeId: string; result: Awaited<ReturnType<typeof collectAndCreditFees>> }> = [];
  const meteoraResults: Array<{ memeId: string; result: Awaited<ReturnType<typeof collectMeteoraFeesForCron>> }> = [];
  const { data: subEscrowMemes } = await supabase
    .from('memes')
    .select('id, symbol, launch_platform')
    .eq('status', 'live')
    .not('creator_subescrow_pubkey', 'is', null);
  for (const m of subEscrowMemes || []) {
    // Default to 'pumpfun' for any row where launch_platform is NULL
    // (defense in depth — DB default already enforces this, but we
    // never want a bad column value to bypass platform routing).
    const platform = m.launch_platform === 'meteora' ? 'meteora' : 'pumpfun';
    try {
      if (platform === 'meteora') {
        const r = await collectMeteoraFeesForCron(supabase, m.id);
        meteoraResults.push({ memeId: m.id, result: r });
        if (r.ok && !r.skipped && r.claimSig) {
          console.log(`[fee-collect/meteora] ${m.symbol} (${m.id}): claim ${r.claimSig}`);
        } else if (r.skipped) {
          console.log(`[fee-collect/meteora] ${m.symbol} (${m.id}) skipped: ${r.skipped}`);
        } else if (!r.ok) {
          console.log(`[fee-collect/meteora] ${m.symbol} (${m.id}) ERROR: ${r.error}`);
        }
      } else {
        const r = await collectAndCreditFees(supabase, m.id);
        subescrowResults.push({ memeId: m.id, result: r });
        if (r.ok && !r.skipped) {
          console.log(`[fee-collect] ${m.symbol} (${m.id}): collected ${r.collectedLamports} lamports, credited ${r.backerCount} backers, platform ${r.platformLamports}`);
        } else if (r.skipped) {
          console.log(`[fee-collect] ${m.symbol} (${m.id}) skipped: ${r.skipped}`);
        } else {
          console.log(`[fee-collect] ${m.symbol} (${m.id}) ERROR: ${r.error}`);
        }
      }
    } catch (e) {
      console.error(`[fee-collect] ${m.id} exception:`, e);
      if (platform === 'meteora') {
        meteoraResults.push({ memeId: m.id, result: { ok: false, error: e instanceof Error ? e.message : String(e) } });
      } else {
        subescrowResults.push({ memeId: m.id, result: { ok: false, error: e instanceof Error ? e.message : String(e) } });
      }
    }
  }

  // === Legacy (pre-Phase-2) shared-escrow memes ===
  // PROOF and other pre-P2 memes registered the shared platform escrow
  // as their pump.fun creator, so collectAndCreditFees (Phase 2 path)
  // skips them. This block calls the legacy distribution path for each
  // pre-P2 meme — safety-floor gated (0.1 SOL min collectable), reverts
  // cleanly on partial failure, idempotent across cron retries.
  let legacyResults: Awaited<ReturnType<typeof distributeAllLegacyMemes>> = [];
  try {
    legacyResults = await distributeAllLegacyMemes(supabase);
    for (const r of legacyResults) {
      const s = r.result;
      if (s.ok && !s.skipped) {
        console.log(`[legacy-distribute] ${s.symbol} (${r.mint.slice(0, 8)}…): collected ${s.collectedLamports} lamports, slot1=${s.sentToSlot1WalletLamports}, holders=${s.sentToHolderRewardsLamports}, collect_tx=${s.collectSig}, transfer_tx=${s.transferSig}`);
      } else if (s.skipped) {
        console.log(`[legacy-distribute] ${s.symbol} skipped: ${s.skipped}`);
      } else {
        console.error(`[legacy-distribute] ${s.symbol} ERROR: ${s.error}`);
      }
    }
  } catch (e) {
    console.error('[legacy-distribute] top-level exception:', e);
  }

  return {
    success: true,
    transactionsFound: feeTransactions.length,
    transactionsProcessed: processedCount,
    totalFeesProcessed,
    subescrowMemesScanned: subEscrowMemes?.length || 0,
    subescrowResults,
    meteoraResults,
    legacyResults,
  };
}

// POST - manual trigger with auth
export async function POST(request: NextRequest) {
  const auth = authorizeCron(request);
  if (!auth.ok) return auth.response;

  try {
    const result = await processFees();
    return NextResponse.json(result);
  } catch (error) {
    console.error('Fee processing error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
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
        { error: 'Internal server error' },
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
