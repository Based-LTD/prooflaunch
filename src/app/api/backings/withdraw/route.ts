import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { refundFromPool } from '@/services/pumpfun';
import { verifySignedAuthMessage } from '@/lib/crypto';
import { rateLimiters } from '@/lib/rateLimit';

// Withdrawal fee - stays in burner wallet as dust
const WITHDRAWAL_FEE_PERCENT = 2; // 2% fee on withdrawals

// POST /api/backings/withdraw - Withdraw backing from a meme
export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClient();
    const body = await request.json();

    const { meme_id, backer_wallet, signature, message } = body;

    if (!meme_id || !backer_wallet) {
      return NextResponse.json(
        { error: 'Missing required fields: meme_id, backer_wallet' },
        { status: 400 }
      );
    }

    // Require timestamped wallet signature to prove ownership
    if (!signature || !message) {
      return NextResponse.json({ error: 'Wallet signature required' }, { status: 401 });
    }
    const auth = verifySignedAuthMessage(
      `withdraw:${meme_id}:${backer_wallet}`,
      message, signature, backer_wallet
    );
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    // Rate limiting - 3 withdraw requests per minute per wallet
    const rateLimitResult = rateLimiters.withdraw(backer_wallet);
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: 'Too many requests. Please wait before trying again.' },
        { status: 429 }
      );
    }

    // Get the meme to check status
    const { data: meme, error: memeError } = await supabase
      .from('memes')
      .select('status, name, pool_wallet, encrypted_pool_key')
      .eq('id', meme_id)
      .single();

    if (memeError || !meme) {
      return NextResponse.json({ error: 'Meme not found' }, { status: 404 });
    }

    // Voluntary withdrawal is only allowed while slots are still being
    // filled ('backing'). Once the pool is full ('funded') it's a
    // committed group ready to launch — a last-second exit would break
    // the deal for the other backers and the creator. An abandoned
    // 'funded' meme is NOT a trap: the process-memes cron auto-refunds
    // every backer in full once the backing_deadline passes.
    if (meme.status !== 'backing') {
      return NextResponse.json(
        { error: `Cannot withdraw: meme is ${meme.status}. Withdrawals are only allowed while slots are still filling.` },
        { status: 400 }
      );
    }

    // Get the backing record
    const { data: backing, error: backingError } = await supabase
      .from('backings')
      .select('*')
      .eq('meme_id', meme_id)
      .eq('backer_wallet', backer_wallet)
      .single();

    if (backingError || !backing) {
      return NextResponse.json(
        { error: 'Backing not found for this wallet' },
        { status: 404 }
      );
    }

    if (backing.status === 'withdrawn') {
      return NextResponse.json(
        { error: 'This backing has already been withdrawn' },
        { status: 400 }
      );
    }

    if (backing.status === 'distributed') {
      return NextResponse.json(
        { error: 'Tokens have already been distributed for this backing' },
        { status: 400 }
      );
    }

    // Pooled model: refund comes from this meme's pool wallet (where the
    // backer's SOL was deposited), not a per-backer burner.
    if (!meme.pool_wallet || !meme.encrypted_pool_key) {
      return NextResponse.json(
        { error: 'This meme has no pool wallet. Please contact support.' },
        { status: 400 }
      );
    }

    const amountSol = Number(backing.amount_sol);

    // Calculate expected withdrawal fee
    const withdrawalFee = amountSol * (WITHDRAWAL_FEE_PERCENT / 100);
    const expectedRefund = amountSol - withdrawalFee;

    // Process refund from the pool wallet to the backer's main wallet.
    // refundFromPool only sends back this backer's share — other backers'
    // funds in the pool are untouched.
    console.log(`Processing pool withdrawal: ${amountSol} SOL - ${WITHDRAWAL_FEE_PERCENT}% fee to ${backer_wallet}`);
    const refundResult = await refundFromPool(
      meme.encrypted_pool_key,
      meme.pool_wallet,
      backer_wallet,
      amountSol,
      WITHDRAWAL_FEE_PERCENT
    );

    if (!refundResult.success) {
      console.error('Refund failed:', refundResult.error);
      return NextResponse.json(
        { error: `Refund failed: ${refundResult.error}` },
        { status: 500 }
      );
    }

    const refundAmount = refundResult.amountRefunded || expectedRefund;

    // Update backing status to withdrawn
    const { error: updateError } = await supabase
      .from('backings')
      .update({
        status: 'withdrawn',
        refund_tx: refundResult.signature,
      })
      .eq('id', backing.id);

    if (updateError) {
      console.error('Failed to update backing status:', updateError);
      // Note: Refund already happened, so we log but don't fail
    }

    // The database trigger will automatically update current_backing_sol
    // But we need to handle the withdrawal case - let's manually update
    const { data: updatedMeme } = await supabase
      .from('memes')
      .select('current_backing_sol')
      .eq('id', meme_id)
      .single();

    console.log(`Withdrawal complete. New backing total: ${updatedMeme?.current_backing_sol} SOL`);

    // Calculate actual fee based on what was refunded
    const actualFee = amountSol - refundAmount;

    return NextResponse.json({
      success: true,
      original_amount: amountSol,
      withdrawal_fee: actualFee,
      amount_refunded: refundAmount,
      refund_tx: refundResult.signature,
      message: `Successfully withdrew ${refundAmount.toFixed(4)} SOL (fee: ${actualFee.toFixed(4)} SOL)`,
    });
  } catch (error) {
    console.error('Withdrawal error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: `Withdrawal failed: ${errorMessage}` },
      { status: 500 }
    );
  }
}
