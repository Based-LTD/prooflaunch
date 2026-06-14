# Pool Wallet Claim — Design Doc

**Status:** Draft. Not implemented yet. No code is to be written until this doc is reviewed and approved.

**Goal:** Allow a creator to take full custody of their meme's `pool_wallet` after launch, with these properties:

1. **Bulletproof — no key loss, ever.** Every encryption is round-trip verified before any plaintext is destroyed. The platform-encrypted backup is kept until the creator has explicitly confirmed claim.
2. **Tamper-resistant — platform cannot interfere after launch.** Once the launch tx confirms and verification passes, the platform deletes its plaintext copy from memory. The key is only recoverable via the creator's wallet.
3. **Compatible with every Solana wallet adapter today** (Phantom, Solflare, Backpack, Ledger via Phantom, etc.) — no seed-phrase paste, no exotic dependencies.
4. **Re-claimable** — if the creator loses the cleartext they extracted, they can re-run the decrypt flow against the same on-chain artifact.
5. **Operationally safe** — DB migrations, replication, or accidental deletes cannot orphan a key. Schema enforces immutability.

---

## 1. Threat model

| Adversary | Capability | Mitigation |
|---|---|---|
| Platform operator (post-launch) | Read/write entire prod DB + server | After launch verification, the platform-encrypted plaintext is destroyed. Sealed blob can be read but not decrypted without creator's wallet. |
| External attacker w/ DB dump (post-launch) | All sealed blobs | Each blob is encrypted to a different creator's pubkey via libsodium sealed-box — recovering one doesn't help with another. |
| Malicious code in our app post-claim | Could call old code path | Once `pool_wallet_claimed = true`, ALL platform code paths that touch the pool_wallet must check this flag and refuse. CI guard rail to prevent regression. |
| Creator wallet compromise | Drains pool wallet after claim | That's their problem after claim. We warn aggressively at claim-confirm time. |
| Ledger / hardware wallet user | Some Ledger firmwares produce non-deterministic ed25519 signatures | Use the pubkey-only encrypt flow (does not require any signature determinism). See §4. |

**Out of scope:** rubber-hose attacks, side channels in the user's browser, supply-chain attacks against libsodium itself. We assume the audited crypto library is correct.

---

## 2. Cryptographic primitives

We use **libsodium's `crypto_box_seal`** (sealed box) for the pool key encryption, with one wrinkle: Solana wallets use ed25519 keys, but `crypto_box_seal` operates on X25519 (Curve25519). We convert.

### ed25519 → X25519 conversion

Every ed25519 public key has a deterministic X25519 equivalent (the "Montgomery point"). The conversion is well-defined:

- ed25519 pubkey → decode as Edwards point → convert to Montgomery point → that's the X25519 pubkey
- ed25519 secret key → SHA-512 first 32 bytes → clamp → that's the X25519 secret key

Library support:
- `@noble/ed25519` and `@noble/curves` expose `edwardsToMontgomeryPub` and `edwardsToMontgomeryPriv`
- libsodium has `crypto_sign_ed25519_pk_to_curve25519` / `crypto_sign_ed25519_sk_to_curve25519`

### Sealed box format

`crypto_box_seal(message, recipient_x25519_pk)`:
1. Generates ephemeral X25519 keypair
2. Computes nonce as `BLAKE2b(ephemeral_pk || recipient_pk)` — deterministic, no RNG concern
3. Encrypts with `crypto_box_easy(message, nonce, recipient_pk, ephemeral_sk)`
4. Returns `ephemeral_pk || ciphertext`

Recipient decrypts:
1. Extract `ephemeral_pk` from the first 32 bytes
2. Recompute nonce as `BLAKE2b(ephemeral_pk || own_pk)`
3. `crypto_box_open_easy(ciphertext, nonce, ephemeral_pk, own_sk)`

**Key property:** the encryptor (us) does not need to retain the ephemeral secret key — once `seal()` returns, we can immediately destroy our memory of everything except the output blob and the recipient pubkey. The recipient does not need our help to decrypt.

---

## 3. DB schema

### New columns on `memes`

