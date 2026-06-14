-- Migration 056: tiered max-buy-in caps (creator / team / public).
--
-- Replaces the single uniform max_backing_sol with three independent
-- optional ceilings so the creator can dial each cohort separately:
--   • max_backing_sol_creator → caps the creator's own wallet
--   • max_backing_sol_team    → caps allowlisted backers (reserved slots)
--   • max_backing_sol_public  → caps open-bucket public backers
--
-- All three are optional. NULL on a tier means "no cap" for that
-- tier. The legacy max_backing_sol column STAYS as a fallback for
-- memes submitted before this migration:
--   1. Determine the backer's tier.
--   2. If tier-specific cap exists, enforce it.
--   3. Else if legacy max_backing_sol exists, enforce uniformly.
--   4. Else uncapped.
--
-- This preserves every existing meme's behavior byte-identical until
-- a creator opts into the new tiered shape.
--
-- Behind no feature flag. Backings API will be updated in lockstep
-- to read the new columns when present.

ALTER TABLE memes ADD COLUMN IF NOT EXISTS max_backing_sol_creator NUMERIC NULL;
ALTER TABLE memes ADD COLUMN IF NOT EXISTS max_backing_sol_team    NUMERIC NULL;
ALTER TABLE memes ADD COLUMN IF NOT EXISTS max_backing_sol_public  NUMERIC NULL;

COMMENT ON COLUMN memes.max_backing_sol_creator IS
  'Optional ceiling on per-backing amount for the creator wallet. NULL = no creator-specific cap; falls back to max_backing_sol if set, otherwise uncapped. Quote-currency-agnostic (interpreted in whichever currency the meme uses).';
COMMENT ON COLUMN memes.max_backing_sol_team IS
  'Optional ceiling on per-backing amount for allowlisted (team / reserved-slot) backers. NULL = no team-specific cap; falls back to max_backing_sol if set, otherwise uncapped.';
COMMENT ON COLUMN memes.max_backing_sol_public IS
  'Optional ceiling on per-backing amount for open-bucket public backers. NULL = no public-specific cap; falls back to max_backing_sol if set, otherwise uncapped.';

-- Sanity: tier caps must be positive when set. CHECK constraints stay
-- permissive — we let the application layer enforce relationships like
-- "creator >= team >= public" since the user is explicit that creators
-- have full control and may want exotic shapes (e.g. cap themselves low,
-- let team go higher).
ALTER TABLE memes
  ADD CONSTRAINT memes_max_backing_creator_positive CHECK (max_backing_sol_creator IS NULL OR max_backing_sol_creator > 0);
ALTER TABLE memes
  ADD CONSTRAINT memes_max_backing_team_positive    CHECK (max_backing_sol_team    IS NULL OR max_backing_sol_team    > 0);
ALTER TABLE memes
  ADD CONSTRAINT memes_max_backing_public_positive  CHECK (max_backing_sol_public  IS NULL OR max_backing_sol_public  > 0);
