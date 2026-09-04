-- Migration 061: RLS tightening — 2026-09-01 external report + internal sweep.
--
-- Context: a cold-email scanner flagged 054 for creating wallet_claim_events
-- without RLS. Prod was already protected (enabled via dashboard at some
-- point — repo-vs-prod drift in the safe direction), but the migration chain
-- didn't reflect it: a fresh replay would recreate the gap, and every
-- migrations-reading scanner will keep "finding" it.
--
-- Full anon-key probe of all 28 tables (2026-09-01) confirmed: every other
-- readable table is readable via a deliberate "Public read" policy, writes
-- are policy-blocked, and memes/backings/meme_bots are grant-revoked.
--
-- Changes:
--   1. wallet_claim_events: codify RLS so migrations match prod. Idempotent.
--   2. backing_allowlist + meme_visibility_changes: drop public-read
--      policies. Both carry internal free-text fields (note, reason,
--      added_by) with no reason to be world-readable. All application reads
--      go through server routes using the service role (which bypasses RLS);
--      no client-side code queries these tables directly (verified: no
--      component imports the anon client at all).

ALTER TABLE wallet_claim_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read backing_allowlist" ON backing_allowlist;
DROP POLICY IF EXISTS "Public read visibility_changes" ON meme_visibility_changes;
