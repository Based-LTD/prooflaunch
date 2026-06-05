-- Migration 050: Add optional `github` social link to memes.
--
-- Token devs can now attach a GitHub URL alongside the existing
-- X / Telegram / Discord / Website socials. Renders on the detail
-- page (MemeHero pill + MemeIdentityBar icon), on browse cards
-- (MemeCard socials row), and in the on-chain token metadata
-- `extensions` block served by /api/token-metadata/[mint].
--
-- Stored as a plain TEXT column (mirrors the existing socials
-- pattern at supabase-schema.sql:44-47). No constraint — URL shape
-- is enforced client-side at /submit (validateUrl + GITHUB_PATTERN)
-- and accepted as-is on the server. Nullable; legacy rows stay NULL.

ALTER TABLE memes
  ADD COLUMN IF NOT EXISTS github text;

COMMENT ON COLUMN memes.github IS
  'Optional GitHub URL for the token dev (e.g. https://github.com/org or https://github.com/org/repo). Renders on token cards + detail page, written into on-chain metadata extensions.';
