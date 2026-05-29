-- Phase A — Bot action vocabulary expansion ("Programmable Tokenomics").
--
-- Currently the buyback bot supports 4 enum values, but only 2 are
-- wired in the executor (burn, hold). The other two (distribute_holders,
-- distribute_backers) were placeholders that just parked SOL.
--
-- This migration extends the enum with explicit token-vs-SOL variants
-- so creators can pick from a real menu. The existing executor code
-- will be rewritten to actually implement each branch.
--
-- New enum values:
--   distribute_tokens_holders — buy tokens, distribute pro-rata to all
--                                current on-chain holders
--   distribute_tokens_backers — buy tokens, distribute pro-rata to
--                                genesis backers (launch participants)
--   distribute_sol_holders    — skip the swap, send delegated SOL
--                                pro-rata to current holders
--   distribute_sol_backers    — skip the swap, send delegated SOL
--                                pro-rata to genesis backers
--
-- The pre-existing distribute_holders / distribute_backers values stay
-- in the enum (Postgres doesn't allow removing enum values without
-- recreating the type) but are deprecated — UI no longer offers them
-- and the executor will treat any old row using them as
-- distribute_tokens_* equivalents.

DO $$ BEGIN
  ALTER TYPE buyback_bot_action ADD VALUE IF NOT EXISTS 'distribute_tokens_holders';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE buyback_bot_action ADD VALUE IF NOT EXISTS 'distribute_tokens_backers';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE buyback_bot_action ADD VALUE IF NOT EXISTS 'distribute_sol_holders';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE buyback_bot_action ADD VALUE IF NOT EXISTS 'distribute_sol_backers';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
