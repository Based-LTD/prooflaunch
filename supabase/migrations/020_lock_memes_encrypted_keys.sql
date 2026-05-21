-- 020 — column-level RLS to hide encrypted_pool_key + encrypted_creator_subescrow_key from anon/authenticated
--
-- Closes a defense-in-depth gap discovered 2026-05-21: the comments
-- on the encrypted columns (migrations 017 and 018) explicitly say
-- "NEVER expose to client", but the actual RLS only granted blanket
-- SELECT on the memes table. This migration mirrors the pattern from
-- migration 012 (which correctly column-locked backings.encrypted_private_key).
--
-- Encrypted blobs are AES-256-GCM with a 32-byte high-entropy key
-- (BURNER_ENCRYPTION_KEY), so the leak was not practically exploitable
-- — but exposing encrypted secrets to a public-facing API key is a
-- defense-in-depth violation: if the key ever leaks in the future,
-- every previously-leaked blob becomes immediately decryptable.
--
-- Service role (SUPABASE_SERVICE_ROLE_KEY) bypasses RLS and column
-- grants, so every server-side route in src/app/api/ and src/services/
-- is unaffected by this migration. Only the public anon role and the
-- authenticated role (logged-in supabase users, if any) lose direct
-- read access to the two encrypted columns.

-- Step 1: revoke blanket SELECT
REVOKE SELECT ON memes FROM anon;
REVOKE SELECT ON memes FROM authenticated;

-- Step 2: re-grant column-level SELECT on every column EXCEPT the two
-- encrypted ones. Postgres has no "all except" syntax for column grants
-- so we enumerate. If a future migration adds a new column, remember to
-- also GRANT SELECT on it to anon + authenticated (or it will be silently
-- inaccessible to the frontend).
GRANT SELECT (
  id,
  created_at,
  updated_at,
  creator_wallet,
  name,
  symbol,
  description,
  image_url,
  twitter,
  telegram,
  discord,
  website,
  backing_goal_sol,
  current_backing_sol,
  backing_deadline,
  funded_at,
  status,
  mint_address,
  pump_fun_url,
  launched_at,
  submission_fee_paid,
  platform_fee_bps,
  creator_fee_pct,
  backer_share_pct,
  dev_initial_buy_sol,
  auto_refund,
  trust_score,
  creator_claimable_fees_sol,
  creator_total_claimed_sol,
  creator_twitter,
  total_slots,
  min_backing_sol,
  pool_wallet,
  pool_token_balance,
  creator_subescrow_pubkey
) ON memes TO anon;

GRANT SELECT (
  id,
  created_at,
  updated_at,
  creator_wallet,
  name,
  symbol,
  description,
  image_url,
  twitter,
  telegram,
  discord,
  website,
  backing_goal_sol,
  current_backing_sol,
  backing_deadline,
  funded_at,
  status,
  mint_address,
  pump_fun_url,
  launched_at,
  submission_fee_paid,
  platform_fee_bps,
  creator_fee_pct,
  backer_share_pct,
  dev_initial_buy_sol,
  auto_refund,
  trust_score,
  creator_claimable_fees_sol,
  creator_total_claimed_sol,
  creator_twitter,
  total_slots,
  min_backing_sol,
  pool_wallet,
  pool_token_balance,
  creator_subescrow_pubkey
) ON memes TO authenticated;

COMMENT ON COLUMN memes.encrypted_pool_key IS
  'AES-256-GCM of the pool wallet bs58 secret (same scheme as burner keys). NEVER expose to client — column-locked away from anon + authenticated in migration 020. Service role only.';

COMMENT ON COLUMN memes.encrypted_creator_subescrow_key IS
  'AES-256-GCM encrypted private key for the sub-escrow (same scheme as encrypted_pool_key). NEVER expose to client — column-locked away from anon + authenticated in migration 020. Service role only.';
