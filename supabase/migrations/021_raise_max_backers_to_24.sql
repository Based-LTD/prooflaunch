-- 021 — raise max backer slots per meme from 8 to 24
--
-- The atomic launch tx (createV2 + buy) is ONE transaction regardless of
-- backer count, so the launch flow itself is unaffected. The thing that
-- scales linearly is post-launch distribution: one tx per backer.
-- Already proven correct at 2 (FEEV1) and 4 (PROOF, TRUMPHOUSE, CHAMPIONS,
-- BULLSEYE) backers — 24 just runs the same loop more times.
--
-- Community feedback after Friday's launches indicated 8 was too low.
-- Bumping to 24 keeps the curated/intimate-pool feel while opening
-- meaningfully more participation per meme. Per-meme gas reserve
-- requirement scales linearly: 24 backers × 0.0025 SOL = 0.06 SOL,
-- well within current shared escrow capacity (0.5 SOL).
--
-- Migration is forward-compatible: existing memes with total_slots <= 8
-- continue to validate. No data migration required.

ALTER TABLE memes
  DROP CONSTRAINT IF EXISTS check_total_slots_range;

ALTER TABLE memes
  ADD CONSTRAINT check_total_slots_range
  CHECK (total_slots >= 2 AND total_slots <= 24);

COMMENT ON COLUMN memes.total_slots IS
  'Number of backer slots for this meme (range 2-24). Enforced by check_total_slots_range. Previously capped at 8 in migration 011; raised in 021 after community feedback + a controlled 24-backer test confirmed the distribution loop scales cleanly.';
