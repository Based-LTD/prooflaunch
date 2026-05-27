-- Carry-forward accumulator for the daily PROOF holder airdrop.
--
-- Problem: with the daily airdrop pool currently ~0.3-1 SOL and ~411 holders,
-- the median wallet's pro-rata share is below the 0.001 SOL dust floor.
-- They'd get zero each day forever even though their PROOF holding is real.
--
-- Fix: instead of dropping below-floor shares, ACCUMULATE them per-wallet in
-- this table. Each daily run adds the wallet's share to its pending balance.
-- When the pending balance crosses the dust floor on any day, the cron pays
-- out the accumulated total and resets the pending balance to 0.
--
-- Net effect: every holder eventually gets paid, in proportion to their
-- holdings averaged over the period it takes their balance to cross floor.
-- Gas-efficient (one tx when above floor), fair (pro-rata always honored),
-- and on-brand (no holder is "too small to count").

CREATE TABLE IF NOT EXISTS holder_pending_balances (
  wallet TEXT PRIMARY KEY,
  pending_lamports BIGINT NOT NULL DEFAULT 0
    CHECK (pending_lamports >= 0),
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Lifetime tracking for transparency / future dashboard
  total_accrued_lamports BIGINT NOT NULL DEFAULT 0,
  total_paid_lamports BIGINT NOT NULL DEFAULT 0,
  payout_count INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_holder_pending_updated
  ON holder_pending_balances(last_updated DESC);

-- Index for finding wallets above floor (helps the cron quickly find what
-- to pay out)
CREATE INDEX IF NOT EXISTS idx_holder_pending_above_floor
  ON holder_pending_balances(pending_lamports DESC);

-- Public read for transparency dashboards
ALTER TABLE holder_pending_balances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read pending balances" ON holder_pending_balances
  FOR SELECT USING (true);
