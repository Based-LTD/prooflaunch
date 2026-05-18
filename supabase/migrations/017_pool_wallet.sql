-- Migration: pooled-launch model.
--
-- Old model: every backing had its own client-generated burner wallet;
-- the launch did N separate buys (the multi-day Jito/sniper nightmare).
--
-- New model (on-chain-proven): each meme has ONE pool wallet (a
-- pre-ground `...pool` vanity address). Backers fund the pool. Launch
-- is ONE atomic createV2+buy from the pool (zero sniper gap, dev holds
-- 0%). Tokens are then distributed proportionally to backers, who claim.
--
-- backings.burner_wallet / encrypted_private_key remain for legacy
-- memes; new memes use the meme-level pool wallet instead.

ALTER TABLE memes ADD COLUMN IF NOT EXISTS pool_wallet TEXT;
ALTER TABLE memes ADD COLUMN IF NOT EXISTS encrypted_pool_key TEXT;
ALTER TABLE memes ADD COLUMN IF NOT EXISTS pool_token_balance NUMERIC;  -- tokens the pool bought at launch (for proportional split)

-- Per-backing claim tracking (proportional distribution from the pool)
ALTER TABLE backings ADD COLUMN IF NOT EXISTS claim_tokens NUMERIC;     -- this backer's computed allocation
ALTER TABLE backings ADD COLUMN IF NOT EXISTS claim_tx TEXT;            -- distribution signature (idempotency key)
ALTER TABLE backings ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_backings_unclaimed
  ON backings (meme_id) WHERE claim_tx IS NULL;

COMMENT ON COLUMN memes.pool_wallet IS 'Per-meme vanity (...pool) wallet that backers fund and that does the atomic createV2+buy';
COMMENT ON COLUMN memes.encrypted_pool_key IS 'AES-256-GCM of the pool wallet bs58 secret (same scheme as burner keys)';
COMMENT ON COLUMN backings.claim_tx IS 'Distribution tx signature; presence = already distributed (idempotent)';
