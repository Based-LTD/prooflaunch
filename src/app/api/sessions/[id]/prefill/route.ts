import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

// GET /api/sessions/{id}/prefill — PUBLIC, no auth.
// ─────────────────────────────────────────────────────────────────────
// Returns the prefill-safe fields of a partner_sessions row so the
// /submit page can render the form with partner-supplied values when
// the user lands via a partner checkout URL.
//
// We intentionally OMIT fields that could leak partner internals:
//   - partner_id (replaced with the partner's public slug + display_name)
//   - return_url, webhook_url (callbacks — server-only)
//   - partner_reference (partner's private correlation id)
//
// Sessions that are not 'pending' or are expired return 410 Gone so the
// submit page can show a friendly "this checkout link expired" state
// instead of pretending to prefill a dead session.

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id || !id.startsWith('pls_')) {
    return NextResponse.json({ error: { code: 'not_found', message: 'Invalid session id.' } }, { status: 404 });
  }

  const supabase = createServerClient();
  const { data: session, error } = await supabase
    .from('partner_sessions')
    .select(`
      id, status, expires_at, meme_id,
      name, symbol, description, image_url, creator_wallet,
      total_slots, min_backing_sol, metadata,
      return_url, partner_id
    `)
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('[sessions/prefill] lookup error:', error);
    return NextResponse.json({ error: { code: 'internal_error', message: 'Lookup failed.' } }, { status: 500 });
  }
  if (!session) {
    return NextResponse.json({ error: { code: 'not_found', message: 'Session not found.' } }, { status: 404 });
  }

  // Reject expired or already-completed sessions
  if (session.status === 'expired' || new Date(session.expires_at) <= new Date()) {
    return NextResponse.json(
      { error: { code: 'session_expired', message: 'This checkout link has expired.' } },
      { status: 410 },
    );
  }
  if (session.status === 'submitted' && session.meme_id) {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://prooflaunch.fun';
    return NextResponse.json(
      {
        error: {
          code: 'session_already_submitted',
          message: 'This session was already submitted.',
          meme_url: `${baseUrl}/meme/${session.meme_id}`,
        },
      },
      { status: 410 },
    );
  }
  if (session.status === 'cancelled') {
    return NextResponse.json(
      { error: { code: 'session_cancelled', message: 'This session was cancelled.' } },
      { status: 410 },
    );
  }

  // Look up partner's public-facing identity (slug + display_name only)
  const { data: partner } = await supabase
    .from('partners')
    .select('slug, display_name')
    .eq('id', session.partner_id)
    .maybeSingle();

  // Filter metadata down to known-safe socials only (drop any freeform partner fields)
  const md = (session.metadata && typeof session.metadata === 'object' && !Array.isArray(session.metadata))
    ? session.metadata as Record<string, unknown>
    : {};
  const socials = {
    twitter: typeof md.twitter === 'string' ? md.twitter : undefined,
    telegram: typeof md.telegram === 'string' ? md.telegram : undefined,
    discord: typeof md.discord === 'string' ? md.discord : undefined,
    website: typeof md.website === 'string' ? md.website : undefined,
  };

  return NextResponse.json({
    session_id: session.id,
    status: session.status,
    // Prefill values
    name: session.name,
    symbol: session.symbol,
    description: session.description,
    image_url: session.image_url,
    creator_wallet: session.creator_wallet,
    total_slots: session.total_slots,
    min_backing_sol: Number(session.min_backing_sol),
    socials,
    // The partner's return URL — the user's browser will be sent there
    // after successful submission. Already visible in the address bar
    // post-redirect, so no leak in returning it here.
    return_url: session.return_url,
    // Partner identity (public-facing only)
    partner: partner ? { slug: partner.slug, display_name: partner.display_name } : null,
  });
}