```sql
-- The libsodium sealed-box blob: ephemeral_pk (32B) || ciphertext.
-- Encoded as base64 for portable storage.
-- IMMUTABLE after first write (enforced via trigger below).
ALTER TABLE memes ADD COLUMN creator_sealed_pool_key TEXT;

-- Timestamp when the sealed blob was successfully written + round-trip
-- verified. NULL means we haven't done the encrypt-and-verify ceremony yet.
ALTER TABLE memes ADD COLUMN creator_sealed_pool_key_verified_at TIMESTAMPTZ;

-- TRUE after the creator confirmed claim. Once true, the platform's
-- encrypted_pool_key column is cleared and the platform stops touching
-- the wallet.
ALTER TABLE memes ADD COLUMN pool_wallet_claimed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE memes ADD COLUMN pool_wallet_claimed_at TIMESTAMPTZ;

-- Immutability trigger: once creator_sealed_pool_key is set, it can
-- never be changed or NULLed. (Re-claim reads the existing blob; we
-- never re-encrypt.)
CREATE OR REPLACE FUNCTION enforce_sealed_pool_key_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.creator_sealed_pool_key IS NOT NULL
     AND NEW.creator_sealed_pool_key IS DISTINCT FROM OLD.creator_sealed_pool_key THEN
    RAISE EXCEPTION 'creator_sealed_pool_key is immutable after first write';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enforce_sealed_pool_key_immutable
  BEFORE UPDATE ON memes
  FOR EACH ROW
  EXECUTE FUNCTION enforce_sealed_pool_key_immutable();
```

### Audit log table

```sql
CREATE TABLE wallet_claim_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meme_id UUID NOT NULL REFERENCES memes(id),
  event TEXT NOT NULL CHECK (event IN (
    'sealed_at_launch',
    'verified_round_trip',
    'claim_initiated',
    'claim_confirmed',
    'platform_key_destroyed',
    'reclaim_attempted'
  )),
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Every state transition writes one row. This is the single source of truth for "did this happen?" during incident response.

---

## 4. End-to-end flow

### 4a. Sealing at launch time

Triggered immediately after the launch tx confirms (status flips to `live`).

```
Input:
  - pool_keypair (still in memory from launch)
  - creator_wallet_pubkey (from memes.creator_wallet, ed25519)

