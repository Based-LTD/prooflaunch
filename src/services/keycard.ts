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
  challenge?: string;
  id?: string;
  challengeId?: string;
}

async function requestChallenge(walletPubkey: string): Promise<string> {
  const res = await fetch(`${KEYCARD_BASE}/v1/challenges`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      purpose: 'admin',
      gateId: 'new',
      wallet: walletPubkey,
      action: 'create-gate',
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`/v1/challenges ${res.status}: ${body.slice(0, 200)}`);
  }
  const j: ChallengeResponse = await res.json();
  const id = j.challengeId || j.challenge || j.id;
  if (!id) throw new Error(`/v1/challenges response missing challenge id: ${JSON.stringify(j).slice(0, 200)}`);
  return id;
}

function buildAdminMessage(wallet: string, challengeId: string): string {
  // EXACT format from network capture — line order and spacing matter
  // because the server signature-verifies the literal string.
  return [
    'KEYCARD admin action',
    'Version: 2',
    'Domain: keycardsol.xyz',
    'Action: create-gate',
    'Gate: new',
    `Wallet: ${wallet}`,
    `Issued At: ${new Date().toISOString()}`,
    `Challenge: ${challengeId}`,
  ].join('\n');
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

    // Step 1 — challenge
    const challengeId = await requestChallenge(ownerPubkey);

    // Step 2 — sign admin message
    const adminMessage = buildAdminMessage(ownerPubkey, challengeId);
    const adminSignature = signMessage(adminMessage, owner.secretKey);

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
    form.append('adminMessage', adminMessage);
    form.append('adminSignature', adminSignature);
    form.append('adminChallengeId', challengeId);

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
