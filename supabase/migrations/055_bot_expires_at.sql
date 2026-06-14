-- Migration 055: optional bot lifetime — expires_at.
--
-- Lets creators set a finite duration on a bot at submit time
-- (e.g. "BURN for 4 months" or "DONATE for 12 months"). Bots without
-- an expiry default to NULL = run forever (current behavior).
--
-- Semantics:
--   • NULL → run forever (default; preserves existing bot rows exactly)
--   • non-NULL → the buyback cron skips the bot when now() >= expires_at,
--     AND the fee-distribution path stops delegating new fees to it.
--     The bot wallet retains whatever it already accumulated; the
--     creator can sweep it via the existing vault withdraw flow (for
--     hold/vault bots) or via the eventual platform "expired bot
--     recovery" pathway (TODO — out of scope for this migration).
--
-- Behind no feature flag. The new column is optional and ignored by
-- existing code paths until they're updated to check it (next phase).

ALTER TABLE meme_bots ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN meme_bots.expires_at IS
  'Optional bot lifetime cutoff. NULL = run forever (default). After this timestamp the buyback cron skips the bot and the fee-delegation path stops routing new fees to it. Set at submit time from a creator-chosen duration (1mo / 3mo / 6mo / 12mo).';

-- Useful index for the cron: when scanning bots to fire, exclude
-- expired ones via WHERE expires_at IS NULL OR expires_at > now().
-- The expression index makes that filter cheap on large bot stacks.
CREATE INDEX IF NOT EXISTS idx_meme_bots_active_expiry
  ON meme_bots (expires_at)
  WHERE expires_at IS NOT NULL;
