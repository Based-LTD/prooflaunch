-- Fix memes_with_stats view to include all columns from memes table
-- Run this in Supabase SQL Editor

DROP VIEW IF EXISTS memes_with_stats;

CREATE VIEW memes_with_stats AS
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
  (SELECT COUNT(*) FROM backings b WHERE b.meme_id = m.id AND b.status = 'confirmed') AS backer_count,
  (m.backing_goal_sol - m.current_backing_sol) AS remaining_sol,
  (m.current_backing_sol / m.backing_goal_sol * 100) AS progress_percent
FROM memes m;
