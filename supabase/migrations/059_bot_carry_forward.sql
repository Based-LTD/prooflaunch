-- meme_bot_pending_balances: per-(bot, recipient) accumulator so the
-- distribute_sol_holders / distribute_sol_backers bot stops silently
-- discarding small holders' shares due to the per-recipient dust floor.
--
-- BACKGROUND (caught 2026-06-25):
-- The bot's executeSolDistribute path skips any recipient whose pro-rata
-- share for a single run falls below MIN_SOL_RECIPIENT_LAMPORTS
-- (1_000_000 = 0.001 SOL). At low fee accrual rates (most launches when
-- volume is sleepy), the per-run pot is so small that ~99% of holders'
-- shares fall below the floor. With no carry-forward, those shares were
-- recycled back into the next run's pot — which then continued paying
-- only the top 1-2 holders. Net effect: same whales paid every cycle,
-- everyone else got nothing for as long as the bot ran. Customers
-- inevitably looked at the chain and concluded "rug" / "broken indexer."
--
-- This table mirrors holder_pending_balances (used by the daily PROOF
-- airdrop) but is scoped per-bot rather than global. Same pattern, same
-- semantics: every recipient eventually gets paid in proportion to their
-- token weight, averaged over however many runs it takes to cross floor.
--
-- After this migration ships, executeSolDistribute reads + writes here
-- in the same transaction as broadcasting payouts. Pre-existing dust
-- that was already lost is gone (no historical records to replay), so
-- a one-time make-good seed script handles back-pay for affected memes.

CREATE TABLE IF NOT EXISTS meme_bot_pending_balances (
  bot_id UUID NOT NULL REFERENCES meme_bots(id) ON DELETE CASCADE,
  wallet TEXT NOT NULL,
  pending_lamports BIGINT NOT NULL DEFAULT 0,
  total_accrued_lamports BIGINT NOT NULL DEFAULT 0,
  total_paid_lamports BIGINT NOT NULL DEFAULT 0,
  payout_count INTEGER NOT NULL DEFAULT 0,
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (bot_id, wallet)
);

CREATE INDEX IF NOT EXISTS meme_bot_pending_wallet_idx
  ON meme_bot_pending_balances(wallet);

-- Public read for transparency: any holder can query their own
-- pending balance + lifetime totals against any bot. Writes are
-- service-role only (the bot itself), no policy needed for that.
-- Mirrors the policy on holder_pending_balances (migration 023).
ALTER TABLE meme_bot_pending_balances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read bot pending balances" ON meme_bot_pending_balances
  FOR SELECT USING (true);
