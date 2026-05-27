import { NextRequest, NextResponse } from 'next/server';
import { authenticatePartnerRequest, logPartnerRequestOutcome } from '@/lib/partnerAuth';
import { createServerClient } from '@/lib/supabase';

// GET /api/v1/partners/sessions/{session_id}
// ──────────────────────────────────────────────────────────────────────
// Poll a session's status. Returns the session record plus the linked
// meme_id + public meme_url once the user completes the submission flow.
//
// Auth: Authorization: Bearer pl_(live|test)_xxx
// Authorization: a partner can only fetch their own sessions; cross-partner
//   reads return 404 (we don't reveal the existence of other partners' data).

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticatePartnerRequest(req);
  if (!auth.ok) return auth.response;
  const { partner, startedAt } = auth;

  const { id } = await params;
  const path = `/api/v1/partners/sessions/${id}`;

  const respond = (status: number, body: unknown) => {
    const res = NextResponse.json(body, { status });
    logPartnerRequestOutcome({
      partner_id: partner.id,
      method: 'GET',
      path,
      status_code: status,
      ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
      user_agent: req.headers.get('user-agent'),
      request_id: req.headers.get('x-request-id'),
      duration_ms: Date.now() - startedAt,
    });
    return res;
  };

  if (!id || !id.startsWith('pls_')) {
    return respond(404, { error: { code: 'not_found', message: 'Session not found.' } });
  }

  const supabase = createServerClient();
  const { data: session, error } = await supabase
    .from('partner_sessions')
    .select(`
      id, partner_id, status, meme_id, partner_reference,
      name, symbol, description, image_url, creator_wallet,
      total_slots, min_backing_sol, metadata,
      return_url, webhook_url,
      created_at, submitted_at, expires_at
    `)
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('[partners/sessions/:id] lookup error:', error);
    return respond(500, { error: { code: 'internal_error', message: 'Lookup failed.' } });
  }
  // Treat cross-partner reads as 404 (don't leak existence)
  if (!session || session.partner_id !== partner.id) {
    return respond(404, { error: { code: 'not_found', message: 'Session not found.' } });
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://prooflaunch.fun';

  return respond(200, {
    session_id: session.id,
    status: session.status,
    partner_reference: session.partner_reference,

    // Submission inputs the partner sent at creation
    name: session.name,
    symbol: session.symbol,
    description: session.description,
    image_url: session.image_url,
    creator_wallet: session.creator_wallet,
    total_slots: session.total_slots,
    min_backing_sol: Number(session.min_backing_sol),
    metadata: session.metadata,

    // Callbacks
    return_url: session.return_url,
    webhook_url: session.webhook_url,

    // Populated once the user completes /submit
    meme_id: session.meme_id,
    meme_url: session.meme_id ? `${baseUrl}/meme/${session.meme_id}` : null,
    checkout_url: session.status === 'pending' ? `${baseUrl}/submit?session=${session.id}` : null,

    // Timestamps
    created_at: session.created_at,
    submitted_at: session.submitted_at,
    expires_at: session.expires_at,
  });
}
