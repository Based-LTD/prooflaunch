-- Phase B hardening — labeled vault bots (unlimited per meme).
--
-- The 040 migration enforced UNIQUE(meme_id, action), correctly
-- preventing duplicate BURN / distribute_* bots (which would collapse
-- into one). But HOLD is special — it's a *vault*, and creators want
-- to publicly commit fees to different purposes (Marketing, DAO,
-- Liquidity, Charity). Each vault = its own labeled wallet on Solscan.
--
-- This migration:
--   1. Drops the blanket UNIQUE(meme_id, action) and replaces it with
--      a partial unique index that excludes 'hold'.
--   2. Adds a `label` column. Required (CHECK) when action='hold';
--      NULL otherwise.
--   3. Backfills existing HOLD bots with the default label 'Vault' so
--      the CHECK doesn't reject them.
--
-- Safe to re-run.

-- Backfill BEFORE adding the CHECK so existing HOLD rows pass.
ALTER TABLE meme_bots
  ADD COLUMN IF NOT EXISTS label TEXT;

UPDATE meme_bots SET label = 'Vault'
  WHERE action = 'hold' AND label IS NULL;

-- Replace the blanket uniqueness with a partial index that excludes HOLD.
-- The constraint may not exist in databases applied before 040; guard it.
ALTER TABLE meme_bots DROP CONSTRAINT IF EXISTS meme_bots_meme_id_action_key;

DO $$ BEGIN
  -- Partial unique index: still one BURN, one distribute_tokens_holders,
  -- etc. per meme, but unlimited HOLD vaults.
  CREATE UNIQUE INDEX meme_bots_meme_action_nonhold_uq
    ON meme_bots (meme_id, action) WHERE action != 'hold';
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

-- Label rules:
--   - Required for hold (vault must be labeled)
--   - Forbidden for non-hold (other actions are self-describing)
--   - Length cap and basic character whitelist (display safety, prevents
--     control chars / homoglyph confusion in Solscan labels)
DO $$ BEGIN
  ALTER TABLE meme_bots ADD CONSTRAINT meme_bots_label_check
    CHECK (
      (action = 'hold'  AND label IS NOT NULL AND char_length(label) BETWEEN 1 AND 24
                        AND label ~ '^[A-Za-z0-9 _\-]+$')
      OR
      (action != 'hold' AND label IS NULL)
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN meme_bots.label IS
  'Display label for HOLD (vault) bots — e.g. "Marketing", "DAO Treasury". Required for action=hold; NULL for all other actions (which are self-describing).';
