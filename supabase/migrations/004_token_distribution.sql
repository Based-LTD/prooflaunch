-- Add token distribution tracking to backings table
-- These columns track when tokens are distributed to backers after launch

-- Number of tokens received by the backer
ALTER TABLE backings ADD COLUMN IF NOT EXISTS tokens_received BIGINT DEFAULT 0;

-- Transaction signature for the token distribution
ALTER TABLE backings ADD COLUMN IF NOT EXISTS distribution_tx TEXT;

-- Update status enum to include 'distributed'
-- Status flow: pending -> confirmed -> distributed (after launch)
-- Note: The status column already exists, we just need to allow 'distributed' as a value

-- Add index for querying distributed backings
CREATE INDEX IF NOT EXISTS idx_backings_status ON backings(status);

-- Comment on new columns
COMMENT ON COLUMN backings.tokens_received IS 'Number of tokens received by the backer after launch distribution';
COMMENT ON COLUMN backings.distribution_tx IS 'Transaction signature for the token distribution to this backer';
