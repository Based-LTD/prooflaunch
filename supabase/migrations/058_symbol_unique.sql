-- Pre-KOL hardening: prevent impersonator symbol-squatting on submit.
-- Under the old schema, two creators could submit the same symbol at
-- the same instant and both succeed. On a high-visibility launch window
-- (KOL push, artist drop), a copycat could squat the artist's symbol
-- before they got to submit; fans then see two "TAYLORS" tokens in the
-- listing and can't tell which is real.
--
-- Partial unique index (not table-level UNIQUE) so failed rows don't
-- block a creator from retrying the same symbol later. A creator whose
-- first attempt errored out at the launch step (status='failed') can
-- re-submit cleanly under the same symbol. The meme_status enum
-- (pending|backing|funded|launching|live|failed) has no 'cancelled'
-- state today; if one is added later, update this WHERE accordingly.
--
-- LOWER() makes it case-insensitive — squatting "Bonk" vs "BONK" vs
-- "bonk" would still all collide. Matches the API-side ilike check.
--
-- This is the DB backstop; the friendlier 409 with a useful error comes
-- from src/app/api/memes/route.ts which runs an ilike pre-check before
-- the insert. If something races past the API check, this index
-- raises a constraint-violation error rather than letting the dupe land.
--
-- Verified safe to add: queried prod 2026-06-24, zero existing dupes
-- across all 16 historical meme rows.

CREATE UNIQUE INDEX IF NOT EXISTS uniq_memes_symbol_active
  ON memes (LOWER(symbol))
  WHERE status <> 'failed';
