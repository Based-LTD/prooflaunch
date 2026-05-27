-- Audit table for $PROOF buy-and-burn operations.
--
-- One row per buyback. Lets us:
--   - Surface "total burned" on the homepage ticker
--   - Reconcile vs Solscan for transparency
--   - Block accidental double-runs (executed_at + sol_spent dedupe at the app layer)
--
-- The script (tools/buy-and-burn.mjs) writes the row AFTER both txs confirm,
-- so a partial buy-without-burn is recorded as status='failed' and never
-- counts toward "total burned".

CREATE TABLE IF NOT EXISTS proof_buybacks (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  executed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sol_spent_lamports   BIGINT NOT NULL,                    -- raw lamports the script paid
  proof_bought_raw     NUMERIC NOT NULL,                   -- raw base units received from swap
  proof_burned_raw     NUMERIC NOT NULL,                   -- raw base units actually destroyed (== bought, unless dust)
  proof_decimals       INT NOT NULL DEFAULT 6,             -- locked to Token-2022's PROOF decimals
  swap_tx              TEXT NOT NULL,                       -- Jupiter swap signature
  burn_tx              TEXT NOT NULL,                       -- SPL burnChecked signature
  status               TEXT NOT NULL DEFAULT 'completed'
                        CHECK (status IN ('completed', 'failed')),
  notes                TEXT,                                -- optional human note ("monthly buyback round 1")
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proof_buybacks_executed ON proof_buybacks(executed_at DESC);

-- RLS: public-readable for transparency (ticker reads from anon key),
-- writes only via service_role.
ALTER TABLE proof_buybacks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read proof buybacks" ON proof_buybacks
  FOR SELECT USING (true);
