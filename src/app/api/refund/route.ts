import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { refundBacker } from '@/services/pumpfun';

// POST /api/refund - Request a refund for a failed meme
export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClient();
    const body = await request.json();

    const { meme_id, backer_wallet } = body;

    if (!meme_id || !backer_wallet) {
      return NextResponse.json(
        { error: 'meme_id and backer_wallet are required' },
        { status: 400 }
      );
    }

    // Get the meme
    const { data: meme, error: memeError } = await supabase
      .from('memes')
      .select('*')
      .eq('id', meme_id)
      .single();

    if (memeError || !meme) {
      return NextResponse.json({ error: 'Meme not found' }, { status: 404 });
    }

    // Check if meme is eligible for refund
    const now = new Date();
    const deadline = new Date(meme.backing_deadline);
    const isPastDeadline = deadline < now;
    const currentBacking = Number(meme.current_backing_sol);
    const goal = Number(meme.backing_goal_sol);
    const goalNotReached = currentBacking < goal;

    if (meme.status === 'live') {
      return NextResponse.json(
        { error: 'Cannot refund - meme has launched' },
        { status: 400 }
      );
    }

    if (!isPastDeadline) {
      return NextResponse.json(
        { error: 'Cannot refund - backing period still active' },
        { status: 400 }
      );
    }

    if (!goalNotReached && meme.status !== 'failed') {
      return NextResponse.json(
        { error: 'Cannot refund - goal was reached' },
        { status: 400 }
      );
    }

    // Get the backing
    const { data: backing, error: backingError } = await supabase
      .from('backings')
      .select('*')
      .eq('meme_id', meme_id)
      .eq('backer_wallet', backer_wallet)
      .single();

    if (backingError || !backing) {
      return NextResponse.json({ error: 'Backing not found' }, { status: 404 });
    }

    if (backing.status === 'refunded') {
      return NextResponse.json(
        { error: 'Already refunded', refund_tx: backing.refund_tx },
        { status: 400 }
      );
    }

    if (backing.status !== 'confirmed') {
      return NextResponse.json(
        { error: `Cannot refund - backing status is ${backing.status}` },
        { status: 400 }
      );
    }

    // Process the refund
    console.log(`Processing refund: ${backing.amount_sol} SOL to ${backer_wallet}`);
    const result = await refundBacker(backer_wallet, backing.amount_sol);

    if (!result.success) {
      return NextResponse.json(
        { error: `Refund failed: ${result.error}` },
        { status: 500 }
      );
    }

    // Update backing status
    await supabase
      .from('backings')
      .update({
        status: 'refunded',
        refund_tx: result.signature,
      })
      .eq('id', backing.id);

    // Check if all backings are now refunded
    const { data: remainingBackings } = await supabase
      .from('backings')
      .select('id')
      .eq('meme_id', meme_id)
      .eq('status', 'confirmed');

    if (!remainingBackings || remainingBackings.length === 0) {
      // All backings refunded - mark meme as failed
      await supabase
        .from('memes')
        .update({ status: 'failed' })
        .eq('id', meme_id);
    }

    return NextResponse.json({
      success: true,
      refund_tx: result.signature,
      amount_sol: backing.amount_sol,
    });
  } catch (error) {
    console.error('Refund error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// GET /api/refund?meme_id=...&backer_wallet=... - Check refund eligibility
export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);

    const meme_id = searchParams.get('meme_id');
    const backer_wallet = searchParams.get('backer_wallet');

    if (!meme_id || !backer_wallet) {
      return NextResponse.json(
        { error: 'meme_id and backer_wallet are required' },
        { status: 400 }
      );
    }

    // Get meme and backing info
    const { data: meme } = await supabase
      .from('memes')
      .select('*')
      .eq('id', meme_id)
      .single();

    const { data: backing } = await supabase
      .from('backings')
      .select('*')
      .eq('meme_id', meme_id)
      .eq('backer_wallet', backer_wallet)
      .single();

    if (!meme || !backing) {
      return NextResponse.json({ eligible: false, reason: 'Not found' });
    }

    const now = new Date();
    const deadline = new Date(meme.backing_deadline);
    const isPastDeadline = deadline < now;
    const currentBacking = Number(meme.current_backing_sol);
    const goal = Number(meme.backing_goal_sol);
    const goalNotReached = currentBacking < goal;

    const eligible =
      backing.status === 'confirmed' &&
      isPastDeadline &&
      (goalNotReached || meme.status === 'failed') &&
      meme.status !== 'live';

    return NextResponse.json({
      eligible,
      backing_status: backing.status,
      meme_status: meme.status,
      amount_sol: backing.amount_sol,
      is_past_deadline: isPastDeadline,
      goal_reached: !goalNotReached,
      refund_tx: backing.refund_tx,
    });
  } catch (error) {
    console.error('Check refund eligibility error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
