-- 045 — RLS hardening sweep
--
-- chat_messages INSERT policy was `WITH CHECK (true)` with no role
-- restriction. Anon could spoof any wallet_address in any chat. The
-- API route already verifies wallet ownership before insert, but the
-- policy itself is the second line of defense and currently provides
-- zero protection. Drop the public INSERT policy entirely; all app
-- inserts already flow through the server-side service role (see
-- src/app/api/chat/route.ts), which bypasses RLS.
--
-- (Sibling issue — memes_with_stats view missing security_invoker —
-- is deferred. Flipping security_invoker requires extending anon
-- column-grants on `memes` to cover every public column added since
-- migration 020 (fee_*, buyback_bot_*, max_backing_sol, reserved_*,
-- etc.) before the view will continue to work. Tracked separately;
-- the existing column DENY list in migration 035 keeps the
-- highest-risk encrypted columns out of the view in the meantime.)

DROP POLICY IF EXISTS "Anyone can insert messages" ON chat_messages;
DROP POLICY IF EXISTS "Authenticated users can insert messages" ON chat_messages;

-- No INSERT policy = anon + authenticated cannot insert. Service role
-- still can (bypasses RLS). This is the desired posture.
