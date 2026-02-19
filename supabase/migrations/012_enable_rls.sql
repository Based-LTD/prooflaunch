-- Migration: Enable Row-Level Security on all tables
-- Supabase flagged missing RLS as a security vulnerability.
--
-- All API routes use createServerClient() with SUPABASE_SERVICE_ROLE_KEY,
-- which bypasses RLS entirely. These policies only affect the client-side
-- anon key used for realtime subscriptions and (theoretically) direct queries.
--
-- Strategy:
--   - Enable RLS on all tables
--   - Allow public SELECT (needed for realtime subscriptions)
--   - Block all direct writes via anon key (INSERT/UPDATE/DELETE)
--   - Hide encrypted_private_key column from anon role

-- ============================================================
-- 1. Enable RLS on all tables that don't have it yet
-- ============================================================
-- (chat_messages already has RLS enabled from migration 002)

ALTER TABLE memes ENABLE ROW LEVEL SECURITY;
ALTER TABLE backings ENABLE ROW LEVEL SECURITY;
ALTER TABLE token_fees ENABLE ROW LEVEL SECURITY;
ALTER TABLE fee_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE fee_transactions ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2. SELECT-only policies (anon can read, not write)
-- ============================================================

-- memes: public read (needed for homepage listing + realtime)
CREATE POLICY "Public read access" ON memes
  FOR SELECT USING (true);

-- backings: public read (needed for realtime backing updates)
CREATE POLICY "Public read access" ON backings
  FOR SELECT USING (true);

-- token_fees: public read (fee info is non-sensitive)
CREATE POLICY "Public read access" ON token_fees
  FOR SELECT USING (true);

-- fee_claims: public read (claim status is non-sensitive)
CREATE POLICY "Public read access" ON fee_claims
  FOR SELECT USING (true);

-- fee_transactions: public read (tx records are on-chain anyway)
CREATE POLICY "Public read access" ON fee_transactions
  FOR SELECT USING (true);

-- ============================================================
-- 3. Hide encrypted_private_key from anon/authenticated roles
-- ============================================================
-- Column-level privilege: revoke table-level SELECT, then re-grant
-- on all columns EXCEPT encrypted_private_key.
-- Service role is unaffected (bypasses RLS and column grants).

REVOKE SELECT ON backings FROM anon;
REVOKE SELECT ON backings FROM authenticated;

GRANT SELECT (
  id,
  meme_id,
  backer_wallet,
  amount_sol,
  status,
  created_at,
  tokens_received,
  distribution_tx,
  refund_tx,
  claimable_fees_sol,
  total_claimed_sol,
  burner_wallet,
  burner_buy_executed,
  burner_buy_signature,
  swept,
  sweep_action,
  sweep_signature,
  swept_at,
  slot_number
) ON backings TO anon;

GRANT SELECT (
  id,
  meme_id,
  backer_wallet,
  amount_sol,
  status,
  created_at,
  tokens_received,
  distribution_tx,
  refund_tx,
  claimable_fees_sol,
  total_claimed_sol,
  burner_wallet,
  burner_buy_executed,
  burner_buy_signature,
  swept,
  sweep_action,
  sweep_signature,
  swept_at,
  slot_number
) ON backings TO authenticated;
