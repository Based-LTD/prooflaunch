-- Migration: pre-ground vanity keypair pool.
--
-- Grinding a vanity address (~33min/keypair for a 4-char suffix) is far
-- too slow to do at launch time, so we pre-grind a batch offline with
-- solana-keygen grind, AES-encrypt the secret (same scheme as burner
-- keys), and store them here. Launches / pool-wallet creation atomically
-- consume one unused row.
--
-- The pool wallet is the wallet scanners auto-tag "Developer" (it signs
-- createV2 + buys). A recognizable `...pool` address + a documented,
-- consistent pattern is what makes that read as the transparent Proof
-- pool rather than a rug dev.

CREATE TABLE IF NOT EXISTS vanity_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  public_key TEXT NOT NULL UNIQUE,
  encrypted_private_key TEXT NOT NULL,   -- aes:<iv>:<tag>:<ct> of bs58 secret
  suffix TEXT NOT NULL,                  -- e.g. 'pool' or 'pump'
  used BOOLEAN NOT NULL DEFAULT FALSE,
  used_by TEXT,                          -- meme id / context that claimed it
  used_at TIMESTAMPTZ
);

-- Fast lookup of the next unused keypair for a given suffix
CREATE INDEX IF NOT EXISTS idx_vanity_unused
  ON vanity_wallets (suffix, created_at) WHERE used = FALSE;

-- Service role only (API uses service key, bypasses RLS). Enabling RLS
-- with no policies hides encrypted keys from the anon key entirely.
ALTER TABLE vanity_wallets ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE vanity_wallets IS 'Pre-ground vanity keypair pool (encrypted), consumed one per launch/pool-wallet';
COMMENT ON COLUMN vanity_wallets.encrypted_private_key IS 'AES-256-GCM of the bs58-encoded secret key (same scheme as backings.encrypted_private_key)';
