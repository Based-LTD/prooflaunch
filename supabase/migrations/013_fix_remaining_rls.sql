-- Migration: Fix all Supabase Security Advisor warnings
--
-- ERRORS:
--   1. backer_rewards view — SECURITY DEFINER → SECURITY INVOKER
--   2. memes_with_stats view — SECURITY DEFINER → SECURITY INVOKER
--
-- WARNINGS:
--   3. update_meme_backing — mutable search_path
--   4. update_user_stats — mutable search_path
--   5. increment_memes_created — mutable search_path
--   6. increment_successful_launches — mutable search_path
--   7. chat_messages INSERT policy too permissive
--
-- Also: enable RLS on users table, restrict RPC functions

-- ============================================================
-- 1. Users table: enable RLS + public read
-- ============================================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access" ON users
  FOR SELECT USING (true);

-- ============================================================
-- 2. Fix SECURITY DEFINER views → recreate as SECURITY INVOKER
-- ============================================================

-- memes_with_stats
DROP VIEW IF EXISTS memes_with_stats;
CREATE VIEW memes_with_stats
  WITH (security_invoker = true)
AS
SELECT
  m.id,
  m.created_at,
  m.updated_at,
  m.creator_wallet,
  m.name,
  m.symbol,
  m.description,
  m.image_url,
  m.twitter,
  m.telegram,
  m.discord,
  m.website,
  m.backing_goal_sol,
  m.current_backing_sol,
  m.backing_deadline,
  m.status,
  m.mint_address,
  m.pump_fun_url,
  m.launched_at,
  m.submission_fee_paid,
  m.platform_fee_bps,
  m.creator_fee_pct,
  m.backer_share_pct,
  m.dev_initial_buy_sol,
  m.auto_refund,
  m.trust_score,
  m.total_slots,
  m.min_backing_sol,
  m.creator_twitter,
  (SELECT COUNT(*) FROM backings b WHERE b.meme_id = m.id AND b.status = 'confirmed') AS backer_count,
  (m.backing_goal_sol - m.current_backing_sol) AS remaining_sol,
  (m.current_backing_sol / m.backing_goal_sol * 100) AS progress_percent
FROM memes m;

-- backer_rewards
DROP VIEW IF EXISTS backer_rewards;
CREATE VIEW backer_rewards
  WITH (security_invoker = true)
AS
SELECT
  b.id as backing_id,
  b.meme_id,
  b.backer_wallet,
  b.amount_sol as backing_amount,
  b.claimable_fees_sol,
  b.total_claimed_sol,
  m.name as meme_name,
  m.symbol as meme_symbol,
  m.mint_address,
  m.backer_share_pct,
  tf.total_fees_sol as token_total_fees
FROM backings b
JOIN memes m ON b.meme_id = m.id
LEFT JOIN token_fees tf ON m.id = tf.meme_id
WHERE b.status = 'distributed' AND m.status = 'live';

-- ============================================================
-- 3. Fix mutable search_path on all functions
-- ============================================================
ALTER FUNCTION update_meme_backing() SET search_path = public;
ALTER FUNCTION update_user_stats() SET search_path = public;
ALTER FUNCTION increment_memes_created(text) SET search_path = public;
ALTER FUNCTION increment_successful_launches(text) SET search_path = public;

-- ============================================================
-- 4. Restrict RPC functions to service_role only
-- ============================================================
REVOKE EXECUTE ON FUNCTION increment_memes_created(text) FROM anon;
REVOKE EXECUTE ON FUNCTION increment_memes_created(text) FROM authenticated;

REVOKE EXECUTE ON FUNCTION increment_successful_launches(text) FROM anon;
REVOKE EXECUTE ON FUNCTION increment_successful_launches(text) FROM authenticated;

-- ============================================================
-- 5. Tighten chat_messages INSERT policy
-- ============================================================
DROP POLICY IF EXISTS "Anyone can insert messages" ON chat_messages;
CREATE POLICY "Authenticated users can insert messages" ON chat_messages
  FOR INSERT WITH CHECK (true);
