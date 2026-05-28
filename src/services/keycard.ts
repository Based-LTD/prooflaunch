// Keycard (https://keycardsol.xyz) — wallet-gated content/access platform.
//
// We use ONE Keycard primitive: per-meme "backer lounge" gates. When a
// meme goes live, /api/keycard/sync creates a gate scoped to >0 balance
// of meme.mint_address so every backer (and every future holder) gets a
// private welcome / updates page without us building auth, hosting, or
// moderation.
//
// AUTH FLOW (Sign-In-With-Solana style, reverse-engineered from the
// keycardsol.xyz/create form's network capture):
//
//   1) POST /v1/challenges with { purpose: 'admin', gateId: 'new',
//      wallet: <ownerPubkey>, action: 'create-gate' } → returns a
//      challenge UUID.
//   2) Build adminMessage (structured plain text containing the
//      challenge, wallet, ISO timestamp).
//   3) Sign adminMessage with ownerWallet's ed25519 secret key.
//   4) POST /v1/gates (multipart) with all gate fields + ownerWallet
//      + adminMessage + adminSignature + adminChallengeId.
//
// We use the platform escrow keypair as ownerWallet for every gate
// Proof Launch creates. That makes Proof Launch the admin for every
// backer lounge (we can update content via PATCH later). No per-user
// wallet interaction required.
//
// Response: { openUrl: '/open/<id>', adminUrl: '/gates/<id>?admin=<key>', ... }

import { Keypair } from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

const KEYCARD_BASE = process.env.KEYCARD_API_BASE || 'https://keycardsol.xyz';

function getOwnerKeypair(): Keypair {
  const k = process.env.ESCROW_WALLET_PRIVATE_KEY;
  if (!k) throw new Error('ESCROW_WALLET_PRIVATE_KEY not set — required for Keycard gate signing');
  return Keypair.fromSecretKey(bs58.decode(k));
}

export interface KeycardGate {
  gateId: string;
  openUrl: string;            // public — what backers click
  adminUrl: string;           // secret — used for PATCH/update later
}

export interface KeycardCreateOptions {
  name: string;                // gate title (Keycard's field is "name")
  description: string;
  mint: string;                // SPL token mint
  symbol: string;              // e.g. "$DOGE" (required by Keycard)
  minAmount: number;           // min balance threshold (1 = "any holder")
  decimals: number;            // mint's decimals (required by Keycard)
  getAccessUrl: string;        // redirect for users who DON'T have access
  fileContent: string;         // text content (welcome note, updates, etc.)
  fileName?: string;
  fileMime?: string;
}

export interface CreateGateResult {
  ok: boolean;
  gate?: KeycardGate;
  error?: string;
}

interface ChallengeResponse {
  challengeId: string;
  message: string;       // exact text to sign — server-authoritative, no client construction
  issuedAt: string;
  expiresAt: string;
}

async function requestChallenge(
  walletPubkey: string,
  action: 'create-gate' | 'update-gate',
  gateId: string,
): Promise<ChallengeResponse> {
  const res = await fetch(`${KEYCARD_BASE}/v1/challenges`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      purpose: 'admin',
      gateId,
      wallet: walletPubkey,
      action,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`/v1/challenges ${res.status}: ${body.slice(0, 200)}`);
  }
  const j = await res.json();
  if (!j.challengeId || !j.message) {
    throw new Error(`/v1/challenges response missing fields: ${JSON.stringify(j).slice(0, 200)}`);
  }
  return j as ChallengeResponse;
}

function signMessage(message: string, secretKey: Uint8Array): string {
  const msgBytes = new TextEncoder().encode(message);
  const sig = nacl.sign.detached(msgBytes, secretKey);
  return bs58.encode(sig);
}

/**
 * Create a Keycard SPL-token gate signed by the platform escrow wallet.
 */
