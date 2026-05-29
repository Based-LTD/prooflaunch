-- Phase B hardening — vault withdrawal audit + replay protection.
--
-- Two tables:
--
--   1. bot_withdrawal_nonces — atomic dedupe for signed withdraw requests.
--      Each /api/bots/[id]/withdraw call must include a UUID nonce that
--      we INSERT here first; the UNIQUE PK is the lock. A replayed
--      signed payload fails the insert and the withdrawal is aborted
--      before any key is decrypted. Pruned periodically by cron.
--
--   2. meme_bot_withdrawals — immutable, append-only audit trail of
--      every executed withdrawal. Public-read RLS (so anyone can audit
--      what flowed out of any vault); no UPDATE / DELETE policies
--      (Supabase RLS deny-by-default already blocks these).
--
-- Both tables are safe to re-run (IF NOT EXISTS guards).

CREATE TABLE IF NOT EXISTS bot_withdrawal_nonces (
  nonce       TEXT PRIMARY KEY,
  bot_id      UUID NOT NULL REFERENCES meme_bots(id) ON DELETE CASCADE,
  used_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bot_withdrawal_nonces_used_at
  ON bot_withdrawal_nonces (used_at);

COMMENT ON TABLE bot_withdrawal_nonces IS
  'Single-use nonces for vault withdrawal requests. INSERT-or-fail provides atomic replay protection. Safe to prune rows > 24h old.';

CREATE TABLE IF NOT EXISTS meme_bot_withdrawals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id        UUID NOT NULL REFERENCES meme_bots(id) ON DELETE CASCADE,
  meme_id       UUID NOT NULL REFERENCES memes(id) ON DELETE CASCADE,
  -- Pubkey that signed the withdrawal request (always meme.creator_wallet
  -- at the time of withdrawal, but we record it independently so the
  -- audit trail is immutable even if creator_wallet ever changes).
  signer_wallet TEXT NOT NULL,
  destination   TEXT NOT NULL,
  asset         TEXT NOT NULL CHECK (asset IN ('sol', 'token')),
  -- Raw amount: lamports for SOL, mint base-units for token. Stored as
  -- NUMERIC to handle any token decimal scheme without precision loss.
  amount_raw    NUMERIC NOT NULL,
  tx_signature  TEXT NOT NULL,
  nonce         TEXT NOT NULL,
  signed_at     TIMESTAMPTZ NOT NULL,   -- ts from inside the signed message
  executed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meme_bot_withdrawals_bot
  ON meme_bot_withdrawals (bot_id);
CREATE INDEX IF NOT EXISTS idx_meme_bot_withdrawals_meme
  ON meme_bot_withdrawals (meme_id);
CREATE INDEX IF NOT EXISTS idx_meme_bot_withdrawals_executed_at
  ON meme_bot_withdrawals (executed_at);

COMMENT ON TABLE meme_bot_withdrawals IS
  'Immutable audit trail of creator-initiated vault withdrawals. Public-read; never UPDATEd or DELETEd by app code.';

-- RLS — public read for both transparency (withdrawals) and audit
-- (nonces are sensitive: leaking them could let an attacker fish for
-- timing patterns, so nonces are server-only).
ALTER TABLE meme_bot_withdrawals ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_withdrawal_nonces ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "withdrawals are public read"
    ON meme_bot_withdrawals FOR SELECT TO anon, authenticated
    USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- No SELECT/INSERT policies for bot_withdrawal_nonces — only the
-- service-role key (server-side) can touch it. Default deny.
