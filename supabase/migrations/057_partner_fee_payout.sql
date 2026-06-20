-- 057 — Partner rev-share payout plumbing.
--
-- The 025 partner_api migration added partner attribution to memes
-- (memes.partner_id) and stored the partner's rev_share_bps on the
-- partners row. What it DIDN'T add — and what this migration fills —
-- is the SOL-flow side: a per-meme running total of how much SOL has
-- been paid out to the partner, and an append-only ledger of every
-- single payout tx so the partner dashboard can render line items.
--
-- distribution.ts will, on every fee drain for a meme with a partner:
--   1. compute partner_share = platformLamports × (rev_share_bps / 10000)
--   2. SystemProgram.transfer that amount from escrow → partners.partner_wallet
--   3. UPDATE memes SET partner_fee_lamports = partner_fee_lamports + share
--   4. INSERT into partner_payouts with the tx sig + amount + meme_id
--
-- The platform retains (platformLamports - partner_share) as before.

ALTER TABLE memes
  ADD COLUMN IF NOT EXISTS partner_fee_lamports BIGINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN memes.partner_fee_lamports IS
  'Cumulative SOL (lamports) paid out to this meme''s partner via rev-share. Mirrors what the partner has received from THIS specific launch; aggregate across the partner''s launches via SUM(partner_fee_lamports) WHERE partner_id = X.';

-- Per-payout ledger. One row per drain tick where the partner got paid.
-- Lets the partner dashboard show "you earned X SOL from Y launches, here
-- are the txs." Foreign keys make orphans impossible.
CREATE TABLE IF NOT EXISTS partner_payouts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id      UUID NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,
  meme_id         UUID NOT NULL REFERENCES memes(id) ON DELETE RESTRICT,
  -- The drain event that triggered this payout. NULL = we couldn't
  -- correlate (shouldn't happen but defensive).
  drain_sig       TEXT,
  -- The transfer tx that moved SOL from escrow → partner_wallet.
  -- NULL until the transfer actually confirms; lets us insert the
  -- ledger row in the same supabase mutation as the source drain.
  transfer_sig    TEXT,
  -- Snapshot of the partner_wallet at payout time. Lets the partner
  -- see "your old wallet got paid this much, your new wallet got paid
  -- that much" if they ever rotate payout_wallet.
  payout_wallet   TEXT NOT NULL,
  -- The slice: platformLamports × rev_share_bps / 10000.
  amount_lamports BIGINT NOT NULL CHECK (amount_lamports >= 0),
  -- For traceability — what % was applied at the time.
  rev_share_bps   INT NOT NULL,
  -- For traceability — what platformLamports was, before the split.
  platform_lamports_at_payout BIGINT NOT NULL,
  -- Status flips to 'sent' on confirm, 'failed' on tx error. 'pending'
  -- exists for the brief window between INSERT and confirmTransaction
  -- so we never lose track of a payout that's mid-flight.
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'sent', 'failed')),
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_partner_payouts_partner_time
  ON partner_payouts(partner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_partner_payouts_meme
  ON partner_payouts(meme_id);
CREATE INDEX IF NOT EXISTS idx_partner_payouts_status
  ON partner_payouts(status) WHERE status != 'sent';

COMMENT ON TABLE partner_payouts IS
  'Append-only ledger of rev-share payouts from escrow to partner wallets. One row per drain tick per meme that has a partner. Source of truth for partner earnings reporting.';

-- RLS — partner_payouts is operational, not public. Service-role only.
ALTER TABLE partner_payouts ENABLE ROW LEVEL SECURITY;
