-- Allow reserved_slots == total_slots (TEAM ROUND).
--
-- Migration 037 enforced reserved_slots < total_slots, requiring at
-- least one open slot. This was the safer brand-aligned default, but
-- the UX decision now allows fully-reserved launches PROVIDED they
-- carry an explicit "TEAM ROUND" label so the public sees instantly
-- that no slots are open.
--
-- Rationale:
--   - Teams legitimately need fully-private rounds (LP bootstrap, KOL
--     allocations, team payouts). Forcing 1 open slot was arbitrary.
--   - As long as the gating is publicly visible + the wallets are
--     declared, it's transparent gating, not stealth manipulation —
--     a different product class from open launches.
--   - The platform's "equal entry" thesis still applies to OPEN
--     launches; TEAM ROUND is its own clearly-labeled surface.
--
-- Range stays validated: reserved_slots in [0, total_slots].

ALTER TABLE memes
  DROP CONSTRAINT IF EXISTS memes_reserved_slots_valid;
ALTER TABLE memes
  ADD CONSTRAINT memes_reserved_slots_valid CHECK (
    reserved_slots >= 0 AND reserved_slots <= total_slots
  );

COMMENT ON COLUMN memes.reserved_slots IS
  'Number of slots reserved for allowlisted wallets. 0 = fully open launch. 1..total_slots-1 = hybrid (some slots open to public, some reserved). total_slots = fully reserved TEAM ROUND (no public slots — UI labels distinctly so visitors know upfront).';
