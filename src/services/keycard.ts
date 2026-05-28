// Keycard (https://keycardsol.xyz) — wallet-gated content/access platform.
//
// We use ONE Keycard primitive: per-meme "backer lounge" gates. When a
// meme goes live, /api/keycard/sync creates a gate keyed to "wallet holds
// > 0 of meme.mint_address" so every backer (and every future holder)
// gets a private chat / updates page without us building auth, hosting,
// or moderation.
//
// All endpoints documented at keycardsol.xyz/docs as of Phase 4 design.
// No published SDK yet — we hit REST directly with `KEYCARD_API_KEY` as
// the server-to-server auth header.
//
// Everything in this module is a no-op when KEYCARD_API_KEY is unset
// (returns { ok: false, skipped: 'no api key' }), so deploying this code
// without the key is safe.

const KEYCARD_BASE = process.env.KEYCARD_API_BASE || 'https://keycardsol.xyz/v1';
const KEYCARD_API_KEY = process.env.KEYCARD_API_KEY;

export interface KeycardGate {
  gateId: string;
  url: string;
  rule: KeycardRule;
}

export type KeycardRule =
  | { type: 'spl-balance'; mint: string; min: number }
  | { type: 'nft-collection'; collection: string }
  | { type: 'allowlist'; wallets: string[] };

export interface KeycardCreateOptions {
  title: string;
  description?: string;
  rule: KeycardRule;
  contentUrl?: string;          // optional — gate redirects here on success
  telegramGroupId?: string;     // optional — Sentinel bot wires TG access
}

export interface CreateGateResult {
  ok: boolean;
  skipped?: string;
  gate?: KeycardGate;
  error?: string;
}

/**
 * Create a Keycard gate. POST /v1/gates accepts multipart/form-data
 * (NOT JSON) — encrypted gate creation pattern. Returns { ok: false,
 * skipped } when the API key is unset (deploy-safe) or { ok: false,
 * error } on actual failure.
 *
 * Exact field names are pinned to Keycard's docs; the `rule` object is
 * serialized as a JSON string in a single form field per their pattern
 * for compound metadata.
 */
export async function createGate(opts: KeycardCreateOptions): Promise<CreateGateResult> {
  if (!KEYCARD_API_KEY) return { ok: false, skipped: 'KEYCARD_API_KEY not set' };

  try {
    const form = new FormData();
    form.append('title', opts.title);
    if (opts.description) form.append('description', opts.description);
    form.append('rule', JSON.stringify(opts.rule));
    if (opts.contentUrl) form.append('contentUrl', opts.contentUrl);
    if (opts.telegramGroupId) form.append('telegramGroupId', opts.telegramGroupId);

    const res = await fetch(`${KEYCARD_BASE}/gates`, {
      method: 'POST',
      headers: {
        // Do NOT set Content-Type for FormData — fetch auto-sets it
        // with the correct multipart boundary.
        'Authorization': `Bearer ${KEYCARD_API_KEY}`,
      },
      body: form,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, error: `keycard ${res.status}: ${body.slice(0, 200)}` };
    }
    const j = await res.json();
    // Response shape pinned against Keycard's verify-response pattern
    // (gateId + URL). Defensive on field names in case the gate-create
    // endpoint returns slightly different keys than verify does.
    const gateId = j.gateId ?? j.id;
    const url = j.url ?? j.gateUrl ?? (gateId ? `https://keycardsol.xyz/g/${gateId}` : null);
    if (!gateId || !url) {
      return { ok: false, error: `keycard response missing gateId/url: ${JSON.stringify(j).slice(0, 200)}` };
    }
    return { ok: true, gate: { gateId, url, rule: opts.rule } };
  } catch (e) {
    return { ok: false, error: `keycard fetch: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export interface VerifyResult {
  access: boolean;
  reason?: string;
  matched?: string[];      // e.g. ['spl-balance']
  expiresAt?: string;
  contentUrl?: string;     // e.g. '/content/<gateId>'
}

/**
 * Server-side verify (e.g. to deep-link backers straight past the auth
 * page from our own UI). Not used in the MVP flow — backers click the
 * gate URL and Keycard handles sign + verify in-place — but exposed
 * here for the Phase 4.1 PROOF-staker-perks flow.
 */
export async function verifyAccess(
  gateId: string,
  wallet: string,
  message: string,
  signatureB58: string,
): Promise<VerifyResult> {
  if (!KEYCARD_API_KEY) return { access: false, reason: 'KEYCARD_API_KEY not set' };
  try {
    const res = await fetch(`${KEYCARD_BASE}/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${KEYCARD_API_KEY}`,
      },
      body: JSON.stringify({ gateId, wallet, message, signature: signatureB58 }),
    });
    if (!res.ok) return { access: false, reason: `keycard ${res.status}` };
    const j = await res.json();
    return {
      access: !!j.access,
      reason: j.reason,
      matched: Array.isArray(j.matched) ? j.matched : undefined,
      expiresAt: j.expiresAt,
      contentUrl: j.contentUrl,
    };
  } catch (e) {
    return { access: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

export function keycardConfigured(): boolean {
  return !!KEYCARD_API_KEY;
}
