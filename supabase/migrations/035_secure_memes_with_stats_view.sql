-- SECURITY + correctness fix for memes_with_stats view.
--
-- Two problems discovered 2026-05-28:
--   1) The view's `SELECT m.*` cached its column list at creation time,
--      so columns added in migrations 030-034 (fee_*, buyback_bot_*,
--      max_backing_sol, keycard_*) silently never appeared in API
--      responses. UI for those features couldn't render.
--   2) Worse: `m.*` AT THE TIME OF 029 included `encrypted_pool_key`
--      and `encrypted_creator_subescrow_key`. Those have been leaking
--      through every public meme detail API call ever since. The keys
--      are AES-GCM encrypted with BURNER_ENCRYPTION_KEY (env), so a
--      single env leak would let an attacker drain every pool wallet
--      and creator sub-escrow.
--
-- Fix: drop the view, recreate with an EXPLICIT public column list.
-- Sensitive columns (encrypted_*, keycard_admin_url) are deliberately
-- absent and called out by comment. Future migrations that add public
-- columns MUST update this view to expose them; sensitive columns
-- are safe-by-default (excluded unless explicitly added).
--
-- Built dynamically by enumerating information_schema.columns + the
-- explicit DENY list so we can't accidentally miss a public column
-- that was added before this migration.

DO $$
DECLARE
  col_list TEXT;
BEGIN
  SELECT string_agg('m.' || quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO col_list
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'memes'
      AND column_name NOT IN (
        -- DENY LIST — sensitive columns that must never reach clients.
        -- Adding a new sensitive column? Add it here AND to the comment
        -- in /api/memes/[id]/route.ts.
        'encrypted_pool_key',
        'encrypted_creator_subescrow_key',
        'encrypted_buyback_bot_key',
        'keycard_admin_url',
        -- Replaced by the aggregate LEFT JOIN below (duplicate column
        -- error otherwise).
        'current_backing_sol'
      );

  EXECUTE 'DROP VIEW IF EXISTS memes_with_stats';
  EXECUTE format($f$
    CREATE VIEW memes_with_stats AS
    SELECT %s,
      COALESCE(b.backer_count, 0)        AS backer_count,
      COALESCE(b.current_backing_sol, 0) AS current_backing_sol
    FROM memes m
    LEFT JOIN (
      SELECT meme_id,
             COUNT(*)        AS backer_count,
             SUM(amount_sol) AS current_backing_sol
      FROM backings
      WHERE status IN ('confirmed', 'distributed')
      GROUP BY meme_id
    ) b ON b.meme_id = m.id
  $f$, col_list);
END $$;

GRANT SELECT ON memes_with_stats TO anon, authenticated, service_role;
