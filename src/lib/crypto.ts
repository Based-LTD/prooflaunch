import crypto from 'crypto';
import bs58 from 'bs58';

// Derive a 32-byte AES key from the BURNER_ENCRYPTION_KEY env var
function getEncryptionKey(): Buffer {
  const key = process.env.BURNER_ENCRYPTION_KEY;
  if (!key) {
    throw new Error('BURNER_ENCRYPTION_KEY environment variable is required');
  }
  return crypto.createHash('sha256').update(key).digest();
}

// Encrypt a burner wallet private key with AES-256-GCM
// Returns format: "aes:<iv>:<authTag>:<ciphertext>" (all base64)
export function encryptPrivateKey(privateKey: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(privateKey, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `aes:${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

// Decrypt a burner wallet private key
// Handles both legacy "enc:<base64>" format and new "aes:<iv>:<tag>:<ct>" format
export function decryptPrivateKey(encrypted: string): string {
  // Legacy format: plain base64 with "enc:" prefix (no real encryption)
  if (encrypted.startsWith('enc:')) {
    return Buffer.from(encrypted.slice(4), 'base64').toString('utf-8');
  }

  // New format: AES-256-GCM
  if (encrypted.startsWith('aes:')) {
    const key = getEncryptionKey();
    const parts = encrypted.split(':');
    if (parts.length !== 4) throw new Error('Invalid encrypted key format');
    const iv = Buffer.from(parts[1], 'base64');
    const authTag = Buffer.from(parts[2], 'base64');
    const ciphertext = Buffer.from(parts[3], 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }

  throw new Error('Unknown encryption format');
}

// Auth messages older than this are rejected to prevent replay
export const MAX_SIG_AGE_MS = 5 * 60 * 1000; // 5 minutes

// Verify a signed auth message with timestamp replay protection.
// Expected message format: "<expectedPrefix>:<unix_ms_timestamp>"
// Example expectedPrefix: "withdraw:abc123:wallet_pubkey"
//
// Checks (in order):
//   1. Message starts with the expected prefix
//   2. Timestamp is a valid integer within the allowed age window
//   3. Signature is valid for that exact message from that wallet
export function verifySignedAuthMessage(
  expectedPrefix: string,
  message: string,
  signatureB58: string,
  walletAddress: string
): { ok: true } | { ok: false; error: string; status: number } {
  if (!message.startsWith(`${expectedPrefix}:`)) {
    return { ok: false, error: 'Invalid signature message', status: 401 };
  }
  const timestampStr = message.slice(expectedPrefix.length + 1);
  const ts = parseInt(timestampStr, 10);
  if (!Number.isFinite(ts) || ts <= 0) {
    return { ok: false, error: 'Invalid signature timestamp', status: 401 };
  }
  const age = Math.abs(Date.now() - ts);
  if (age > MAX_SIG_AGE_MS) {
    return { ok: false, error: 'Signature expired — please retry', status: 401 };
  }
  if (!verifyWalletSignature(message, signatureB58, walletAddress)) {
    return { ok: false, error: 'Invalid wallet signature', status: 401 };
  }
  return { ok: true };
}

// Verify an Ed25519 wallet signature (from Phantom's signMessage)
// message: the original string that was signed
// signatureB58: the signature encoded in base58
// walletAddress: the Solana wallet public key (base58)
export function verifyWalletSignature(message: string, signatureB58: string, walletAddress: string): boolean {
  try {
    const messageBytes = new TextEncoder().encode(message);
    const signatureBytes = bs58.decode(signatureB58);
    const publicKeyBytes = bs58.decode(walletAddress);

    // Build Ed25519 public key in DER/SPKI format for Node.js crypto
    const derPrefix = Buffer.from('302a300506032b6570032100', 'hex');
    const derKey = Buffer.concat([derPrefix, Buffer.from(publicKeyBytes)]);

    const key = crypto.createPublicKey({
      key: derKey,
      format: 'der',
      type: 'spki',
    });

    return crypto.verify(null, Buffer.from(messageBytes), key, Buffer.from(signatureBytes));
  } catch {
    return false;
  }
}
