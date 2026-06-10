-- Migration 052: Add optional X-style banner image to memes.
--
-- The token icon (memes.image_url) is the square/avatar. This adds a
-- separate landscape banner — same dimensions as an X profile banner
-- (1500×500, 3:1 aspect) — that creators can optionally upload at
-- submit. Displays full-width at the top of the meme detail page
-- when set; absent → page renders unchanged.
--
-- Storage path layout: `banners/<sha256>.<ext>` in the existing
-- `token-assets` Supabase Storage bucket. Content-addressed (the
-- /api/upload/image route hashes the bytes and dedupes uploads).
-- 2 MB cap + PNG/JPEG/WebP allowlist enforced at the bucket layer.
--
-- Safe to re-run.

ALTER TABLE memes
  ADD COLUMN IF NOT EXISTS banner_url text;

COMMENT ON COLUMN memes.banner_url IS
  'Optional X-style banner image (1500×500). Public CDN URL from token-assets/banners/. Renders at the top of /meme/[id] when set; absent → no banner.';
