-- Phase 3 — Per-meme buyback bot.
--
-- Model: the bot is just another backer. The creator opts in at submit
-- time; at backing/launch the bot wallet takes one of the slots, gets a
-- token allocation, and accrues claimable_fees_sol like every other
-- backer through the existing fee-distribution path (collectAndCreditFees).
--
-- A new cron `/api/buyback/process` periodically:
--   1) Claims the bot's accumulated SOL from escrow to its wallet
--   2) Swaps SOL → meme token via Jupiter (PumpSwap route)
--   3) Executes the creator-chosen action:
--        burn               → SPL burnChecked the bought tokens
--        hold               → leave in bot wallet (treasury)
--        distribute_holders → snapshot + pro-rata transfer (Phase 3.1)
--        distribute_backers → pro-rata transfer to genesis backers (Phase 3.1)
--
-- distribute_* actions ship in a follow-up; the enum reserves the slot
-- so we don't have to migrate again. UI hides them as "Coming soon" for
-- now — same honesty principle as the fee-distribution presets.

-- ── memes table additions ─────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE buyback_bot_action AS ENUM ('burn', 'hold', 'distribute_holders', 'distribute_backers');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE memes
  ADD COLUMN IF NOT EXISTS buyback_bot_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS buyback_bot_action buyback_bot_action,
  ADD COLUMN IF NOT EXISTS buyback_bot_wallet TEXT,
  ADD COLUMN IF NOT EXISTS encrypted_buyback_bot_key TEXT,
  ADD COLUMN IF NOT EXISTS buyback_bot_last_run_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS buyback_bot_total_sol_spent NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS buyback_bot_total_tokens_acted NUMERIC NOT NULL DEFAULT 0;

-- If enabled, must have wallet + key + action.
ALTER TABLE memes
  DROP CONSTRAINT IF EXISTS memes_buyback_bot_complete;
ALTER TABLE memes
  ADD CONSTRAINT memes_buyback_bot_complete CHECK (
    NOT buyback_bot_enabled
    OR (buyback_bot_wallet IS NOT NULL
        AND encrypted_buyback_bot_key IS NOT NULL
        AND buyback_bot_action IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_memes_buyback_bot_enabled
  ON memes (buyback_bot_enabled) WHERE buyback_bot_enabled = TRUE;

-- ── meme_buybacks audit table ─────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE buyback_status AS ENUM ('completed', 'partial', 'failed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS meme_buybacks (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meme_id               UUID NOT NULL REFERENCES memes(id) ON DELETE CASCADE,
  executed_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  action                buyback_bot_action NOT NULL,
  sol_spent_lamports    BIGINT NOT NULL,
  tokens_bought_raw     NUMERIC NOT NULL,
  tokens_acted_raw      NUMERIC NOT NULL,        -- amount actually burned / held / distributed
  claim_tx              TEXT,                    -- claim escrow → bot wallet
  swap_tx               TEXT,                    -- Jupiter swap
  action_tx             TEXT,                    -- burn or transfer (NULL for hold)
  status                buyback_status NOT NULL DEFAULT 'completed',
  error                 TEXT,
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meme_buybacks_meme_executed
  ON meme_buybacks (meme_id, executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_meme_buybacks_status_executed
  ON meme_buybacks (status, executed_at DESC);

-- RLS: public-readable for transparency (matches proof_buybacks pattern),
-- writes only via service_role.
ALTER TABLE meme_buybacks ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Public read meme buybacks" ON meme_buybacks
    FOR SELECT USING (true);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TABLE meme_buybacks IS
  'Per-meme buyback bot execution log. One row per cron run that produced a swap. Public-readable for transparency.';
