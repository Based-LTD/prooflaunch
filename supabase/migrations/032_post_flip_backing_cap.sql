-- Team-fairness cap: optional creator-set ceiling on per-backer SOL.
--
-- Use case: a serious team launch (e.g. stealth with allowlist → flip to
-- open) wants to guarantee that no public backer can out-back any team
-- member. The creator picks a max at submission; /api/backings enforces
-- that NO backing (private or public) exceeds it. Result: every slot
-- gets at most the same SOL, so token allocations are bounded equally.
--
-- NULL = no cap (the default — "regular submissions are game on, put
-- in whatever you want"). When set, must be ≥ min_backing_sol so the
-- minimum is actually backable.
--
-- Universal by design: applies to allowlisted private backers too, not
-- just post-flip public. The fairness contract is "every backer slot is
-- bounded by the same ceiling," not "team gets bigger slots." Team
-- advantage comes from going first via the allowlist, not from outsizing.

ALTER TABLE memes
  ADD COLUMN IF NOT EXISTS max_backing_sol NUMERIC;

ALTER TABLE memes
  DROP CONSTRAINT IF EXISTS memes_max_backing_sol_above_min;
ALTER TABLE memes
  ADD CONSTRAINT memes_max_backing_sol_above_min CHECK (
    max_backing_sol IS NULL
    OR max_backing_sol >= min_backing_sol
  );

COMMENT ON COLUMN memes.max_backing_sol IS
  'Optional per-backer SOL ceiling, set by creator at submission. NULL = uncapped (default for casual launches). When set, enforced on every backing (allowlisted + public) so no wallet can out-back any other. Must be ≥ min_backing_sol.';
