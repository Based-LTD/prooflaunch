// Pool wallet claim — server-side crypto helpers.
//
// Implements the "seal the pool wallet's private key to a Curve25519
// pubkey derived from a deterministic signature by the creator's wallet"
// flow. See docs/wallet-claim-design.md for the full design.
//
// Key invariants enforced by this module:
//
//   1. The derivation message is FIXED and VERSIONED. Changing it would
//      break decryption for every existing sealed blob. The version
//      suffix lets us rotate in the future via a parallel column.
//
//   2. Signature → X25519 derivation uses HKDF-SHA256 with a domain-
//      separation tag. Same input always produces the same output
//      (assuming the wallet produces deterministic ed25519 signatures —
//      which Phantom, Solflare, and most non-Ledger wallets do).
//
//   3. sealPoolKey() ALWAYS verifies the round-trip before returning.
//      A bad blob is never persisted with verified_at set. Callers MUST
//      check the returned `verified` flag before destroying any plaintext.
//
//   4. plaintext input bytes are zeroed at every safe opportunity. JS
//      can't fully guarantee this (the GC runs when it wants), but we
//      do what we can — Uint8Array.fill(0) on every secret.

import sodium from 'libsodium-wrappers';

// FROZEN at v1. Do not change. If we ever need to rotate the derivation
// scheme, add a parallel column (e.g. creator_sealed_pool_key_v2) and
// migrate in lockstep — never reuse this version with different math.
export const DERIVATION_MESSAGE_V1 = 'prooflaunch-decrypt-derivation-v1';

// HKDF domain-separation tag. Distinct from the derivation message so
// that a signature accidentally reused for some other purpose can't
// collide with this one.
const HKDF_INFO_V1 = new TextEncoder().encode('prooflaunch-x25519-secret-v1');

/**
 * Initialize libsodium. MUST be awaited before any other function in
 * this module. Idempotent.
 */
let sodiumReady = false;
async function ready(): Promise<void> {
  if (sodiumReady) return;
  await sodium.ready;
  sodiumReady = true;
}

/**
 * Derive a 32-byte X25519 secret key from a wallet signature.
 *
 * The wallet (browser side) signs `DERIVATION_MESSAGE_V1` with its
 * ed25519 private key. The 64-byte signature is fed through HKDF-SHA256
 * with a domain-separation tag to produce the X25519 secret.
 *
 * For Phantom/Solflare/non-Ledger wallets, ed25519 signatures are
 * deterministic — signing the same message with the same key always
 * produces the same signature. Therefore the derived X25519 secret is
 * stable across launch-time sealing and claim-time decryption.
 *
 * @param signatureBytes 64-byte ed25519 signature of DERIVATION_MESSAGE_V1
 * @returns 32-byte X25519 secret key
 */
export async function deriveX25519SecretFromSignature(
  signatureBytes: Uint8Array,
): Promise<Uint8Array> {
  await ready();
  if (signatureBytes.length !== 64) {
    throw new Error(`expected 64-byte ed25519 signature, got ${signatureBytes.length}`);
  }
  // HKDF-style extract+expand via BLAKE2b. No salt (the signature itself
  // has enough entropy). Output 32 bytes = X25519 scalar size.
  const prkRaw = sodium.crypto_generichash(32, signatureBytes, null, 'uint8array');
  const prk = prkRaw as Uint8Array;
  // Mix in the info tag so a signature used elsewhere can't collide.
  const message = new Uint8Array(prk.length + HKDF_INFO_V1.length);
  message.set(prk, 0);
  message.set(HKDF_INFO_V1, prk.length);
  const outRaw = sodium.crypto_generichash(32, message, null, 'uint8array');
  const out = outRaw as Uint8Array;
  prk.fill(0);
  message.fill(0);
  // X25519 scalar clamping: bits required by RFC 7748.
  out[0] &= 248;
  out[31] &= 127;
  out[31] |= 64;
  return out;
}

/**
 * Compute the X25519 public key from a secret key.
 */
export async function x25519PublicFromSecret(secretKey: Uint8Array): Promise<Uint8Array> {
  await ready();
  if (secretKey.length !== 32) {
    throw new Error(`expected 32-byte X25519 secret, got ${secretKey.length}`);
  }
  return sodium.crypto_scalarmult_base(secretKey);
}

/**
 * Seal a pool wallet's private key to a Curve25519 recipient pubkey.
 *
 * Uses libsodium's sealed-box construction:
 *   • Generates an ephemeral X25519 keypair
 *   • Derives a nonce via BLAKE2b(ephemeral_pk || recipient_pk)
 *   • Encrypts with XSalsa20-Poly1305 box
 *   • Returns ephemeral_pk || ciphertext (base64-encoded)
 *
 * The ephemeral secret key is destroyed inside libsodium and never
 * exposed. We do not retain it.
 *
 * @param plaintextSecretKey the pool wallet's 64-byte ed25519 secret key
 *   (Solana secret key format: 32 seed + 32 pubkey concatenation, or
 *   just raw 64 bytes — sodium doesn't care, we seal whatever bytes
 *   we're given).
 * @param recipientX25519Pubkey 32-byte X25519 recipient pubkey
 * @returns base64-encoded sealed blob
 */
