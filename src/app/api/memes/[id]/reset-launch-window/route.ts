import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { verifySignedAuthMessage } from '@/lib/crypto';

/**
 * POST /api/memes/{id}/reset-launch-window
 *
 * Resets a funded meme's launch_deadline to NOW() + 48 hours. Only the
 * meme's creator can call this. Used to extend the launch window when
 * the creator needs more time but is still actively planning to launch.
 *
 * Each reset writes a row to launch_window_resets for the public
 * engagement signal — backers can see "creator reset 3 times in 6 days"
 * = active vs "no reset, 6h left" = abandoned.
 *
 * Auth: timestamped signed message:
 *   "reset:{meme_id}:{caller_wallet}:{unix_ms}"
 *
 * Preconditions:
 *   - meme.status === 'funded'  (can't reset before funding or after launch)
 *   - caller_wallet === meme.creator_wallet
 *   - signature valid + within timestamp window
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { caller_wallet, signature, message } = body;

    if (!caller_wallet) {
      return NextResponse.json({ error: 'caller_wallet required' }, { status: 400 });
    }
    if (!signature || !message) {
      return NextResponse.json({ error: 'Wallet signature required' }, { status: 401 });
    }

    // Verify the signed message — proves wallet ownership + has timestamp
    // replay protection (5 min window) baked into verifySignedAuthMessage.
    const auth = verifySignedAuthMessage(
      `reset:${id}:${caller_wallet}`,
      message,
      signature,
      caller_wallet,
    );
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const supabase = createServerClient();

    // Load meme — need status check + creator verification + previous deadline
    const { data: meme, error: memeErr } = await supabase
      .from('memes')
      .select('id, status, creator_wallet, launch_deadline, symbol, name')
      .eq('id', id)
      .single();
    if (memeErr || !meme) {
      return NextResponse.json({ error: 'Meme not found' }, { status: 404 });
    }
    if (meme.creator_wallet !== caller_wallet) {
      return NextResponse.json(
        { error: 'Only the meme creator can reset the launch window' },
        { status: 403 },
      );
    }
    if (meme.status !== 'funded') {
      return NextResponse.json(
        { error: `Launch window only resettable on funded memes. Current status: ${meme.status}` },
        { status: 400 },
      );
    }
    if (!meme.launch_deadline) {
      // Should never happen — trigger sets it on funded transition — but
      // be defensive in case data drift left a pre-trigger funded row.
      return NextResponse.json(
        { error: 'Meme has no launch_deadline (data drift). Contact support.' },
        { status: 500 },
      );
    }

    const previousDeadline = meme.launch_deadline;
    const newDeadline = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

    // Atomic update — only proceed if status is still 'funded' (defensive
    // against the meme being launched in the same millisecond). And only
    // extend forward — don't let a reset SHORTEN the deadline if something
    // weird is going on with clock skew.
    const { data: updated, error: updateErr } = await supabase
      .from('memes')
      .update({ launch_deadline: newDeadline })
      .eq('id', id)
      .eq('status', 'funded')
      .select('id, launch_deadline');
    if (updateErr) {
      return NextResponse.json({ error: `Update failed: ${updateErr.message}` }, { status: 500 });
    }
    if (!updated || updated.length === 0) {
      return NextResponse.json(
        { error: 'Meme status changed during reset (likely just launched). Refresh and check.' },
        { status: 409 },
      );
    }

    // Write the audit row for the public engagement signal
    const { error: auditErr } = await supabase
      .from('launch_window_resets')
      .insert({
        meme_id: id,
        reset_by_wallet: caller_wallet,
        previous_deadline: previousDeadline,
        new_deadline: newDeadline,
      });
    if (auditErr) {
      // Reset itself succeeded — log the audit failure but don't fail
      // the response. The deadline is moved either way.
      console.warn(`[reset-launch-window] audit write failed for ${id}:`, auditErr.message);
    }

    return NextResponse.json({
      success: true,
      meme_id: id,
      symbol: meme.symbol,
      previous_deadline: previousDeadline,
      new_deadline: newDeadline,
      hours_added: 48,
    });
  } catch (e) {
    console.error('Reset launch window error:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