Steps:
  1. Convert creator's ed25519 pubkey to X25519 pubkey.
  2. Sodium sealedBox.seal(pool_keypair.secretKey, creator_x25519_pk)
     → sealed_blob (96 bytes: 32 ephemeral_pk + 32 nonce-derived + 32 ciphertext)
  3. Base64 encode sealed_blob.
  4. Within a single DB transaction:
     a. UPDATE memes SET creator_sealed_pool_key = $blob WHERE id = $meme_id
     b. INSERT INTO wallet_claim_events (meme_id, event) VALUES ($id, 'sealed_at_launch')
  5. ROUND-TRIP VERIFY:
     a. SELECT creator_sealed_pool_key FROM memes WHERE id = $meme_id
     b. Decode base64.
     c. Decrypt locally using a TEST keypair we generated just for verification.
        Wait — we cannot decrypt a sealed box without the recipient's secret key.
        We don't have the creator's secret key.

     The correct round-trip verify is:
     a. SELECT the blob back from DB.
     b. Confirm it parses correctly: 32-byte ephemeral_pk is a valid Curve25519 point.
     c. Confirm the ciphertext length matches expectation (input length + MAC overhead).
     d. The we-can-decrypt test is impossible by design — and that's the point.

     Therefore the round-trip verify is:
     - DB write succeeded (we read the same bytes back)
     - The blob parses as a valid sealed-box structure
     - Optional: re-do step 2 with the same inputs and check the OUTPUT is structurally similar
       (it won't byte-match because ephemeral_pk is random — but the output shape is verifiable)
  6. UPDATE memes SET creator_sealed_pool_key_verified_at = now()
  7. INSERT INTO wallet_claim_events (meme_id, event) VALUES ($id, 'verified_round_trip')
  8. Zero out pool_keypair.secretKey buffer in memory.

Failure modes:
  - DB write fails before step 6: platform's encrypted_pool_key is still intact;
    cron retries at next tick.
  - DB write succeeds, parse check fails: bug in our seal() call. Refuse to
    proceed; on-call alert. Platform key still intact.
  - All succeeds but caller crashes before zeroing memory: at most a key leak
    via crash dump if the OS includes process memory. Mitigation: deploy on
    infrastructure that disables core dumps. (Vercel/Lambda already does.)
```

The platform's existing `encrypted_pool_key` column **stays in the DB after this step**. It is only cleared on confirmed claim (§4c).

### 4b. Claim flow — creator initiates

```
On the meme detail page (post-launch, creator-only view):
  - Show banner: "Claim Pool Wallet" with a brief explainer.
  - Click → opens a dedicated claim page at /claim/{meme_id}.

Claim page (claim.prooflaunch.fun/{meme_id} — separate subdomain for isolation):
  1. Wallet connect.
  2. Verify connected wallet == meme.creator_wallet. If not, deny.
  3. Display CRITICAL warnings:
     - "Once you claim, the platform CANNOT recover this key for you."
     - "Save the key in your password manager or wallet immediately."
     - "If you lose this wallet, you lose this pool wallet permanently."
  4. User clicks "I understand → continue".
  5. Server: log claim_initiated event.

Decryption sub-flow on the claim page:
  6. Fetch sealed_blob from API (authenticated with signed-message proving
     ownership of creator_wallet).
  7. Wallet decryption — the path depends on what the wallet supports:

     PATH A (Phantom/Solflare with no decrypt support):
       The wallet cannot decrypt directly. We use a deterministic-signature
       fallback only for Ledger users where signature determinism is known
       to fail. Since standard wallets DO have deterministic ed25519
       signatures, we use the same X25519 conversion of their pubkey for
       encryption and ask them to use a small helper that derives X25519
       secret key from a wallet-signed deterministic message.

       Issue: Phantom does not expose the ed25519 secret key. We cannot
       convert it to X25519 client-side without the secret.

       Resolution: We use Phantom's signMessage() to sign a fixed
       deterministic message:
         signed = wallet.signMessage("prooflaunch-decrypt-derivation-v1")
       The signature is 64 bytes deterministic for ed25519.
       We use HKDF-SHA256(signed_bytes) → 32-byte X25519 secret key.

       The catch: the X25519 key we derive this way is NOT the actual
       creator's X25519 secret. So this only works if we ENCRYPTED to the
       derived pubkey, not to the actual creator's wallet pubkey.

       So the corrected flow is:
       - At launch time, we don't have the creator's signature yet.
       - We CAN have them sign the same deterministic message ONCE during
         submit (one extra signature prompt) and derive the X25519 pubkey
         then. We encrypt to that derived pubkey.
       - At claim time, they re-sign the same message, derive the same
         X25519 secret, decrypt the sealed blob.

       This is the only approach that works with current wallet adapters.

     PATH B (Backpack or other wallets with native decryption):
       Use the wallet's native decrypt API directly with the creator's
       actual X25519-converted pubkey. Simpler, no extra signature.

       Available wallets we'll detect at connect time.

     PATH C (Ledger fallback — non-deterministic signatures):
       Ledger users cannot use Path A reliably. For them:
       - At submission, after wallet connect, we generate a fresh X25519
         keypair, encrypt the X25519 SECRET to the meme's data using a
         password they choose, and store it.
       - The password is never sent to us.
       - At claim, they re-enter the password to decrypt the X25519 secret,
         then use it to open the sealed blob.

       This is the only Ledger-safe path. Documented prominently.

  8. Once decrypted, display the pool wallet secret key in multiple formats:
     - base58 string
     - JSON file (download)
     - QR code
  9. Show a confirmation checkbox: "I have securely saved the key."
  10. Show a verification step: type the first 4 + last 4 characters of the
      key into a form. This forces the user to actually look at it.
  11. User submits confirmation.

Failure modes:
  - User closes the page after decryption but before confirming:
    No harm — they can re-run claim (Path A's signature is deterministic).
  - User confirms but never saved: re-claim is allowed; sealed blob is
    immutable in DB. They sign the same challenge → same secret → same
    decrypt.
  - Decryption fails (sealed blob corrupted): on-call alert; we still have
    the platform key as a fallback so the creator does not lose access.
```

### 4c. Claim confirmation — platform burns its copy

```
After step 11 above:
  1. Server logs claim_confirmed event.
  2. Server starts a 24-HOUR GRACE PERIOD. The platform encrypted_pool_key
     stays in the DB during this period.
  3. After 24 hours, a cron checks: did the creator file any "I lost
     access — undo claim" request? If not, proceed.
  4. Within a single DB transaction:
     a. UPDATE memes SET encrypted_pool_key = NULL,
                         pool_wallet_claimed = TRUE,
                         pool_wallet_claimed_at = now()
        WHERE id = $meme_id
     b. INSERT INTO wallet_claim_events (meme_id, event)
        VALUES ($id, 'platform_key_destroyed')
  5. From this moment forward, EVERY code path that loads
     encrypted_pool_key must handle NULL gracefully and skip the meme.
     CI guard: a test that asserts no code path crashes on
     pool_wallet_claimed = TRUE memes.

The grace period exists for one purpose: a fail-safe escape hatch if the
creator realizes they didn't actually save the key. They can ask us to
abort the claim. We refuse all such requests after 24 hours — fundamental
property of the design.
```

### 4d. Re-claim

The sealed blob is **immutable and permanent** in the DB. If the creator decrypts it, loses the cleartext, and comes back later:

1. They visit `/claim/{meme_id}` again.
2. Same flow: connect wallet, prove ownership, re-derive the X25519 secret from the same deterministic signature, decrypt the same blob.
3. They get the same pool wallet secret key out.

Re-claim is free, unlimited, and silent (no warnings). The blob is public-key-encrypted to them; only they can decrypt it; nobody else cares if they decrypt it 100 times.

---

## 5. Failure modes & defenses summary table

| Failure | Where | Defense |
|---|---|---|
| Pool key never sealed (launch crashed mid-flow) | §4a | Platform `encrypted_pool_key` intact; cron re-tries the seal step on next tick (idempotent: skip if `creator_sealed_pool_key` already set) |
| Sealed blob written but verify failed | §4a step 5 | Don't set `verified_at` column. Retry until verified. Platform key intact. |
| DB blob corrupted post-write | Storage | Immutability trigger + daily integrity scan + replicated backups |
| Wallet adapter inconsistency on signature derivation | §4b path A | Use a stable deterministic message + version it. Test vectors in CI. Ledger users use path C. |
| User decrypts wrong key (bug in helper) | §4b step 8 | Helper page recomputes the wallet pubkey from the decrypted secret key and verifies it matches the on-chain pool_wallet address. Refuses to display if mismatch. |
| User confirms but never saved | §4b step 11 | Re-claim is always allowed (sealed blob is immutable) |
| Platform destroys its copy too early | §4c | 24h grace period + audit log shows when destroy happened |
| Future code path still tries to use platform key | §4c step 5 | NULL handling + CI guard rail + audit log on every read |
| Creator loses their wallet entirely | Out of platform control | Warned aggressively at confirm step. Optional: support encrypting to a second recovery pubkey at submit time (multi-recipient sealed box) — V2 feature. |
| Ledger user with non-deterministic signatures | §4b path C | Password-based fallback. Documented clearly. |

---

## 6. Test plan

### Unit tests (TypeScript)

- ed25519 → X25519 conversion correctness (test vectors from the libsodium spec)
- sealedBox seal+open round-trip with known keypair
- Property test: encrypt 1000 random pool keys to 1000 random recipient pubkeys, verify each recipient can decrypt their own and only their own
- Signature-derived secret stability: sign the same message 100 times with the same key, confirm same output (will fail for Ledger — that's expected)

### Integration tests

- Launch a test meme on devnet (or use a sacrificial mainnet meme like UT12872):
  1. Trigger launch
  2. Confirm `creator_sealed_pool_key` is set + verified
  3. Confirm `encrypted_pool_key` is also still set (belt-and-suspenders)
  4. Run the claim flow as the creator wallet
  5. Decrypt the sealed blob locally
  6. Verify the decrypted key matches the on-chain pool wallet address
  7. Use the decrypted key to send a tiny SOL tx — confirm signature works on chain
  8. Confirm claim — wait 24h, confirm `encrypted_pool_key` is NULL
  9. Confirm re-claim still works (sealed blob still readable)

### Adversarial tests

- Try to UPDATE `creator_sealed_pool_key` after first write — must fail
- Try to claim a meme as a wallet other than `creator_wallet` — must fail
- Try to claim before launch tx confirms — must fail
- After claim, try to fire the legacy fee distribution against this meme — must skip cleanly

---

## 7. Rollout plan

1. **Build behind a feature flag** `WALLET_CLAIM_ENABLED`. Default off.
2. Apply DB migration (immutability trigger + new columns + audit table).
3. Land the sealing code at launch time — but only when the flag is on. Existing meme launches keep working unchanged when flag is off.
4. Backfill: write a script to seal pool keys for already-launched memes (where we still have `encrypted_pool_key`). Same encrypt + verify ceremony, just applied retroactively. Audit log entry per backfilled meme.
5. Build the claim page + wallet adapter integrations behind the same flag.
6. Internal end-to-end test on UT12872 (sacrificial meme).
7. External code review by a second crypto-aware reviewer.
8. Soft launch: flag on for a single test meme, run claim flow, verify everything.
9. Enable flag globally.
10. Announce: creators of existing live memes can now claim.

---

## 8. Resolved design decisions

- **Derivation signature timing: AT LAUNCH TIME.** The creator signs the deterministic derivation message (`prooflaunch-decrypt-derivation-v1`) once during the launch auth flow. The X25519 pubkey is derived server-side from the signature, the pool key is sealed to it, and the verified blob is stored before the platform plaintext is destroyed. Submit flow is unchanged. Rationale: less friction at submit, no wasted seals for memes that never launch, platform-encrypted backup remains valid during the entire backing window.
- **Multi-recipient sealed boxes (recovery wallet): DEFERRED TO V2.** Single-recipient seal for v1.
- **Reverse claim during grace period: SUPPORT TICKET ONLY.** No UI button. Manual approval required. Rationale: phished sessions can't easily revert; intentional friction is the security feature.
- **Public "Dev self-custody" badge: YES, show after claim confirmation.** Signals to traders that the dev has full control of the wallet. Aligns with the brand of "everything provable."

---

## 9. Out of scope for v1

- Recovery via multi-signature or social recovery
- Encrypted backup to a second device the creator controls
- Custodial fallback for users who explicitly opt out of self-custody
- Claim of legacy memes whose `encrypted_pool_key` was rotated out of accessible storage (e.g., pre-rotation memes where we may no longer have the platform-side key). These will need separate handling.