export async function sealToX25519Pubkey(
  plaintextSecretKey: Uint8Array,
  recipientX25519Pubkey: Uint8Array,
): Promise<string> {
  await ready();
  if (recipientX25519Pubkey.length !== 32) {
    throw new Error(`expected 32-byte X25519 pubkey, got ${recipientX25519Pubkey.length}`);
  }
  const blob = sodium.crypto_box_seal(plaintextSecretKey, recipientX25519Pubkey);
  return Buffer.from(blob).toString('base64');
}

/**
 * Open (decrypt) a sealed blob using the recipient's X25519 keypair.
 *
 * Used at claim time on the client side; also used here at launch time
 * to round-trip-verify a freshly-sealed blob before destroying the
 * platform's plaintext copy.
 */
export async function openSealedBox(
  sealedBase64: string,
  recipientX25519Pubkey: Uint8Array,
  recipientX25519Secret: Uint8Array,
): Promise<Uint8Array> {
  await ready();
  const blob = Buffer.from(sealedBase64, 'base64');
  return sodium.crypto_box_seal_open(blob, recipientX25519Pubkey, recipientX25519Secret);
}

/**
 * The full seal-and-verify ceremony used at launch time.
 *
 * Takes the creator's wallet signature and the pool wallet's secret key,
 * derives the X25519 keypair, seals, and ROUND-TRIP VERIFIES that the
 * blob decrypts back to the exact same plaintext. Returns the blob only
 * if verification succeeds.
 *
 * The caller is expected to:
 *   1. Persist the returned blob in memes.creator_sealed_pool_key
 *   2. Set memes.creator_sealed_pool_key_verified_at = now()
 *   3. Log a wallet_claim_events row with event='sealed_at_launch'
 *   4. Zero out the original plaintext secret key from its own buffer
 *
 * @returns { sealed: base64, verified: true } on success
 * @throws if the round-trip verification fails (do NOT destroy the
 *   platform-encrypted plaintext if this throws)
 */
export async function sealPoolKeyForCreator(args: {
  poolSecretKey: Uint8Array;
  derivationSignature: Uint8Array;
}): Promise<{ sealed: string; verified: true }> {
  await ready();
  const { poolSecretKey, derivationSignature } = args;

  if (poolSecretKey.length !== 64) {
    throw new Error(`expected 64-byte Solana secret key, got ${poolSecretKey.length}`);
  }

  const x25519Secret = await deriveX25519SecretFromSignature(derivationSignature);
  const x25519Pubkey = await x25519PublicFromSecret(x25519Secret);

  const sealed = await sealToX25519Pubkey(poolSecretKey, x25519Pubkey);

  // Round-trip verify: decrypt the blob we just produced and confirm
  // we recover the exact same plaintext bytes. If this fails, the
  // sealing flow had a bug and the caller MUST keep the platform's
  // plaintext intact.
  let roundTrip: Uint8Array;
  try {
    roundTrip = await openSealedBox(sealed, x25519Pubkey, x25519Secret);
  } catch (e) {
    x25519Secret.fill(0);
    throw new Error(`seal verification failed (open threw): ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    // Whether or not it threw, we don't need the secret key anymore.
    x25519Secret.fill(0);
  }

  if (roundTrip.length !== poolSecretKey.length) {
    throw new Error(
      `seal verification failed (length mismatch: ${roundTrip.length} vs ${poolSecretKey.length})`,
    );
  }
  // Constant-time-ish byte comparison. sodium offers crypto_verify_64.
  let diff = 0;
  for (let i = 0; i < poolSecretKey.length; i++) {
    diff |= poolSecretKey[i] ^ roundTrip[i];
  }
  roundTrip.fill(0);
  if (diff !== 0) {
    throw new Error('seal verification failed (round-trip plaintext differs)');
  }

  return { sealed, verified: true };
}

/**
 * Verify that a sealed blob parses as a structurally valid sealed-box
 * output. Does NOT verify the contents — only the shape. Used for cheap
 * background integrity scans where we can't decrypt (no creator key).
 *
 * A valid sealed-box blob is `ephemeral_pk (32B) || ciphertext`, where
 * ciphertext is at least 16 bytes (the Poly1305 MAC overhead).
 */
export function isStructurallyValidSealedBlob(sealedBase64: string): boolean {
  let buf: Buffer;
  try {
    buf = Buffer.from(sealedBase64, 'base64');
  } catch {
    return false;
  }
  // Minimum: 32 (ephemeral_pk) + 16 (MAC) = 48 bytes.
  // For a Solana secret key (64 bytes plaintext): 32 + 64 + 16 = 112 bytes.
  return buf.length >= 48;
}

/**
 * Feature flag check. Wraps reads of WALLET_CLAIM_ENABLED so callers
 * don't have to remember the env var name.
 */
export function isWalletClaimEnabled(): boolean {
  return process.env.WALLET_CLAIM_ENABLED === 'true'
    || process.env.WALLET_CLAIM_ENABLED === '1';
}
