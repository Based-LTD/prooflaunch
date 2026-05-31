-- Phase B+ — DONATE bots (immutable fixed-destination payouts).
--
-- New bot pattern: every cycle the bot's accumulated fees flow to a
-- creator-named destination address. No swap-and-distribute, no creator
-- withdrawal — fire-and-forget transfer to a wallet committed at submit.
--
-- Use cases:
--   * Charity donations (commit X% of fees to a known charity wallet)
--   * DAO / team multisig revenue share
--   * Partner kickback
--   * Any "I publicly commit Y% of trading fees to address Z forever" pattern
--
-- Two action variants mirror the distribute_sol_* / distribute_tokens_*
-- pair: donate_sol skips the swap (direct SOL transfer), donate_tokens
-- swaps first then transfers the bought tokens.
--
-- IMMUTABILITY: destination_wallet is set at meme_bots INSERT and
-- never updated. Application code must reject any PATCH that would
-- change destination. This is the entire commitment value of DONATE
-- vs VAULT: the creator publicly burns the optionality to redirect.
--
-- Multiple donate bots per meme are allowed (one per distinct asset+
-- destination combo) — same spirit as labeled VAULTs being unlimited.
--
-- Safe to re-run.

-- ── 1. Extend the buyback_bot_action enum ──────────────────────────
DO $$ BEGIN
  ALTER TYPE buyback_bot_action ADD VALUE IF NOT EXISTS 'donate_sol';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE buyback_bot_action ADD VALUE IF NOT EXISTS 'donate_tokens';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2. Add destination_wallet column ───────────────────────────────
ALTER TABLE meme_bots
  ADD COLUMN IF NOT EXISTS destination_wallet TEXT;

COMMENT ON COLUMN meme_bots.destination_wallet IS
  'Fixed payout destination for donate_sol / donate_tokens bots. Solana base58 pubkey, 32 bytes. Required for donate_*, NULL for everything else. IMMUTABLE — application code must reject PATCHes that would change it. Length CHECK keeps obviously-bad inputs out at the DB layer too.';

-- ── 3. Update CHECK constraints ────────────────────────────────────
--
-- Drop the existing label-only check and replace with one that ALSO
-- enforces destination_wallet rules. Single composite CHECK is easier
-- to reason about than two correlated ones.

ALTER TABLE meme_bots DROP CONSTRAINT IF EXISTS meme_bots_label_check;

DO $$ BEGIN
  ALTER TABLE meme_bots ADD CONSTRAINT meme_bots_action_field_check
    CHECK (
      -- HOLD (vault): requires label, no destination
      (action = 'hold' AND
        label IS NOT NULL AND char_length(label) BETWEEN 1 AND 24
                          AND label ~ '^[A-Za-z0-9 _\-]+$'
        AND destination_wallet IS NULL)
      OR
      -- DONATE: requires destination (32-44 base58 chars), label optional
      (action IN ('donate_sol', 'donate_tokens') AND
        destination_wallet IS NOT NULL
        AND char_length(destination_wallet) BETWEEN 32 AND 44
        AND destination_wallet ~ '^[1-9A-HJ-NP-Za-km-z]+$'
        AND (label IS NULL OR
             (char_length(label) BETWEEN 1 AND 24 AND label ~ '^[A-Za-z0-9 _\-]+$')))
      OR
      -- Everything else (burn, distribute_*, legacy): no label, no destination
      (action NOT IN ('hold', 'donate_sol', 'donate_tokens')
        AND label IS NULL AND destination_wallet IS NULL)
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 4. Update uniqueness ───────────────────────────────────────────
--
-- Existing partial unique index `meme_bots_meme_action_nonhold_uq`
-- on (meme_id, action) WHERE action != 'hold' — needs to also exclude
-- donate actions because multiple donate bots with different
-- destinations are valid.
--
-- New: prevent two donate bots of the same action sending to the same
-- destination from the same meme (would just collapse into one).

DROP INDEX IF EXISTS meme_bots_meme_action_nonhold_uq;

DO $$ BEGIN
  -- Uniqueness for "single-instance" actions (burn, distribute_*).
  CREATE UNIQUE INDEX meme_bots_meme_action_single_uq
    ON meme_bots (meme_id, action)
    WHERE action NOT IN ('hold', 'donate_sol', 'donate_tokens');
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

DO $$ BEGIN
  -- Prevent duplicate donate bots (same asset + same destination
  -- from the same meme).
  CREATE UNIQUE INDEX meme_bots_donate_dest_uq
    ON meme_bots (meme_id, action, destination_wallet)
    WHERE action IN ('donate_sol', 'donate_tokens');
EXCEPTION WHEN duplicate_table THEN NULL; END $$;
