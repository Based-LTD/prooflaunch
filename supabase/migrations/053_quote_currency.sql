-- Migration 053: Add quote_currency to memes (USDC support Phase 2).
--
-- Tracks whether a launch is quoted in SOL or USDC. SOL stays the
-- default for every existing meme + every new meme that doesn't
-- explicitly opt into USDC. USDC-quoted launches are only valid
-- when launch_platform = 'meteora' for now (Phase 1 finding:
-- Pump.fun's BC is SOL-only at the program level, and Raydium
-- LaunchLab doesn't expose third-party USDC config creation — both
-- enforced by the /api/memes POST validator, not the DB CHECK,
-- so future-us can flip these on without a migration when those
-- launchpads add USDC support).
--
-- Values:
--   'sol'  — quote = wrapped SOL (So111…). Existing behavior, default.
--   'usdc' — quote = mainnet USDC (EPjFWdd5…). Routes to the
--            METEORA_DBC_CONFIG_USDC env'd config at launch time.
--
-- Why TEXT + CHECK instead of an ENUM: same reasoning as
-- migration 046 (launch_platform) — ENUMs require ALTER TYPE ADD
-- VALUE in a separate tx from anything that references the new
-- value, which we got burned by in the bot-action enum migration.
--
-- Safe to re-run.

ALTER TABLE memes
  ADD COLUMN IF NOT EXISTS quote_currency TEXT NOT NULL DEFAULT 'sol';

DO $$ BEGIN
  ALTER TABLE memes ADD CONSTRAINT memes_quote_currency_check
    CHECK (quote_currency IN ('sol', 'usdc'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN memes.quote_currency IS
  'Which currency this launch is quoted in. ''sol'' (default, wrapped SOL) keeps existing behavior. ''usdc'' (mainnet USDC) routes the launch through the USDC-quoted Meteora DBC config; backing + fees + post-launch trading all denominated in USDC. launch_platform=meteora required for usdc until Pump.fun/LaunchLab add USDC support.';

CREATE INDEX IF NOT EXISTS idx_memes_quote_currency ON memes (quote_currency);
