-- 48-hour launch window for funded memes, with creator-initiated reset.
--
-- Problem: previously, once a meme hit 'funded' status it sat indefinitely
-- waiting for the creator to launch. If the creator went silent, backers'
-- SOL was stuck in the pool wallet with no way to recover. ONIX (mint
-- 9Weuqd8…) sat funded for 3 days before this fix landed.
--
-- Solution: each funded meme gets a 48-hour `launch_deadline`. The creator
-- can call POST /api/memes/{id}/reset-launch-window to extend it by another
-- 48 hours (proof of life — they're still engaged). If the deadline passes
-- without launch OR reset, the existing /api/process-memes cron auto-refunds
-- all backers, same way it handles expired backing-phase memes.
--
-- Properties:
--   - Asymmetric: silent creators (bad faith) get refunded fast; engaged
--     creators (good faith) can extend indefinitely in 48h chunks
--   - Visible: each reset writes a row to launch_window_resets, giving
--     backers a public "creator engagement" signal
--   - Self-service: no operator intervention needed
--   - Backwards compatible: backfill gives existing funded memes a fresh
--     48h grace period from migration time

-- ── Schema: launch_deadline + index ────────────────────────────────
ALTER TABLE memes
  ADD COLUMN IF NOT EXISTS launch_deadline TIMESTAMPTZ;

-- Cron query is "funded AND launch_deadline < NOW()" — partial index
-- on funded-only rows keeps it cheap as memes table grows.
CREATE INDEX IF NOT EXISTS idx_memes_launch_deadline
  ON memes(launch_deadline)
  WHERE status = 'funded';


-- ── Trigger: auto-set launch_deadline when status flips to 'funded' ─
-- Catches all four current call sites (api/launch, api/backings,
-- services/reconcile×2) AND any future code path. Atomic with the
-- status flip — no race window where status='funded' but no deadline.
--
-- Only sets the deadline if it's currently NULL — this protects the
-- creator-initiated reset (which writes a new deadline independently)
-- from being clobbered if some code re-asserts status='funded'.
CREATE OR REPLACE FUNCTION set_launch_deadline_on_funded()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'funded' AND OLD.status <> 'funded' AND NEW.launch_deadline IS NULL THEN
    NEW.launch_deadline := NOW() + INTERVAL '48 hours';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_launch_deadline ON memes;
CREATE TRIGGER trg_set_launch_deadline
  BEFORE UPDATE ON memes
  FOR EACH ROW
  EXECUTE FUNCTION set_launch_deadline_on_funded();


-- ── Audit table: every reset is publicly logged ─────────────────────
-- Backers can see at a glance: "creator reset 3 times in 6 days" = engaged,
-- vs "no resets, 47h until refund" = abandoned. Surfaces in the UI as
-- "Last reset: 12h ago by creator" or similar.
CREATE TABLE IF NOT EXISTS launch_window_resets (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meme_id             UUID NOT NULL REFERENCES memes(id) ON DELETE CASCADE,
  reset_by_wallet     TEXT NOT NULL,                  -- always == meme.creator_wallet, but stored for audit
  reset_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  previous_deadline   TIMESTAMPTZ NOT NULL,
  new_deadline        TIMESTAMPTZ NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_launch_window_resets_meme ON launch_window_resets(meme_id, reset_at DESC);

-- RLS: public-readable (transparency on engagement signal),
-- service-role only for writes.
ALTER TABLE launch_window_resets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read launch window resets" ON launch_window_resets
  FOR SELECT USING (true);


-- ── Backfill: give existing funded memes a fresh 48h grace ─────────
-- They submitted before this rule existed, so it's only fair they get
-- the same 48h window every future creator will get, starting now —
-- not retroactively expired against a deadline they couldn't have known.
UPDATE memes
SET launch_deadline = NOW() + INTERVAL '48 hours'
WHERE status = 'funded'
  AND launch_deadline IS NULL;


-- ── Re-create memes_with_stats view to include launch_deadline ────
-- The view is what /api/memes (public listing) queries — without this
-- replacement, the new launch_deadline column wouldn't reach the
-- homepage cards. We preserve the exact existing column list (from
-- migration 013) and append launch_deadline + funded_at + creator_
-- subescrow_pubkey (also missing from the view, used elsewhere).
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
  m.funded_at,
  m.launch_deadline,   -- NEW (migration 027)
  m.pool_wallet,
  m.creator_subescrow_pubkey,
  m.partner_id,
  m.fee_distribution_mode,
  (SELECT COUNT(*) FROM backings b WHERE b.meme_id = m.id AND b.status = 'confirmed') AS backer_count,
  (m.backing_goal_sol - m.current_backing_sol) AS remaining_sol,
  (m.current_backing_sol / m.backing_goal_sol * 100) AS progress_percent
FROM memes m;