export async function createGate(opts: KeycardCreateOptions): Promise<CreateGateResult> {
  try {
    const owner = getOwnerKeypair();
    const ownerPubkey = owner.publicKey.toBase58();

    // Step 1 — challenge. Server returns the exact message we must sign.
    const ch = await requestChallenge(ownerPubkey, 'create-gate', 'new');
    const adminSignature = signMessage(ch.message, owner.secretKey);

    // Step 3 — multipart POST /v1/gates with full field set
    const form = new FormData();
    form.append('name', opts.name);
    form.append('description', opts.description);
    form.append('gateType', 'spl');
    form.append('mint', opts.mint);
    form.append('symbol', opts.symbol);
    form.append('minAmount', String(opts.minAmount));
    form.append('decimals', String(opts.decimals));
    form.append('collectionAddress', '');
    form.append('walletList', '');
    form.append('getAccessUrl', opts.getAccessUrl);
    form.append('ownerWallet', ownerPubkey);
    form.append('adminMessage', ch.message);
    form.append('adminSignature', adminSignature);
    form.append('adminChallengeId', ch.challengeId);

    const fileName = opts.fileName ?? 'welcome.md';
    const fileMime = opts.fileMime ?? 'text/markdown';
    const blob = new Blob([opts.fileContent], { type: fileMime });
    form.append('file', blob, fileName);

    const res = await fetch(`${KEYCARD_BASE}/v1/gates`, {
      method: 'POST',
      body: form,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, error: `keycard ${res.status}: ${body.slice(0, 200)}` };
    }
    const j = await res.json();
    const openPath = j.openUrl || j.open_url || null;
    const adminPath = j.adminUrl || j.admin_url || null;
    if (!openPath || !adminPath) {
      return { ok: false, error: `keycard response missing openUrl/adminUrl: ${JSON.stringify(j).slice(0, 200)}` };
    }
    const openUrl = openPath.startsWith('http') ? openPath : `${KEYCARD_BASE}${openPath}`;
    const adminUrl = adminPath.startsWith('http') ? adminPath : `${KEYCARD_BASE}${adminPath}`;
    const idMatch = openUrl.match(/\/open\/([a-zA-Z0-9_-]+)/);
    const gateId = idMatch ? idMatch[1] : openPath;
    return { ok: true, gate: { gateId, openUrl, adminUrl } };
  } catch (e) {
    return { ok: false, error: `keycard fetch: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export interface UpdateGateOptions {
  fileContent: string;       // text or binary as string (binary callers pass base64 via Buffer)
  fileName: string;
  fileMime?: string;
  // Optional metadata changes — passed only if provided.
  name?: string;
  description?: string;
  getAccessUrl?: string;
}

export interface UpdateGateResult {
  ok: boolean;
  error?: string;
}

/**
 * Replace a gate's content + optional metadata. Uses the same SIWS
 * challenge → sign → PATCH flow as create, but with action='update-gate'
 * and the existing gateId.
 *
 * Requires the platform escrow keypair (the original ownerWallet from
 * createGate) to sign. No per-creator wallet interaction — Proof Launch
 * acts as the gate admin on behalf of every creator.
 */
export async function updateGateContent(
  gateId: string,
  opts: UpdateGateOptions,
  fileBlob?: Blob,
): Promise<UpdateGateResult> {
  try {
    const owner = getOwnerKeypair();
    const ownerPubkey = owner.publicKey.toBase58();

    const ch = await requestChallenge(ownerPubkey, 'update-gate', gateId);
    const adminSignature = signMessage(ch.message, owner.secretKey);

    const form = new FormData();
    if (opts.name) form.append('name', opts.name);
    if (opts.description) form.append('description', opts.description);
    if (opts.getAccessUrl) form.append('getAccessUrl', opts.getAccessUrl);

    const blob = fileBlob ?? new Blob([opts.fileContent], { type: opts.fileMime ?? 'text/markdown' });
    form.append('file', blob, opts.fileName);

    form.append('ownerWallet', ownerPubkey);
    form.append('adminMessage', ch.message);
    form.append('adminSignature', adminSignature);
    form.append('adminChallengeId', ch.challengeId);

    const res = await fetch(`${KEYCARD_BASE}/v1/gates/${gateId}`, {
      method: 'PATCH',
      body: form,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, error: `keycard PATCH ${res.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `keycard update: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export interface VerifyResult {
  access: boolean;
  reason?: string;
  matched?: string[];
  expiresAt?: string;
  contentUrl?: string;
}

/**
 * Server-side verify. Not used in the MVP flow — backers click the
 * openUrl directly and Keycard handles sign + verify in-place — but
 * exposed for any future "deep link past the gate" flow.
 */
export async function verifyAccess(
  gateId: string,
  wallet: string,
  message: string,
  signatureB58: string,
): Promise<VerifyResult> {
  try {
    const res = await fetch(`${KEYCARD_BASE}/v1/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
