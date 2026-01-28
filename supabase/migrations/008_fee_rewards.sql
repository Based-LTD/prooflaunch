-- Fee rewards tracking for ProofLaunch
-- Tracks creator fees from pump.fun trading that flow to escrow

-- Table to track total fees accrued per launched token
CREATE TABLE IF NOT EXISTS token_fees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meme_id UUID NOT NULL REFERENCES memes(id) ON DELETE CASCADE,
  mint_address TEXT NOT NULL,
  total_fees_sol DECIMAL(20, 9) DEFAULT 0,
  last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(meme_id),
  UNIQUE(mint_address)
);

-- Table to track individual fee claims by backers/creators
CREATE TABLE IF NOT EXISTS fee_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meme_id UUID NOT NULL REFERENCES memes(id) ON DELETE CASCADE,
  wallet_address TEXT NOT NULL,
  amount_sol DECIMAL(20, 9) NOT NULL,
  claim_tx TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE
);

-- Table to track fee transactions from pump.fun (for audit trail)
CREATE TABLE IF NOT EXISTS fee_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meme_id UUID REFERENCES memes(id) ON DELETE CASCADE,
  mint_address TEXT NOT NULL,
  tx_signature TEXT NOT NULL UNIQUE,
  amount_sol DECIMAL(20, 9) NOT NULL,
  processed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add claimable_fees column to backings to track each backer's unclaimed fees
ALTER TABLE backings ADD COLUMN IF NOT EXISTS claimable_fees_sol DECIMAL(20, 9) DEFAULT 0;
ALTER TABLE backings ADD COLUMN IF NOT EXISTS total_claimed_sol DECIMAL(20, 9) DEFAULT 0;

-- Add creator claimable fees to memes table
ALTER TABLE memes ADD COLUMN IF NOT EXISTS creator_claimable_fees_sol DECIMAL(20, 9) DEFAULT 0;
ALTER TABLE memes ADD COLUMN IF NOT EXISTS creator_total_claimed_sol DECIMAL(20, 9) DEFAULT 0;

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_token_fees_mint ON token_fees(mint_address);
CREATE INDEX IF NOT EXISTS idx_fee_claims_wallet ON fee_claims(wallet_address);
CREATE INDEX IF NOT EXISTS idx_fee_transactions_mint ON fee_transactions(mint_address);

-- View to show backer rewards status
CREATE OR REPLACE VIEW backer_rewards AS
SELECT
  b.id as backing_id,
  b.meme_id,
  b.backer_wallet,
  b.amount_sol as backing_amount,
  b.claimable_fees_sol,
  b.total_claimed_sol,
  m.name as meme_name,
  m.symbol as meme_symbol,
  m.mint_address,
  m.backer_share_pct,
  tf.total_fees_sol as token_total_fees
FROM backings b
JOIN memes m ON b.meme_id = m.id
LEFT JOIN token_fees tf ON m.id = tf.meme_id
WHERE b.status = 'distributed' AND m.status = 'live';
