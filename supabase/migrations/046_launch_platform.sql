-- 046 — multi-platform launch scaffolding
--
-- Adds the dispatcher key (memes.launch_platform) and platform-specific
-- nullable address columns so the same meme row can carry pump.fun
-- mint + future Meteora DBC pool addr + future Bags fee-share authority
-- without forcing a column rename party every time we add a platform.
--
-- This migration is SCAFFOLDING ONLY. No service code reads any of these
-- non-pumpfun columns yet — the dispatcher in src/services/launch/index.ts
-- will route to platform-specific modules in subsequent commits.
--
-- launch_platform values:
--   'pumpfun'  — current default; everything pre-this-migration is pumpfun
--   'meteora'  — Phase 1 (DBC pre-graduation only at first)
--   'bags'     — Phase 2 (built on Meteora DBC underneath)
--   'bonk'     — Phase 3 (Raydium LaunchLab)
--
-- Why TEXT + CHECK instead of a Postgres ENUM: ENUMs require ALTER TYPE
-- ADD VALUE in a separate transaction from anything that references the
-- new value (we got bitten by this on migration 043 with the
-- buyback_bot_action enum and donate_*). A CHECK constraint is easier
-- to extend in a single migration when we add bonk / bags.
--
-- Safe to re-run.

ALTER TABLE memes
  ADD COLUMN IF NOT EXISTS launch_platform TEXT NOT NULL DEFAULT 'pumpfun';

DO $$ BEGIN
  ALTER TABLE memes ADD CONSTRAINT memes_launch_platform_check
    CHECK (launch_platform IN ('pumpfun', 'meteora', 'bags', 'bonk'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN memes.launch_platform IS
  'Which launchpad executes the create + first-buy when this meme launches. Default pumpfun preserves legacy behavior. Read by src/services/launch/index.ts dispatcher.';

-- ── Per-platform address columns ───────────────────────────────────
-- Each column is nullable + only populated by its own platform path.
-- The existing mint_address column stays the source-of-truth for the
-- token mint regardless of platform.

ALTER TABLE memes
  ADD COLUMN IF NOT EXISTS dbc_pool_address TEXT;          -- Meteora DBC pool (Phase 1)
ALTER TABLE memes
  ADD COLUMN IF NOT EXISTS damm_v2_pool_address TEXT;      -- Meteora DAMM v2 post-graduation
ALTER TABLE memes
  ADD COLUMN IF NOT EXISTS alpha_vault_address TEXT;       -- Meteora Alpha Vault (Phase 2 of Meteora)
ALTER TABLE memes
  ADD COLUMN IF NOT EXISTS bags_fee_share_authority TEXT;  -- Bags fee-share config authority (Phase 2)

COMMENT ON COLUMN memes.dbc_pool_address IS
  'Meteora Dynamic Bonding Curve pool address. Populated when launch_platform=meteora at launch time.';
COMMENT ON COLUMN memes.damm_v2_pool_address IS
  'Meteora DAMM v2 pool created on DBC graduation. Populated by the graduation event watcher (not yet implemented).';
COMMENT ON COLUMN memes.alpha_vault_address IS
  'Meteora Alpha Vault address if the meme uses the vault pattern instead of our native pool wallet. NULL for Phase 1 Meteora.';
COMMENT ON COLUMN memes.bags_fee_share_authority IS
  'Authority pubkey for the Bags fee-share v2 config. Required to call createFeeShareAdminUpdateConfig if we ever need to mutate the split.';

CREATE INDEX IF NOT EXISTS idx_memes_launch_platform ON memes (launch_platform);
