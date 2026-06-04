-- 049 — POOL_FEEDER bot (auto-LP / protocol-owned liquidity).
--
-- New programmable-tokenomics action: `feed_lp`. The bot accumulates SOL
-- like every other bot in the stack. When the meme's underlying token
-- has GRADUATED (its bonding curve completed and a real AMM pool exists),
-- the bot deploys: swap half SOL → tokens, deposit both into the AMM as
-- a liquidity position, hold the resulting LP NFT / LP token in the
-- bot's own wallet permanently.
--
-- The result: every accumulated batch deepens the pool's liquidity.
-- Trading fees on the new LP position accrue to the bot wallet
-- automatically (the position keeps earning forever).
--
-- Pre-graduation behavior: SOL accumulates in the bot wallet, no LP
-- action taken. Logged each cron tick so creators see "waiting for
-- graduation" status. Most tokens never graduate, so this bot may
-- sit dormant on many launches.
--
-- Single-instance per meme (same UNIQUE rule as burn / distribute_* —
-- two POOL_FEEDER bots would collapse into one). Distinct from HOLD
-- (vault) and DONATE which support multiple per meme.

DO $$ BEGIN
  ALTER TYPE buyback_bot_action ADD VALUE IF NOT EXISTS 'feed_lp';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Per-meme LP position tracking ─────────────────────────────────
-- When the bot deploys, it records the LP position address (PumpSwap
-- LP token mint OR Meteora DAMM v2 position NFT) so the UI / audits
-- can show "this bot owns N LP positions across N batches."
--
-- Multiple rows per bot allowed — every accumulation batch creates a
-- new position (or, for fungible LP tokens, increases the existing
-- position; we record each event).

CREATE TABLE IF NOT EXISTS bot_lp_deployments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id            UUID NOT NULL REFERENCES meme_bots(id) ON DELETE CASCADE,
  meme_id           UUID NOT NULL REFERENCES memes(id) ON DELETE CASCADE,
  platform          TEXT NOT NULL,                       -- 'pumpfun' | 'meteora'
  amm_pool_address  TEXT NOT NULL,                       -- PumpSwap pool / DAMM v2 pool
  position_address  TEXT NOT NULL,                       -- LP-token mint OR position NFT
  sol_deposited     NUMERIC(20, 9) NOT NULL,             -- total SOL value at deposit
  tokens_deposited  NUMERIC(30, 9) NOT NULL,             -- token amount paired
  swap_signature    TEXT,                                -- the half-SOL-to-tokens swap tx
  deposit_signature TEXT NOT NULL,                       -- the LP-add tx
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bot_lp_deployments_bot ON bot_lp_deployments (bot_id);
CREATE INDEX IF NOT EXISTS idx_bot_lp_deployments_meme ON bot_lp_deployments (meme_id);
CREATE INDEX IF NOT EXISTS idx_bot_lp_deployments_created ON bot_lp_deployments (created_at DESC);

COMMENT ON TABLE bot_lp_deployments IS
  'Append-only ledger of POOL_FEEDER bot LP deposits. Each row = one half-SOL-swap + LP-add event. Used by /api/memes/[id] to surface "this bot has deepened the pool N times for X SOL of cumulative liquidity."';

ALTER TABLE bot_lp_deployments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read bot_lp_deployments" ON bot_lp_deployments;
CREATE POLICY "Public read bot_lp_deployments" ON bot_lp_deployments
  FOR SELECT USING (true);
