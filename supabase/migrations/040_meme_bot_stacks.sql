-- Phase B — Multi-bot stacks ("Programmable Tokenomics" v2).
--
-- Refactors the single-bot-per-meme architecture into a 1:N stack.
-- Each meme can have up to 6 bots (one per distinct action), each with
-- its own fee delegation %, its own dedicated wallet, and its own
-- on-chain execution path. Stacks let creators design economic engines:
--
--   Deflationary Yield  = BURN 30% + SOL→HOLDERS 20%
--   OG Loyalty          = TOKENS→BACKERS 15% + SOL→BACKERS 15%
--   Community First     = TOKENS→HOLDERS 25% + SOL→HOLDERS 15% + BURN 10%
--   Treasury Build      = HOLD 40%
--
-- Per-bot wallets (not shared per meme) so each bot is a self-contained
-- auditable unit on Solscan — "this address is BURN, this address is
-- SOL→HOLDERS" — cleaner than DB-tracked accounting across one shared
-- wallet.
--
-- Backwards compat: the old memes.buyback_bot_* columns stay (data
-- preserved) but the cron stops reading from them after this migration.
-- All existing single-bot memes get backfilled into meme_bots so they
-- continue running on the new path.

CREATE TABLE IF NOT EXISTS meme_bots (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meme_id             UUID NOT NULL REFERENCES memes(id) ON DELETE CASCADE,
  slot_order          INT NOT NULL DEFAULT 0,
  action              buyback_bot_action NOT NULL,
  fee_pct             NUMERIC NOT NULL CHECK (fee_pct >= 5 AND fee_pct <= 90),
  bot_wallet          TEXT NOT NULL,
  encrypted_bot_key   TEXT NOT NULL,
  last_run_at         TIMESTAMPTZ,
  total_sol_spent     NUMERIC NOT NULL DEFAULT 0,
  total_tokens_acted  NUMERIC NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One of each action per meme — no point in two BURN bots, they'd
  -- collapse into one anyway. UI enforces; this guarantees.
  UNIQUE (meme_id, action),

  -- Unique wallet per bot — extra safety against accidental key reuse.
  UNIQUE (bot_wallet)
);

CREATE INDEX IF NOT EXISTS idx_meme_bots_meme         ON meme_bots (meme_id);
CREATE INDEX IF NOT EXISTS idx_meme_bots_action       ON meme_bots (action);
CREATE INDEX IF NOT EXISTS idx_meme_bots_last_run     ON meme_bots (last_run_at);

COMMENT ON TABLE meme_bots IS
  'Per-meme bot stack. Each row = one bot delegating fee_pct% of trading fees to action. Per-bot wallet for self-contained on-chain auditing.';

-- Link the audit table to specific bots so creators can drill down
-- ("show me every BURN run for this token").
ALTER TABLE meme_buybacks
  ADD COLUMN IF NOT EXISTS bot_id UUID REFERENCES meme_bots(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_meme_buybacks_bot ON meme_buybacks (bot_id);

-- Backfill existing single-bot memes into meme_bots so they continue
-- running on the new path. The old buyback_bot_* columns on memes
-- stay populated (we just don't read from them after this).
INSERT INTO meme_bots (
  meme_id, slot_order, action, fee_pct, bot_wallet, encrypted_bot_key,
  last_run_at, total_sol_spent, total_tokens_acted, created_at
)
SELECT
  id,
  0,
  buyback_bot_action,
  GREATEST(LEAST(buyback_bot_fee_pct, 90), 5),  -- clamp to new range
  buyback_bot_wallet,
  encrypted_buyback_bot_key,
  buyback_bot_last_run_at,
  COALESCE(buyback_bot_total_sol_spent, 0),
  COALESCE(buyback_bot_total_tokens_acted, 0),
  created_at
FROM memes
WHERE buyback_bot_enabled = TRUE
  AND buyback_bot_action IS NOT NULL
  AND buyback_bot_wallet IS NOT NULL
  AND encrypted_buyback_bot_key IS NOT NULL
  AND buyback_bot_fee_pct >= 5
ON CONFLICT (meme_id, action) DO NOTHING;
