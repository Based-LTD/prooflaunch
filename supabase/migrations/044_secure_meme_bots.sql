-- 044 — column-level lock + RLS on meme_bots
--
-- Migration 040 introduced `meme_bots` with `encrypted_bot_key TEXT NOT NULL`
-- but never restricted column access. The anon Supabase key (which ships
-- in every page bundle as NEXT_PUBLIC_SUPABASE_ANON_KEY) could call
--   `from('meme_bots').select('encrypted_bot_key')`
-- and dump every bot's AES-encrypted private key.
--
-- This is the same defense-in-depth issue migration 020 fixed for
-- memes.encrypted_pool_key and migration 035 fixed for the
-- memes_with_stats view. The blast radius if BURNER_ENCRYPTION_KEY
-- ever leaks is "every bot wallet is now fully drainable" — so we lock
-- the column away from anon + authenticated regardless of how the key
-- is handled.
--
-- Service role (SUPABASE_SERVICE_ROLE_KEY) bypasses both RLS and
-- column grants, so every server-side route in src/app/api/ and
-- src/services/ is unaffected. Only the public anon key loses direct
-- read access to `encrypted_bot_key`.

-- Step 1: enable RLS so policies become the gate.
ALTER TABLE meme_bots ENABLE ROW LEVEL SECURITY;

-- Step 2: allow public read for bot metadata (action, wallet, fee %,
-- run stats are all already discoverable on-chain).
DROP POLICY IF EXISTS "Public read meme_bots" ON meme_bots;
CREATE POLICY "Public read meme_bots" ON meme_bots
  FOR SELECT
  USING (true);

-- Step 3: revoke blanket SELECT, re-grant column-level on every
-- column EXCEPT encrypted_bot_key. Mirrors migration 020's pattern.
-- If a future migration adds a new column, remember to add it here
-- (or it will be silently inaccessible to the frontend).
REVOKE SELECT ON meme_bots FROM anon;
REVOKE SELECT ON meme_bots FROM authenticated;

GRANT SELECT (
  id,
  meme_id,
  slot_order,
  action,
  fee_pct,
  bot_wallet,
  last_run_at,
  total_sol_spent,
  total_tokens_acted,
  created_at,
  label,
  destination_wallet
) ON meme_bots TO anon;

GRANT SELECT (
  id,
  meme_id,
  slot_order,
  action,
  fee_pct,
  bot_wallet,
  last_run_at,
  total_sol_spent,
  total_tokens_acted,
  created_at,
  label,
  destination_wallet
) ON meme_bots TO authenticated;

COMMENT ON COLUMN meme_bots.encrypted_bot_key IS
  'AES-256-GCM of the bot wallet bs58 secret (same scheme as encrypted_pool_key). NEVER expose to client — column-locked away from anon + authenticated in migration 044. Service role only.';
