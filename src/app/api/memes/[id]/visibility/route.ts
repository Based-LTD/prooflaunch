import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { verifySignedAuthMessage } from '@/lib/crypto';

/**
 * PATCH /api/memes/{id}/visibility
 *
 * Creator-only endpoint to change a launch's visibility mode.
 *
 *   open      → standard public launch, anyone backs
 *   stealth   → hidden from public listings, allowlist-only backing
 *   spectator → public listing, allowlist-only backing
 *
 * Auth: timestamped signed message:
 *   "visibility-set:{meme_id}:{caller_wallet}:{unix_ms}"
 *
 * Every change is logged to meme_visibility_changes for the
 * transparency audit trail. PROOF guarantee: nothing about how a launch
 * was managed is hidden after the fact.
 *
 * Restrictions:
 *   - Cannot change visibility on a meme that's already past 'backing' status
 *     (would be confusing if a funded/launched token's listing flipped modes)
 *   - Only the creator can call this
 */

const VALID_VISIBILITIES = new Set(['open', 'stealth', 'spectator']);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { caller_wallet, signature, message, visibility } = body;

    if (!caller_wallet) {
      return NextResponse.json({ error: 'caller_wallet required' }, { status: 400 });
    }
    if (!signature || !message) {
      return NextResponse.json({ error: 'Wallet signature required' }, { status: 401 });
    }
    if (!visibility || !VALID_VISIBILITIES.has(visibility)) {
      return NextResponse.json(
        { error: 'visibility must be one of: open, stealth, spectator' },
        { status: 400 },
      );
    }

    const auth = verifySignedAuthMessage(
      `visibility-set:${id}:${caller_wallet}`,
      message,
      signature,
      caller_wallet,
    );
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const supabase = createServerClient();

    const { data: meme } = await supabase
      .from('memes')
      .select('creator_wallet, visibility, status')
      .eq('id', id)
      .single();

    if (!meme) return NextResponse.json({ error: 'Meme not found' }, { status: 404 });

    if (meme.creator_wallet !== caller_wallet) {
      return NextResponse.json({ error: 'Only the meme creator can change visibility' }, { status: 403 });
    }

    if (meme.status !== 'backing') {
      return NextResponse.json(
        { error: `Visibility can only be changed during the backing phase (current status: ${meme.status})` },
        { status: 400 },
      );
    }

    if (meme.visibility === visibility) {
      return NextResponse.json({
        ok: true,
        unchanged: true,
        visibility,
      });
    }

    // Optimistic-lock update — protects against concurrent updates.
    const { error: updateErr, data: updated } = await supabase
      .from('memes')
      .update({ visibility })
      .eq('id', id)
      .eq('visibility', meme.visibility) // optimistic lock
      .select('id, visibility')
      .single();

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }
    if (!updated) {
      return NextResponse.json(
        { error: 'Visibility was changed by another request, please retry' },
        { status: 409 },
      );
    }

    // Audit log — every change recorded for the transparency trail
    await supabase.from('meme_visibility_changes').insert({
      meme_id: id,
      from_value: meme.visibility,
      to_value: visibility,
      changed_by: caller_wallet,
      reason: 'manual_toggle',
    });

    return NextResponse.json({
      ok: true,
      from: meme.visibility,
      to: visibility,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Internal error' },
      { status: 500 },
    );
  }
}
