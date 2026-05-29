-- Reserved slots within an open launch.
--
-- The creator can mark N of M slots as "reserved for specific wallets"
-- at submit time. The launch stays visibility=open (public sees it,
-- public can back the open slots) but the LAST N slots can only be
-- backed by wallets the creator listed (reusing backing_allowlist).
--
-- This solves the "team launch" need without the off-brand stealth
-- pattern: public always sees the launch, public always has
-- guaranteed slots (the open ones), the team just reserves their
-- entry without blocking anyone.
--
-- Semantics:
--   reserved_slots = 0       → fully open launch, allowlist unused
--   reserved_slots = N (>0)  → slots (total - N + 1)..total are
--                              reserved; only allowlisted wallets can
--                              fill them. Slots 1..(total - N) are
--                              first-come-first-served from anyone.
--   reserved_slots must be < total_slots (must leave at least 1 open).
--
-- Allowlisted wallets can back ANY slot (reserved or open) — they're
-- only restricted from backing more than their slot in total via the
-- existing 1-per-wallet rule.

ALTER TABLE memes
  ADD COLUMN IF NOT EXISTS reserved_slots INTEGER NOT NULL DEFAULT 0;

ALTER TABLE memes
  DROP CONSTRAINT IF EXISTS memes_reserved_slots_valid;
ALTER TABLE memes
  ADD CONSTRAINT memes_reserved_slots_valid CHECK (
    reserved_slots >= 0 AND reserved_slots < total_slots
  );

COMMENT ON COLUMN memes.reserved_slots IS
  'Number of slots (out of total_slots) reserved for allowlisted wallets. 0 = fully open launch. When > 0, the LAST reserved_slots positions can only be backed by wallets in backing_allowlist for this meme. Open slots (1..total_slots - reserved_slots) are first-come-first-served from anyone. Must be < total_slots so at least one slot stays public.';
