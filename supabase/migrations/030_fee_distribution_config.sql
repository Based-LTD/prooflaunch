-- Launch Configuration v2 — Phase 2: per-meme fee distribution config.
--
-- Today every meme uses a hardcoded 90/5/5 split (backers / platform /
-- holder rewards). Phase 2 lets creators pick a preset OR roll their own
-- split at submission time. The configured percentages live on the meme
-- row; distribution code reads them at claim time.
--
-- Presets (UI labels):
--   • standard         — 90 backer, 5 platform, 5 holder rewards (default; matches legacy)
--   • community_first  — 70 backer, 5 platform, 25 holder rewards (heavy community return)
--   • deflationary     — 60 backer, 5 platform, 5 holder rewards, 30 burn
--   • charity_aligned  — 80 backer, 5 platform, 5 holder rewards, 10 charity (creator picks wallet)
--   • custom           — creator sets each % themselves
--
-- All percentages are whole integers 0-100. Sum MUST equal 100 (enforced
-- by CHECK constraint). Charity wallet only matters when fee_charity_pct > 0.
--
-- LEGACY MEMES (e.g. PROOF): NULL config = use the hardcoded legacy
-- distribution. The distribution code falls back to legacy behavior when
-- fee_preset IS NULL, so existing memes aren't affected.

DO $$ BEGIN
  CREATE TYPE fee_preset_type AS ENUM (
    'standard',
    'community_first',
    'deflationary',
    'charity_aligned',
    'custom'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE memes
  ADD COLUMN IF NOT EXISTS fee_preset            fee_preset_type,
  ADD COLUMN IF NOT EXISTS fee_backer_pct         INT,
  ADD COLUMN IF NOT EXISTS fee_holder_rewards_pct INT,
  ADD COLUMN IF NOT EXISTS fee_platform_pct       INT,
  ADD COLUMN IF NOT EXISTS fee_burn_pct           INT,
  ADD COLUMN IF NOT EXISTS fee_charity_pct        INT,
  ADD COLUMN IF NOT EXISTS fee_charity_wallet     TEXT;

-- Constraint: when fee_preset IS SET, all the % fields must be present
-- AND sum to 100. Legacy memes (preset IS NULL) bypass entirely.
-- Using DO block so we can drop+recreate cleanly on re-runs.
DO $$ BEGIN
  ALTER TABLE memes DROP CONSTRAINT IF EXISTS fee_config_valid;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

ALTER TABLE memes ADD CONSTRAINT fee_config_valid CHECK (
  fee_preset IS NULL                                -- legacy memes, no config
  OR (
    fee_backer_pct         BETWEEN 0 AND 100
    AND fee_holder_rewards_pct BETWEEN 0 AND 100
    AND fee_platform_pct       BETWEEN 0 AND 100
    AND fee_burn_pct           BETWEEN 0 AND 100
    AND fee_charity_pct        BETWEEN 0 AND 100
    AND (fee_backer_pct + fee_holder_rewards_pct + fee_platform_pct + fee_burn_pct + fee_charity_pct) = 100
    AND (fee_charity_pct = 0 OR fee_charity_wallet IS NOT NULL)
  )
);

COMMENT ON COLUMN memes.fee_preset IS 'Fee distribution preset. NULL = legacy hardcoded distribution; non-NULL = use the per-meme percentages below.';
COMMENT ON COLUMN memes.fee_backer_pct IS 'Percentage of trading fees to backers (0-100). All backer-pool slots share this hold-weighted.';
COMMENT ON COLUMN memes.fee_holder_rewards_pct IS 'Percentage to $PROOF holder airdrop pool (0-100).';
COMMENT ON COLUMN memes.fee_platform_pct IS 'Percentage retained by platform (0-100).';
COMMENT ON COLUMN memes.fee_burn_pct IS 'Percentage auto-burned by the buyback engine (0-100). Requires platform to swap fee SOL into tokens before burning.';
COMMENT ON COLUMN memes.fee_charity_pct IS 'Percentage routed to fee_charity_wallet (0-100).';
COMMENT ON COLUMN memes.fee_charity_wallet IS 'Destination wallet for charity %. Required when fee_charity_pct > 0.';

-- Refresh memes_with_stats so the new columns flow through to the frontend
DROP VIEW IF EXISTS memes_with_stats;
CREATE OR REPLACE VIEW memes_with_stats AS
SELECT m.* FROM memes m;
GRANT SELECT ON memes_with_stats TO anon, authenticated, service_role;
