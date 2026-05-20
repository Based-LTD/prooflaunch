-- Phase 1 of per-coin trading fee subsystem.
--
-- Adds a per-meme "sub-escrow" keypair that will be used as the on-chain
-- `coin_creator` arg at launch (instead of the shared platform escrow).
-- Because pump.fun's creator-vault PDA is derived from the creator pubkey,
-- using a unique per-meme creator isolates each coin's trading fees in
-- its own vault — eliminating the aggregate-attribution problem that
-- afflicted the shared-escrow model.
--
-- Backwards-compatible by design:
--   - Both columns are NULL on existing rows.
--   - launchPooledAtomic falls back to shared escrow when sub-escrow is NULL.
--   - Old launches (PROOF, TEST) continue routing creator fees to shared escrow.
--   - Only new submissions (after Phase 2 deploys) will populate these.
--
-- Idempotent (safe to re-run): IF NOT EXISTS on columns; DROP/ADD on constraint.

ALTER TABLE memes ADD COLUMN IF NOT EXISTS creator_subescrow_pubkey TEXT;
ALTER TABLE memes ADD COLUMN IF NOT EXISTS encrypted_creator_subescrow_key TEXT;

-- Co-presence invariant: either both NULL (legacy / shared-escrow) or
-- both populated (per-coin sub-escrow). Never one without the other —
-- would mean the pubkey is unrecoverable from the key or vice versa.
ALTER TABLE memes DROP CONSTRAINT IF EXISTS memes_subescrow_pair_chk;
ALTER TABLE memes ADD CONSTRAINT memes_subescrow_pair_chk
  CHECK (
    (creator_subescrow_pubkey IS NULL AND encrypted_creator_subescrow_key IS NULL)
    OR
    (creator_subescrow_pubkey IS NOT NULL AND encrypted_creator_subescrow_key IS NOT NULL)
  );

COMMENT ON COLUMN memes.creator_subescrow_pubkey IS
  'Per-meme sub-escrow keypair pubkey, used as the on-chain coin_creator at launch. Allows per-coin isolation of pump.fun creator-vault fees so each coin''s trading fees route to a vault we can collect from independently. Generated at submission. NULL = legacy (creator=shared escrow).';

COMMENT ON COLUMN memes.encrypted_creator_subescrow_key IS
  'AES-256-GCM encrypted private key for the sub-escrow (same scheme as encrypted_pool_key). NEVER expose to client. MUST NOT be selected by the memes_with_stats view or any client-facing endpoint.';
