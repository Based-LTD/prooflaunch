-- Token banners — wide hero images creators can attach to their launches.
--
-- The existing `image_url` column holds the small square token logo as
-- a base64 data URL in the row itself (works because logos are tiny).
-- Banners are too big for that pattern (typical 1500×500 PNG is 200KB+
-- which would bloat every realtime payload). So banners live in
-- Supabase Storage and `banner_url` holds the public URL.
--
-- Bucket: `token-assets`
--   • Public-readable so <img src=...> works for anyone
--   • Writes restricted to service_role (uploads go through
--     /api/memes/banner-upload, never direct from the client)
--
-- Path layout: token-assets/banners/<sha256>.<ext>
--   Content-addressed by SHA-256 of the file bytes — two creators
--   uploading the same banner image dedupe automatically, and we
--   never have to deal with "what if they re-upload" races.

-- ── Storage bucket ─────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'token-assets',
  'token-assets',
  true,
  2 * 1024 * 1024,                                  -- 2 MB cap per file
  ARRAY['image/png', 'image/jpeg', 'image/webp']    -- no SVG (XSS risk via inline scripts)
)
ON CONFLICT (id) DO NOTHING;

-- ── Storage RLS ────────────────────────────────────────────────────
-- Anyone can read (public bucket already implies this, but explicit
-- policy makes the intent visible).
DROP POLICY IF EXISTS "Public read token-assets" ON storage.objects;
CREATE POLICY "Public read token-assets" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'token-assets');

-- Only service_role can write. The anon/authenticated roles get no
-- INSERT/UPDATE/DELETE policies, so by default they can't touch the
-- bucket — uploads must come through our server-side endpoint.

-- ── Schema change ──────────────────────────────────────────────────
ALTER TABLE memes
  ADD COLUMN IF NOT EXISTS banner_url TEXT;

COMMENT ON COLUMN memes.banner_url IS
  'Public URL of the wide hero banner in storage. NULL = no banner uploaded; UI falls back to a deterministic gradient from the symbol hash.';

-- ── View refresh ───────────────────────────────────────────────────
-- memes_with_stats uses a fixed column list. Re-create it to include
-- the new banner_url so APIs reading from the view see it.
-- (Same pattern used in 027_funded_launch_window.sql.)
--
-- NOTE: If your memes_with_stats view definition differs from below,
-- adjust the SELECT list to match. This re-creates with the same
-- joins/aggregations as the prior version + banner_url passthrough.

DROP VIEW IF EXISTS memes_with_stats;

CREATE OR REPLACE VIEW memes_with_stats AS
SELECT
  m.*,                                       -- includes the new banner_url
  COALESCE(b.backer_count, 0)        AS backer_count,
  COALESCE(b.current_backing_sol, 0) AS current_backing_sol
FROM memes m
LEFT JOIN (
  SELECT
    meme_id,
    COUNT(*)              AS backer_count,
    SUM(amount_sol)       AS current_backing_sol
  FROM backings
  WHERE status = 'active'
  GROUP BY meme_id
) b ON b.meme_id = m.id;

GRANT SELECT ON memes_with_stats TO anon, authenticated, service_role;
