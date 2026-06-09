-- Migration 051: Add 'launchlab' to launch_platform.
--
-- Raydium LaunchLab as the third launchpad option alongside Pump.fun
-- and Meteora. Phase 1 — scaffolding only (the dispatcher returns a
-- "not yet implemented" stub). Phase 2 will wire the actual
-- @raydium-io/raydium-sdk-v2 createLaunchpad call after a devnet
-- validation round.
--
-- Existing migration 046 reserved 'bonk' for LaunchLab under the Bonk
-- brand, but LaunchLab is now its own first-class product. We keep
-- 'bonk' reserved (might host a future Bonk.fun-flavored variant) and
-- add 'launchlab' as the canonical Raydium path.
--
-- Safe to re-run.

DO $$ BEGIN
  ALTER TABLE memes DROP CONSTRAINT IF EXISTS memes_launch_platform_check;
  ALTER TABLE memes ADD CONSTRAINT memes_launch_platform_check
    CHECK (launch_platform IN ('pumpfun', 'meteora', 'bags', 'bonk', 'launchlab'));
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Per-platform address column for the LaunchLab pool (mirrors the
-- dbc_pool_address pattern from migration 046).
ALTER TABLE memes
  ADD COLUMN IF NOT EXISTS launchlab_pool_address TEXT;

COMMENT ON COLUMN memes.launchlab_pool_address IS
  'Raydium LaunchLab pool address. Populated when launch_platform=launchlab at launch time.';
