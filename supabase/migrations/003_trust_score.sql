-- Add trust score parameters to memes table
-- These parameters are set by the creator and determine the trust score

-- Creator fee percentage (0-10%)
-- Lower = more trust
ALTER TABLE memes ADD COLUMN IF NOT EXISTS creator_fee_pct DECIMAL(4,2) DEFAULT 2.0;

-- Genesis backer share percentage (50-90%)
-- Higher = more trust
ALTER TABLE memes ADD COLUMN IF NOT EXISTS backer_share_pct DECIMAL(4,2) DEFAULT 70.0;

-- Dev's planned initial buy in SOL (0 = no dev snipe)
-- Lower = more trust
ALTER TABLE memes ADD COLUMN IF NOT EXISTS dev_initial_buy_sol DECIMAL(10,4) DEFAULT 0;

-- Whether refunds are automatic on failure (true = more trust)
ALTER TABLE memes ADD COLUMN IF NOT EXISTS auto_refund BOOLEAN DEFAULT true;

-- Calculated trust score (0-100)
-- Computed from above parameters
ALTER TABLE memes ADD COLUMN IF NOT EXISTS trust_score INTEGER DEFAULT 75;

-- Add constraints
ALTER TABLE memes ADD CONSTRAINT check_creator_fee_range
  CHECK (creator_fee_pct >= 0 AND creator_fee_pct <= 10);

ALTER TABLE memes ADD CONSTRAINT check_backer_share_range
  CHECK (backer_share_pct >= 50 AND backer_share_pct <= 90);

ALTER TABLE memes ADD CONSTRAINT check_dev_buy_non_negative
  CHECK (dev_initial_buy_sol >= 0);

ALTER TABLE memes ADD CONSTRAINT check_trust_score_range
  CHECK (trust_score >= 0 AND trust_score <= 100);

-- Create index for filtering by trust score
CREATE INDEX IF NOT EXISTS idx_memes_trust_score ON memes(trust_score DESC);

-- Comment on columns for documentation
COMMENT ON COLUMN memes.creator_fee_pct IS 'Creator fee percentage (0-10%). Lower fees = higher trust score.';
COMMENT ON COLUMN memes.backer_share_pct IS 'Genesis backer share of trading fees (50-90%). Higher share = higher trust score.';
COMMENT ON COLUMN memes.dev_initial_buy_sol IS 'Dev planned initial buy in SOL. 0 = no dev snipe = highest trust.';
COMMENT ON COLUMN memes.auto_refund IS 'If true, backers auto-refunded on failure. True = higher trust.';
COMMENT ON COLUMN memes.trust_score IS 'Calculated trust score 0-100 based on creator parameters.';
