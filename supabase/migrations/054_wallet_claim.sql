-- Migration 054: pool wallet claim infrastructure.
--
-- Adds the "creator can take self-custody of their pool wallet after
-- launch" path. See docs/wallet-claim-design.md for the full design.
--
-- Properties enforced here:
--   • creator_sealed_pool_key is IMMUTABLE after first write — no later
--     code path can corrupt or overwrite it (DB trigger). This is the
--     creator's permanent encrypted backup.
--   • A separate verified_at timestamp tracks when the seal+verify
--     ceremony completed — NULL means we haven't finished the launch-
--     time sealing, so platform code paths should still treat the meme
--     as platform-custodied.
--   • pool_wallet_claimed boolean gates all platform code paths from
--     touching the pool wallet AFTER the creator has confirmed claim.
--   • wallet_claim_events is the audit log — every state transition
--     writes one row so we can reconstruct exactly what happened during
--     incident response.
--
-- Behind a feature flag at the application layer: this migration is
-- safe to apply now; nothing reads or writes the new columns until
-- WALLET_CLAIM_ENABLED=true is set.

-- ── memes column additions ──────────────────────────────────────────
ALTER TABLE memes ADD COLUMN IF NOT EXISTS creator_sealed_pool_key TEXT;
ALTER TABLE memes ADD COLUMN IF NOT EXISTS creator_sealed_pool_key_verified_at TIMESTAMPTZ;
ALTER TABLE memes ADD COLUMN IF NOT EXISTS pool_wallet_claimed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE memes ADD COLUMN IF NOT EXISTS pool_wallet_claimed_at TIMESTAMPTZ;

COMMENT ON COLUMN memes.creator_sealed_pool_key IS
  'libsodium sealed-box ciphertext, base64-encoded. Encrypted to a Curve25519 pubkey derived from a deterministic signature by the creator''s wallet. IMMUTABLE after first write.';
COMMENT ON COLUMN memes.creator_sealed_pool_key_verified_at IS
  'Timestamp when the seal+round-trip-verify ceremony completed at launch time. NULL means platform code paths should still use encrypted_pool_key (the sealing did not complete).';
COMMENT ON COLUMN memes.pool_wallet_claimed IS
  'TRUE after the creator has confirmed claim. Once true, the platform encrypted_pool_key column is cleared (by cron, 24h after confirm) and ALL platform code paths must skip this meme cleanly.';

-- ── Immutability trigger on creator_sealed_pool_key ─────────────────
-- Once the sealed blob is set, it can never be changed or NULLed.
-- This is the hard property the design rests on.
CREATE OR REPLACE FUNCTION enforce_sealed_pool_key_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.creator_sealed_pool_key IS NOT NULL
     AND NEW.creator_sealed_pool_key IS DISTINCT FROM OLD.creator_sealed_pool_key THEN
    RAISE EXCEPTION
      'creator_sealed_pool_key is immutable after first write (meme_id=%, attempted to change)', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_sealed_pool_key_immutable ON memes;
CREATE TRIGGER trg_enforce_sealed_pool_key_immutable
  BEFORE UPDATE ON memes
  FOR EACH ROW
  EXECUTE FUNCTION enforce_sealed_pool_key_immutable();

-- ── wallet_claim_events audit log ───────────────────────────────────
CREATE TABLE IF NOT EXISTS wallet_claim_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meme_id     UUID NOT NULL REFERENCES memes(id) ON DELETE RESTRICT,
  event       TEXT NOT NULL CHECK (event IN (
    'sealed_at_launch',         -- The seal+verify ceremony completed at launch time.
    'verified_round_trip',      -- Optional explicit verify row (some flows log it separately).
    'claim_initiated',          -- Creator clicked "Claim Wallet" and authenticated.
    'claim_confirmed',          -- Creator confirmed they saved the key (or re-confirmed).
    'platform_key_destroyed',   -- The 24h grace cron cleared encrypted_pool_key.
    'reclaim_attempted',        -- Creator decrypted again post-confirm (silent re-claim).
    'reverse_requested'         -- Support reverted a claim during grace window (manual).
  )),
  details     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wallet_claim_events_meme
  ON wallet_claim_events (meme_id, created_at DESC);

COMMENT ON TABLE wallet_claim_events IS
  'Append-only audit log for every state transition in the pool wallet claim flow. Single source of truth for incident response.';

-- ── Sanity: ON DELETE RESTRICT on meme_id ──────────────────────────
-- Deleting a meme row that has wallet_claim_events would orphan the
-- audit history. RESTRICT means the meme can only be deleted after the
-- audit log is explicitly cleared — never silently lost.
