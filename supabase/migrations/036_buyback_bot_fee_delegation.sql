-- Phase 5 — Fee-delegation buyback bot.
--
-- Replaces the broken Phase 3 model (where the bot drained
-- creator_claimable_fees_sol, a legacy column that's no longer
-- populated in the post-Phase-2 fee flow — so the bot was always idle
-- in production).
--
-- New model: when the creator enables the buyback bot, they also pick
-- a "fee delegation %" — the slice of the BACKER POOL (the 90% that
-- normally goes to backers) that gets routed to the bot wallet
-- instead. Platform's 10% stays fixed.
--
-- Example values:
--   bot_fee_pct = 0   → 90% backers / 10% platform / 0% bot (default)
--   bot_fee_pct = 25  → 67.5% backers / 10% platform / 22.5% bot
--   bot_fee_pct = 50  → 45% backers / 10% platform / 45% bot
--   bot_fee_pct = 100 → 0% backers / 10% platform / 90% bot
--
-- Backers explicitly trade fee yield for token-supply pressure (the
-- bot will buy + burn / hold per the configured action). Each launch
-- card on Proof Launch shows the split so backers know what they're
-- buying into.
--
-- The distribution code transfers the bot's share to the bot wallet on
-- chain at fee-collection time; the buyback cron then drains the bot
-- wallet's on-chain balance directly.

ALTER TABLE memes
  ADD COLUMN IF NOT EXISTS buyback_bot_fee_pct NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE memes
  DROP CONSTRAINT IF EXISTS memes_buyback_bot_fee_pct_range;
ALTER TABLE memes
  ADD CONSTRAINT memes_buyback_bot_fee_pct_range CHECK (
    buyback_bot_fee_pct >= 0 AND buyback_bot_fee_pct <= 100
  );

COMMENT ON COLUMN memes.buyback_bot_fee_pct IS
  'Percent of the 90% backer pool routed to the buyback bot wallet (0-100). Only meaningful when buyback_bot_enabled=true. Backers receive (90% × (100 - bot_fee_pct)/100) of trading fees; bot receives (90% × bot_fee_pct/100); platform keeps fixed 10%.';
