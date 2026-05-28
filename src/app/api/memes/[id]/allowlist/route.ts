import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { verifySignedAuthMessage } from '@/lib/crypto';

/**
 * Allowlist management for stealth/spectator launches.
 *
 *   GET    /api/memes/{id}/allowlist          → list current allowlist (public)
 *   POST   /api/memes/{id}/allowlist          → add wallets (creator-only)
 *   DELETE /api/memes/{id}/allowlist?wallet=X → remove a wallet (creator-only)
 *
 * Auth (POST/DELETE): timestamped signed message:
 *   "allowlist-modify:{meme_id}:{caller_wallet}:{unix_ms}"
 *
 * GET is public because the allowlist table has RLS public-read — the
 * counts + identities are part of the PROOF transparency story (you can
 * always verify who was on the list at any moment).
 */

// ── GET ────────────────────────────────────────────────────────────
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from('backing_allowlist')
    .select('wallet, note, added_at')
    .eq('meme_id', id)
    .order('added_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ allowlist: data ?? [] });
}

// ── POST: add wallets ──────────────────────────────────────────────
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { caller_wallet, signature, message, wallets, note } = body;

    if (!caller_wallet) {
      return NextResponse.json({ error: 'caller_wallet required' }, { status: 400 });
    }
    if (!signature || !message) {
      return NextResponse.json({ error: 'Wallet signature required' }, { status: 401 });
    }
    if (!Array.isArray(wallets) || wallets.length === 0) {
      return NextResponse.json({ error: 'wallets array required' }, { status: 400 });
    }

    // Verify the signed message — proves wallet ownership + replay-protected
    const auth = verifySignedAuthMessage(
      `allowlist-modify:${id}:${caller_wallet}`,
      message,
      signature,
      caller_wallet,
    );
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const supabase = createServerClient();

    // Verify caller is the meme's creator
    const { data: meme } = await supabase
      .from('memes')
      .select('creator_wallet, visibility')
      .eq('id', id)
      .single();
    if (!meme) return NextResponse.json({ error: 'Meme not found' }, { status: 404 });
    if (meme.creator_wallet !== caller_wallet) {
      return NextResponse.json({ error: 'Only the meme creator can modify the allowlist' }, { status: 403 });
    }
    if (meme.visibility === 'open') {
      return NextResponse.json(
        { error: 'Allowlist is unused for open launches — change visibility to stealth or spectator first' },
        { status: 400 },
      );
    }

    // Validate + dedupe wallets
    const cleaned = Array.from(new Set(
      wallets
        .filter((w: unknown): w is string => typeof w === 'string')
        .map((w: string) => w.trim())
        .filter((w: string) => w.length >= 32 && w.length <= 50),
    ));
    if (cleaned.length === 0) {
      return NextResponse.json({ error: 'No valid wallets in payload' }, { status: 400 });
    }

    // Upsert (ignore conflicts on UNIQUE meme_id+wallet)
    const rows = cleaned.map((wallet) => ({
      meme_id: id,
      wallet,
      added_by: caller_wallet,
      note: note ?? null,
    }));

    const { data: inserted, error: insertErr } = await supabase
      .from('backing_allowlist')
      .upsert(rows, { onConflict: 'meme_id,wallet', ignoreDuplicates: true })
      .select();

    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      added: inserted?.length ?? 0,
      attempted: cleaned.length,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Internal error' },
      { status: 500 },
    );
  }
}

// ── DELETE: remove a wallet ────────────────────────────────────────
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { caller_wallet, signature, message, wallet } = body;

    if (!caller_wallet || !wallet) {
      return NextResponse.json({ error: 'caller_wallet + wallet required' }, { status: 400 });
    }
    if (!signature || !message) {
      return NextResponse.json({ error: 'Wallet signature required' }, { status: 401 });
    }

    const auth = verifySignedAuthMessage(
      `allowlist-modify:${id}:${caller_wallet}`,
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
      .select('creator_wallet')
      .eq('id', id)
      .single();
    if (!meme) return NextResponse.json({ error: 'Meme not found' }, { status: 404 });
    if (meme.creator_wallet !== caller_wallet) {
      return NextResponse.json({ error: 'Only the meme creator can modify the allowlist' }, { status: 403 });
    }

    // Refuse to remove the creator's own wallet (UX safety — they'd lock
    // themselves out of their own launch otherwise).
    if (wallet === caller_wallet) {
      return NextResponse.json(
        { error: 'Cannot remove your own wallet from the allowlist' },
        { status: 400 },
      );
    }

    const { error: delErr, count } = await supabase
      .from('backing_allowlist')
      .delete({ count: 'exact' })
      .eq('meme_id', id)
      .eq('wallet', wallet);

    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, removed: count ?? 0 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Internal error' },
      { status: 500 },
    );
  }
}
