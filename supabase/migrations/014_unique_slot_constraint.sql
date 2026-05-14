-- Migration: prevent slot race condition
--
-- Two backings submitted ~simultaneously for the last open slot can both pass
-- the count check in /api/backings POST and both insert, producing an
-- over-filled meme (e.g. 9 of 8 slots). This adds a unique constraint so the
-- second insert fails with a constraint violation that the route catches and
-- returns as "slot just filled, please retry."

-- Only enforce uniqueness on active backings; withdrawn ones can re-use slot numbers.
-- Use a partial unique index instead of a CHECK constraint.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_backings_meme_slot_active
  ON backings (meme_id, slot_number)
  WHERE status IN ('pending', 'confirmed', 'distributed');
