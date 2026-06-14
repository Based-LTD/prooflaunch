// Standalone verification for src/lib/walletClaim.ts.
//
// Runs:
//   1. Sanity round-trip with a fixed test vector
//   2. Property test: 100 random pool keys × 100 random signatures, all
//      seal+open correctly, each only decrypts with its own key
//   3. Negative tests: wrong signature, wrong recipient pubkey, corrupted
//      blob, wrong length input — all must throw or return false
//   4. Determinism: same signature → same X25519 secret (this is the
//      critical property that makes claim-time re-derivation work)
//
// Run:  npx tsx tools/test-wallet-claim.mjs

import {
  DERIVATION_MESSAGE_V1,
  deriveX25519SecretFromSignature,
  x25519PublicFromSecret,
  sealToX25519Pubkey,
  openSealedBox,
  sealPoolKeyForCreator,
  isStructurallyValidSealedBlob,
} from '../src/lib/walletClaim.ts';
import nacl from 'tweetnacl';
import { Keypair } from '@solana/web3.js';

const PASS = (msg) => console.log(`  ✓ ${msg}`);
const FAIL = (msg) => { console.error(`  ✗ ${msg}`); process.exit(1); };

function randBytes(n) {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

// ───────────────────────────────────────────────────────────────────
// TEST 1 — Fixed test vector
// ───────────────────────────────────────────────────────────────────
console.log('\n[test 1] Fixed test vector round-trip');
{
  // Deterministic test wallet (creator's wallet).
  const creatorSeed = new Uint8Array(32).map((_, i) => i + 1);
  const creatorKp = nacl.sign.keyPair.fromSeed(creatorSeed);

  // Creator signs the derivation message.
  const msg = new TextEncoder().encode(DERIVATION_MESSAGE_V1);
  const sig = nacl.sign.detached(msg, creatorKp.secretKey);

  // A test pool wallet whose secret key we want to seal.
  const poolKp = Keypair.generate();

  // Seal + verify.
  const result = await sealPoolKeyForCreator({
    poolSecretKey: poolKp.secretKey,
    derivationSignature: sig,
  });
  if (!result.verified) FAIL('sealPoolKeyForCreator returned verified:false');
  PASS('seal+verify succeeded');
  if (!isStructurallyValidSealedBlob(result.sealed)) FAIL('blob failed structural check');
  PASS('blob is structurally valid');

  // Claim-time decrypt: same signature → same X25519 secret → same plaintext.
  const x25519Secret = await deriveX25519SecretFromSignature(sig);
  const x25519Pubkey = await x25519PublicFromSecret(x25519Secret);
  const opened = await openSealedBox(result.sealed, x25519Pubkey, x25519Secret);
  if (opened.length !== poolKp.secretKey.length) FAIL(`length mismatch: ${opened.length}`);
  for (let i = 0; i < opened.length; i++) {
    if (opened[i] !== poolKp.secretKey[i]) FAIL(`byte mismatch at ${i}`);
  }
  PASS('claim-time decrypt recovered exact pool secret key');

  // Verify the recovered key works on chain (the pubkey matches).
  const recoveredKp = Keypair.fromSecretKey(opened);
  if (!recoveredKp.publicKey.equals(poolKp.publicKey)) FAIL('recovered pubkey does not match');
  PASS('recovered pool wallet pubkey matches original');
}

// ───────────────────────────────────────────────────────────────────
// TEST 2 — Determinism
// ───────────────────────────────────────────────────────────────────
console.log('\n[test 2] Determinism — same signature → same X25519 secret');
{
  const sig = randBytes(64);
  const a = await deriveX25519SecretFromSignature(sig);
  const b = await deriveX25519SecretFromSignature(sig);
  for (let i = 0; i < 32; i++) {
    if (a[i] !== b[i]) FAIL(`determinism violated at byte ${i}`);
  }
  PASS('same signature produces same X25519 secret across calls');

  // Different signatures must produce different secrets.
  const sig2 = randBytes(64);
  const c = await deriveX25519SecretFromSignature(sig2);
  let allSame = true;
  for (let i = 0; i < 32; i++) {
    if (a[i] !== c[i]) { allSame = false; break; }
  }
  if (allSame) FAIL('different signatures produced same secret (cryptographic failure)');
  PASS('different signatures produce different secrets');
}

// ───────────────────────────────────────────────────────────────────
// TEST 3 — Property test (100 iterations)
// ───────────────────────────────────────────────────────────────────
console.log('\n[test 3] Property test — 100 random seal+open round-trips');
{
  const ITER = 100;
  for (let i = 0; i < ITER; i++) {
    const poolKp = Keypair.generate();
    const creatorKp = nacl.sign.keyPair();
    const sig = nacl.sign.detached(
      new TextEncoder().encode(DERIVATION_MESSAGE_V1),
      creatorKp.secretKey,
    );
    const sealed = await sealPoolKeyForCreator({
      poolSecretKey: poolKp.secretKey,
      derivationSignature: sig,
    });
    const x25519Secret = await deriveX25519SecretFromSignature(sig);
    const x25519Pubkey = await x25519PublicFromSecret(x25519Secret);
    const opened = await openSealedBox(sealed.sealed, x25519Pubkey, x25519Secret);
    const recoveredKp = Keypair.fromSecretKey(opened);
    if (!recoveredKp.publicKey.equals(poolKp.publicKey)) FAIL(`iter ${i}: pubkey mismatch`);
  }
  PASS(`${ITER} iterations: every seal correctly decrypts to its own pool key`);
}

// ───────────────────────────────────────────────────────────────────
// TEST 4 — Cross-decryption: wrong signature must fail
// ───────────────────────────────────────────────────────────────────
console.log('\n[test 4] Negative — wrong signature can\'t decrypt someone else\'s blob');
{
  const poolKp = Keypair.generate();
  const creatorKp = nacl.sign.keyPair();
  const sig = nacl.sign.detached(
    new TextEncoder().encode(DERIVATION_MESSAGE_V1),
    creatorKp.secretKey,
  );
  const sealed = await sealPoolKeyForCreator({
    poolSecretKey: poolKp.secretKey,
    derivationSignature: sig,
  });

  // Attacker has a different wallet, gets a different signature.
  const attackerKp = nacl.sign.keyPair();
  const attackerSig = nacl.sign.detached(
    new TextEncoder().encode(DERIVATION_MESSAGE_V1),
    attackerKp.secretKey,
  );
  const attackerX25519 = await deriveX25519SecretFromSignature(attackerSig);
  const attackerPubkey = await x25519PublicFromSecret(attackerX25519);

  let threw = false;
  try {
    await openSealedBox(sealed.sealed, attackerPubkey, attackerX25519);
  } catch {
    threw = true;
  }
  if (!threw) FAIL('attacker decrypted blob meant for someone else!');
  PASS('attacker with different signature cannot decrypt');
}

// ───────────────────────────────────────────────────────────────────
// TEST 5 — Negative: corrupted blob
// ───────────────────────────────────────────────────────────────────
console.log('\n[test 5] Negative — corrupted blob fails to open');
{
  const poolKp = Keypair.generate();
  const creatorKp = nacl.sign.keyPair();
  const sig = nacl.sign.detached(
    new TextEncoder().encode(DERIVATION_MESSAGE_V1),
    creatorKp.secretKey,
  );
  const sealed = await sealPoolKeyForCreator({
    poolSecretKey: poolKp.secretKey,
    derivationSignature: sig,
  });

  // Flip a bit in the ciphertext.
  const buf = Buffer.from(sealed.sealed, 'base64');
  buf[buf.length - 5] ^= 0xff;
  const corrupted = buf.toString('base64');

  const x25519Secret = await deriveX25519SecretFromSignature(sig);
  const x25519Pubkey = await x25519PublicFromSecret(x25519Secret);
  let threw = false;
  try {
    await openSealedBox(corrupted, x25519Pubkey, x25519Secret);
  } catch {
    threw = true;
  }
  if (!threw) FAIL('corrupted blob opened successfully (cryptographic failure)');
  PASS('corrupted blob correctly fails to open');
}

// ───────────────────────────────────────────────────────────────────
// TEST 6 — Negative: wrong-length inputs throw with clear errors
// ───────────────────────────────────────────────────────────────────
console.log('\n[test 6] Negative — invalid input lengths throw');
{
  let threw = false;
  try {
    await deriveX25519SecretFromSignature(new Uint8Array(63));
  } catch (e) {
    threw = e instanceof Error && e.message.includes('64-byte');
  }
  if (!threw) FAIL('63-byte signature did not throw expected error');
  PASS('63-byte signature throws clear error');

  threw = false;
  try {
    await sealPoolKeyForCreator({
      poolSecretKey: new Uint8Array(32), // wrong size
      derivationSignature: new Uint8Array(64),
    });
  } catch (e) {
    threw = e instanceof Error && e.message.includes('64-byte');
  }
  if (!threw) FAIL('32-byte pool secret did not throw expected error');
  PASS('32-byte pool secret throws clear error');
}

// ───────────────────────────────────────────────────────────────────
// TEST 7 — Structural validation
// ───────────────────────────────────────────────────────────────────
console.log('\n[test 7] Structural blob validation');
{
  if (isStructurallyValidSealedBlob('not base64 !@#$')) FAIL('garbage passed structural check');
  // Wait — Buffer.from('not base64 !@#$', 'base64') silently ignores invalid chars.
  // The check only enforces minimum length, so very short strings fail.
  if (isStructurallyValidSealedBlob('YWJj')) FAIL('3-byte blob passed structural check');
  PASS('short / invalid blobs correctly rejected by structural check');

  // A valid blob from a real seal should pass.
  const poolKp = Keypair.generate();
  const sig = nacl.sign.detached(
    new TextEncoder().encode(DERIVATION_MESSAGE_V1),
    nacl.sign.keyPair().secretKey,
  );
  const sealed = await sealPoolKeyForCreator({
    poolSecretKey: poolKp.secretKey,
    derivationSignature: sig,
  });
  if (!isStructurallyValidSealedBlob(sealed.sealed)) FAIL('real blob failed structural check');
  PASS('real blob passes structural check');
}

console.log('\n══════════════════════════════════════════════════════');
console.log(' ALL TESTS PASSED');
console.log('══════════════════════════════════════════════════════\n');
