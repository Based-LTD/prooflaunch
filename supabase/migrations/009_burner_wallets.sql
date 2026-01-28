-- Migration: Burner wallets for organic token distribution
-- Each backer generates a fresh keypair that we can use to execute real buys
-- This makes token distribution look organic on-chain instead of like a rug pull

-- Add burner wallet fields to backings
-- Private key is encrypted server-side before storage
ALTER TABLE backings ADD COLUMN IF NOT EXISTS burner_wallet TEXT;
ALTER TABLE backings ADD COLUMN IF NOT EXISTS encrypted_private_key TEXT;

-- Track whether the burner buy has been executed
ALTER TABLE backings ADD COLUMN IF NOT EXISTS burner_buy_executed BOOLEAN DEFAULT FALSE;
ALTER TABLE backings ADD COLUMN IF NOT EXISTS burner_buy_signature TEXT;

-- Track sweep status (when user moves tokens/SOL from burner to main wallet)
ALTER TABLE backings ADD COLUMN IF NOT EXISTS swept BOOLEAN DEFAULT FALSE;
ALTER TABLE backings ADD COLUMN IF NOT EXISTS sweep_action TEXT; -- 'sell' or 'transfer'
ALTER TABLE backings ADD COLUMN IF NOT EXISTS sweep_signature TEXT;
ALTER TABLE backings ADD COLUMN IF NOT EXISTS swept_at TIMESTAMPTZ;

-- Index for looking up by burner wallet
CREATE INDEX IF NOT EXISTS idx_backings_burner_wallet ON backings(burner_wallet);

-- Comments
COMMENT ON COLUMN backings.burner_wallet IS 'Public key of the burner wallet created for this backer';
COMMENT ON COLUMN backings.encrypted_private_key IS 'Server-side encrypted private key of the burner wallet';
COMMENT ON COLUMN backings.burner_buy_executed IS 'Whether the buy from this burner wallet has been executed';
COMMENT ON COLUMN backings.burner_buy_signature IS 'Transaction signature of the buy from the burner wallet';
COMMENT ON COLUMN backings.swept IS 'Whether tokens have been swept from burner to main wallet';
COMMENT ON COLUMN backings.sweep_action IS 'Type of sweep: sell (tokens->SOL) or transfer (tokens->main)';
COMMENT ON COLUMN backings.sweep_signature IS 'Transaction signature of the sweep';
COMMENT ON COLUMN backings.swept_at IS 'Timestamp when tokens were swept';
