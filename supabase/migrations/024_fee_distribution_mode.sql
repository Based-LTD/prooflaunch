-- Hold-%-weighted fee distribution.
--
-- Adds a per-meme mode flag that determines how the 90% backer pool is
-- split among backers when fees are collected.
--
--   'legacy_flat'   = pure pro-rata by original stake (old behavior, kept
--                     for optional override / backwards compat)
--   'hold_weighted' = each backer's pro-rata share is multiplied by their
--                     current hold % (capped 100%). The entire "freed up"
--                     portion from dumpers flows to the holder airdrop pool.
--                     Brand line: every backer dump on every meme pays
--                     every PROOF holder.
--
-- Default: hold_weighted for ALL rows (new AND existing). PROOF and other
-- live memes are upgraded retroactively. The platform runs on its own rules.

ALTER TABLE memes
  ADD COLUMN IF NOT EXISTS fee_distribution_mode TEXT
    NOT NULL DEFAULT 'hold_weighted'
    CHECK (fee_distribution_mode IN ('legacy_flat', 'hold_weighted'));

COMMENT ON COLUMN memes.fee_distribution_mode IS
  'How the 90% backer pool is split among backers at fee distribution time. hold_weighted (default) = pro-rata × current hold % capped at 100%; all freed (dumpers'' lost) shares flow entirely to the holder airdrop pool. legacy_flat = pure pro-rata by stake (no holding requirement).';
