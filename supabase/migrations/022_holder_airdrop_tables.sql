-- Daily PROOF-holder airdrop tracking tables.
--
-- holder_distributions: one row per daily distribution. epoch_date UNIQUE is
-- the idempotency gate — if today's row already exists, the airdrop cron
-- bails out before broadcasting anything.
--
-- holder_distribution_payouts: one row per wallet per distribution. Updated
-- in-place as each batch transfer confirms (pending → sent | failed).

CREATE TABLE IF NOT EXISTS holder_distributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  distributed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  epoch_date DATE NOT NULL UNIQUE,                   -- idempotency: 1 row per day max
  total_sol_lamports BIGINT NOT NULL,
  holder_count INT NOT NULL,
  eligible_supply_tokens NUMERIC NOT NULL,           -- UI-amount (PROOF, 6 decimals)
  status TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'completed', 'partial', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS holder_distribution_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  distribution_id UUID NOT NULL REFERENCES holder_distributions(id) ON DELETE CASCADE,
  wallet TEXT NOT NULL,
  proof_balance NUMERIC NOT NULL,                    -- UI-amount of PROOF held at snapshot
  share_lamports BIGINT NOT NULL,                    -- SOL share in lamports
  tx_sig TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_holder_payouts_distribution ON holder_distribution_payouts(distribution_id);
CREATE INDEX IF NOT EXISTS idx_holder_payouts_wallet ON holder_distribution_payouts(wallet);
CREATE INDEX IF NOT EXISTS idx_holder_distributions_epoch ON holder_distributions(epoch_date DESC);

-- RLS: distributions + payouts are PUBLIC-READ (transparency) but
-- only service_role writes.
ALTER TABLE holder_distributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE holder_distribution_payouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read distributions" ON holder_distributions
  FOR SELECT USING (true);
CREATE POLICY "Public read payouts" ON holder_distribution_payouts
  FOR SELECT USING (true);
