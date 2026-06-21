import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

// Outbound webhook delivery for partner events.
//
// V1: best-effort fire-and-forget. We sign with HMAC-SHA256 using the
// partner's webhook_secret and POST to either the session-level
// webhook_url override or the partner-level default_webhook_url. If
// the delivery fails we log it (console + audit) but don't retry —
// partners are expected to be resilient. V1.5 will add a
// webhook_deliveries table + retry cron.
//
// Signature: hex digest of HMAC-SHA256(webhook_secret, raw_body).
// Partner verifies by recomputing and constant-time comparing against
// the X-Proof-Signature header.

export type PartnerEventType =
  | 'session.submitted'   // user completed /submit; meme_id now exists
  | 'launch.funded'       // backing slots filled; about to launch
  | 'launch.live'         // mint created + live on a launchpad
  | 'launch.failed';      // backing expired without filling

export interface PartnerEvent {
  type: PartnerEventType;
  // Identifiers
  partner_id: string;
  session_id: string | null;
  meme_id: string;
  mint_address: string | null;
  // The partner_reference field they set at session create — lets them
  // correlate without holding state.
  partner_reference: string | null;
  // Snapshot of the meme at event time. Small + useful for the partner
  // to render without an extra round-trip.
  meme: {
    symbol: string;
    name: string;
    status: string;
    mint_address: string | null;
    launch_platform: string | null;
    pump_fun_url: string | null;
    created_at: string;
    launched_at: string | null;
  };
  // Event metadata
  occurred_at: string;
}

// Fire a webhook for a partner event. Resolves the partner + session,
// determines the URL, signs, POSTs, logs the outcome. Never throws —
// failures are logged but don't bubble up to the caller (the caller
// is in the middle of an important flow like "meme just submitted"
// and should not be derailed by a webhook hiccup).
export async function firePartnerEvent(
  supabase: SupabaseClient,
  args: {
    type: PartnerEventType;
    meme_id: string;
    // Optional — if we already have it we save a fetch. Otherwise
    // resolved from the meme row.
    partner_id?: string;
    partner_session_id?: string | null;
  },
): Promise<void> {
  try {
    // ── Pull the meme + partner + session in one fetch each ─────────
    const { data: meme } = await supabase
      .from('memes')
      .select('id, symbol, name, status, mint_address, launch_platform, pump_fun_url, created_at, launched_at, partner_id, partner_session_id')
      .eq('id', args.meme_id)
      .single();
    if (!meme) return console.warn(`[partnerWebhook] meme ${args.meme_id} not found, skipping ${args.type}`);

    const partnerId = args.partner_id ?? meme.partner_id;
    if (!partnerId) return; // not a partner-attributed meme, nothing to fire

    const { data: partner } = await supabase
      .from('partners')
      .select('id, webhook_secret, default_webhook_url, enabled')
      .eq('id', partnerId)
      .maybeSingle();
    if (!partner || !partner.enabled) return;

    const sessionId = args.partner_session_id ?? meme.partner_session_id;
    let sessionWebhookUrl: string | null = null;
    let partnerReference: string | null = null;
    if (sessionId) {
      const { data: session } = await supabase
        .from('partner_sessions')
        .select('webhook_url, partner_reference')
        .eq('id', sessionId)
        .maybeSingle();
      sessionWebhookUrl = session?.webhook_url ?? null;
      partnerReference = session?.partner_reference ?? null;
    }

    const url = sessionWebhookUrl || partner.default_webhook_url;
    if (!url) {
      // No webhook configured — silently skip. Many partners poll
      // /api/v1/partners/sessions/{id} instead of subscribing.
      return;
    }

    // ── Build, sign, POST ────────────────────────────────────────────
    const event: PartnerEvent = {
      type: args.type,
      partner_id: partner.id,
      session_id: sessionId ?? null,
      meme_id: meme.id,
      mint_address: meme.mint_address ?? null,
      partner_reference: partnerReference,
      meme: {
        symbol: meme.symbol,
        name: meme.name,
        status: meme.status,
        mint_address: meme.mint_address ?? null,
        launch_platform: meme.launch_platform ?? null,
        pump_fun_url: meme.pump_fun_url ?? null,
        created_at: meme.created_at,
        launched_at: meme.launched_at ?? null,
      },
      occurred_at: new Date().toISOString(),
    };

    const body = JSON.stringify(event);
    const signature = crypto
      .createHmac('sha256', partner.webhook_secret)
      .update(body)
      .digest('hex');

    // Best-effort POST. 10s timeout. We don't await this so the caller
    // (which is mid-request) returns to the user instantly; webhook
    // delivery happens in the background.
    deliverWebhook(url, body, signature, args.type, partner.id).catch((e) => {
      console.warn(`[partnerWebhook] delivery threw for ${partner.id}:`, e?.message ?? e);
    });
  } catch (e) {
    console.error(`[partnerWebhook] firePartnerEvent failed for ${args.type}:`, e instanceof Error ? e.message : e);
  }
}

async function deliverWebhook(
  url: string,
  body: string,
  signature: string,
  eventType: PartnerEventType,
  partnerId: string,
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Proof-Signature': signature,
        'X-Proof-Event': eventType,
        'User-Agent': 'prooflaunch-webhooks/1',
      },
      body,
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(`[partnerWebhook] ${eventType} → ${url} returned ${res.status} for partner ${partnerId}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}
