-- 047 — Dev Leaderboard for the October 22, 2026 PROOF unlock.
--
-- THE FLYWHEEL:
--   10% of PROOF supply is locked until 2026-10-22. We use that 10%
--   as the prize pool for a dev leaderboard. Every time one of a
--   creator's launched tokens crosses a new $10,000 MC milestone,
--   the creator earns 10,000 points (1:1 USD-to-points). Cumulative
--   across ALL of a dev's memes — launching consistent winners
--   compounds.
--
--   At the snapshot moment (2026-10-22 00:00 UTC = the unlock
--   instant), the top 10 creators each receive an equal share of
--   the unlocked 10% supply, streamed linearly over 6 months via
--   Streamflow.
--
-- DESIGN CHOICES:
--   - Peak MC watermark (not sustained / time-weighted). Simple,
--     bounded gaming — you have to actually move price. Once a
--     bucket is crossed, points are locked even if MC drops.
--   - Creator is identified by memes.creator_wallet. Same wallet
--     across multiple memes accumulates.
--   - Per-meme MC tracking row records the highest bucket seen so
--     the cron knows what's new vs already-credited.
--   - dev_points is a materialized aggregate keyed on wallet for
--     fast leaderboard reads — the meme_mc_tracking table is the
--     ledger; dev_points is the cached sum.

-- ── meme_mc_tracking ───────────────────────────────────────────────
-- One row per live meme. Holds the highest MC bucket crossed so far.
-- The cron compares current MC to this row's highest_mc_bucket and
-- credits the delta.

CREATE TABLE IF NOT EXISTS meme_mc_tracking (
  meme_id           UUID PRIMARY KEY REFERENCES memes(id) ON DELETE CASCADE,
  highest_mc_usd    NUMERIC(20, 2) NOT NULL DEFAULT 0,
  highest_mc_bucket INT NOT NULL DEFAULT 0,
  last_mc_usd       NUMERIC(20, 2),
  last_checked_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meme_mc_tracking_updated
  ON meme_mc_tracking (updated_at DESC);

COMMENT ON TABLE meme_mc_tracking IS
  'Per-meme highest-MC watermark for the dev leaderboard. The cron polls market cap hourly and credits the creator when a new $10k bucket is crossed.';
COMMENT ON COLUMN meme_mc_tracking.highest_mc_bucket IS
  'floor(highest_mc_usd / 10000). e.g. 7 = the meme has crossed $70k MC at some point.';

-- ── dev_points ────────────────────────────────────────────────────
-- One row per creator_wallet. Materialized cumulative points across
-- all of the dev's memes. Updated by the same cron tick that credits
-- meme_mc_tracking.

CREATE TABLE IF NOT EXISTS dev_points (
  creator_wallet  TEXT PRIMARY KEY,
  total_points    BIGINT NOT NULL DEFAULT 0,
  meme_count      INT NOT NULL DEFAULT 0,
  best_meme_id    UUID REFERENCES memes(id) ON DELETE SET NULL,
  best_meme_mc    NUMERIC(20, 2),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dev_points_total
  ON dev_points (total_points DESC);

COMMENT ON TABLE dev_points IS
  'Cumulative dev leaderboard. total_points = sum of (10k buckets crossed across ALL the dev''s memes) × 10000. Updated hourly by /api/cron/leaderboard. Snapshot for the 2026-10-22 PROOF unlock distribution.';
COMMENT ON COLUMN dev_points.total_points IS
  '1 point per $1 of total peak MC reached across all the dev''s memes (bucketed at $10k granularity). e.g. 250,000 points = dev has launched memes that collectively crossed $250k in peak MC milestones.';

-- ── Public read, service-role write ────────────────────────────────
-- Same posture as the rest of our public-facing aggregates.

ALTER TABLE meme_mc_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE dev_points ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read meme_mc_tracking" ON meme_mc_tracking;
CREATE POLICY "Public read meme_mc_tracking" ON meme_mc_tracking
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public read dev_points" ON dev_points;
CREATE POLICY "Public read dev_points" ON dev_points
  FOR SELECT USING (true);
