-- Launch Configuration v2 — Phase 1: visibility + backing allowlist.
--
-- Three visibility modes for token launches:
--   • open       — current behavior, anyone sees + backs (default).
--   • stealth    — listing hidden from proving grounds. Only allowlisted
--                  wallets can see the page or back. Team controls the
--                  reveal. (Branded "Stealth Launch" — strategic, not
--                  secret. PROOF guarantee still applies: full reveal
--                  at launch with complete on-chain audit trail.)
--   • spectator  — listing publicly visible (anyone can view + watch slots
--                  fill), but backing is gated to allowlisted wallets
--                  only. Public anticipation + team-curated round.
--
-- Visibility auto-flips to `open` when the token transitions to `funded`
-- status (all slots filled). This is the PROOF transparency guarantee —
-- nothing stays hidden after launch. Can also be flipped manually by the
-- creator earlier (e.g., meme teams flipping stealth → open after taking
-- their positions).

-- ── memes table: add visibility flag ──────────────────────────────────
DO $$ BEGIN
  CREATE TYPE meme_visibility AS ENUM ('open', 'stealth', 'spectator');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE memes
  ADD COLUMN IF NOT EXISTS visibility meme_visibility NOT NULL DEFAULT 'open';

COMMENT ON COLUMN memes.visibility IS
  'Access mode. open=anyone sees+backs, stealth=allowlisted only, spectator=public listing+gated backing. Auto-flips to open when status=funded. Creator can manually toggle earlier.';

-- ── backing_allowlist: which wallets can back this meme ───────────────
CREATE TABLE IF NOT EXISTS backing_allowlist (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meme_id     UUID NOT NULL REFERENCES memes(id) ON DELETE CASCADE,
  wallet      TEXT NOT NULL,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  added_by    TEXT NOT NULL,           -- creator wallet (audit trail)
  note        TEXT,                    -- optional ("team", "OG community", etc)
  UNIQUE(meme_id, wallet)
);

CREATE INDEX IF NOT EXISTS idx_backing_allowlist_meme ON backing_allowlist(meme_id);
CREATE INDEX IF NOT EXISTS idx_backing_allowlist_lookup ON backing_allowlist(meme_id, wallet);

-- RLS: public-readable so the frontend can show allowlist counts + the
-- homepage stealth-counter can aggregate without elevated auth.
-- Writes only via service_role (creator dashboard → API → DB).
ALTER TABLE backing_allowlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read backing_allowlist" ON backing_allowlist;
CREATE POLICY "Public read backing_allowlist" ON backing_allowlist
  FOR SELECT USING (true);

-- ── visibility_changes audit log ──────────────────────────────────────
-- Every flip is logged. Powers two things:
--   1. The "reveal timeline" on token detail pages (when did this go open?)
--   2. The PROOF guarantee — every state change is on-record forever
CREATE TABLE IF NOT EXISTS meme_visibility_changes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meme_id      UUID NOT NULL REFERENCES memes(id) ON DELETE CASCADE,
  from_value   meme_visibility,
  to_value     meme_visibility NOT NULL,
  changed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changed_by   TEXT NOT NULL,           -- creator wallet OR 'system' for auto-flips
  reason       TEXT                     -- 'manual_toggle' | 'auto_funded' | 'auto_launched'
);

CREATE INDEX IF NOT EXISTS idx_visibility_changes_meme ON meme_visibility_changes(meme_id, changed_at DESC);

ALTER TABLE meme_visibility_changes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read visibility_changes" ON meme_visibility_changes;
CREATE POLICY "Public read visibility_changes" ON meme_visibility_changes
  FOR SELECT USING (true);

-- ── Refresh memes_with_stats view to include visibility ──────────────
-- Frontend reads from the view; needs the new column passed through.
DROP VIEW IF EXISTS memes_with_stats;

CREATE OR REPLACE VIEW memes_with_stats AS
SELECT
  m.*,                                    -- includes new visibility column
  COALESCE(b.backer_count, 0)        AS backer_count,
  COALESCE(b.current_backing_sol, 0) AS current_backing_sol
FROM memes m
LEFT JOIN (
  SELECT
    meme_id,
    COUNT(*)        AS backer_count,
    SUM(amount_sol) AS current_backing_sol
  FROM backings
  WHERE status IN ('confirmed', 'distributed')
  GROUP BY meme_id
) b ON b.meme_id = m.id;

GRANT SELECT ON memes_with_stats TO anon, authenticated, service_role;

-- ── Public-facing counter view: active stealth + spectator counts ─────
-- Powers the homepage "N stealth launches in progress" counter.
-- Public read OK — exposes just aggregate counts, not identities.
CREATE OR REPLACE VIEW launch_visibility_counts AS
SELECT
  visibility,
  COUNT(*) AS count
FROM memes
WHERE status IN ('backing', 'funded')   -- only count active launches
  AND visibility != 'open'              -- only the gated modes are interesting to show
GROUP BY visibility;

GRANT SELECT ON launch_visibility_counts TO anon, authenticated, service_role;
