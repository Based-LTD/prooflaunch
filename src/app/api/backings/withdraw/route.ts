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

    // ── TOCTOU-safe withdraw flow ────────────────────────────────────
    // Previous flow read status, did the on-chain refund, then flipped
    // status to 'withdrawn' — concurrent requests could all observe
    // status='confirmed' and trigger N parallel refunds, draining the pool
    // past this backer's share.
    //
    // New flow uses refund_tx as an atomic lock: we flip status to
    // 'withdrawn' BEFORE the refund, gated by `WHERE status = backing.status
    // AND refund_tx IS NULL`. Only ONE concurrent request wins the lock;
    // the rest see 0 rows and return 409. On refund failure we revert the
    // status flip so the user can retry.
    const expectedStatus = backing.status; // captured from the SELECT above
    const lockSig = `pending:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    const { data: locked, error: lockErr } = await supabase
      .from('backings')
      .update({ status: 'withdrawn', refund_tx: lockSig })
      .eq('id', backing.id)
      .eq('status', expectedStatus)   // ← OPTIMISTIC LOCK on status
      .is('refund_tx', null)          // ← AND refund hasn't started
      .select('id');

    if (lockErr) {
      console.error('Lock attempt failed:', lockErr);
      return NextResponse.json({ error: 'Withdrawal failed (lock error)' }, { status: 500 });
    }
    if (!locked || locked.length === 0) {
      // Another request beat us to it — either already withdrawn or refund in flight.
      return NextResponse.json(
        { error: 'Withdrawal already in progress or completed (concurrent request)' },
        { status: 409 }
      );
    }

    const amountSol = Number(backing.amount_sol);
    const withdrawalFee = amountSol * (WITHDRAWAL_FEE_PERCENT / 100);
    const expectedRefund = amountSol - withdrawalFee;

    // Process the on-chain refund. If anything fails we MUST revert the
    // lock above, otherwise the user is stuck "withdrawn" with no SOL.
    console.log(`Processing pool withdrawal: ${amountSol} SOL - ${WITHDRAWAL_FEE_PERCENT}% fee to ${backer_wallet}`);
    let refundResult;
    try {
      refundResult = await refundFromPool(
        meme.encrypted_pool_key,
        meme.pool_wallet,
        backer_wallet,
        amountSol,
        WITHDRAWAL_FEE_PERCENT
      );
    } catch (e) {
      // Revert the lock so the user can retry.
      await supabase
        .from('backings')
        .update({ status: expectedStatus, refund_tx: null })
        .eq('id', backing.id);
      console.error('Refund threw, lock reverted:', e);
      return NextResponse.json(
        { error: `Refund failed: ${e instanceof Error ? e.message : 'unknown'}` },
        { status: 500 }
      );
    }

    if (!refundResult.success) {
      // Soft failure inside refundFromPool — also revert the lock.
      await supabase
        .from('backings')
        .update({ status: expectedStatus, refund_tx: null })
        .eq('id', backing.id);
      console.error('Refund failed, lock reverted:', refundResult.error);
      return NextResponse.json(
        { error: `Refund failed: ${refundResult.error}` },
        { status: 500 }
      );
    }

    const refundAmount = refundResult.amountRefunded || expectedRefund;

    // Replace the placeholder refund_tx with the real on-chain signature.
    const { error: updateError } = await supabase
      .from('backings')
      .update({ refund_tx: refundResult.signature })
      .eq('id', backing.id);

    if (updateError) {
      // Refund landed but tx_sig didn't persist. Log loud, don't fail the
      // response — user already has their SOL. Reconcile cron can fix.
      console.error('Failed to persist refund_tx (refund DID land on-chain):', updateError);
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
