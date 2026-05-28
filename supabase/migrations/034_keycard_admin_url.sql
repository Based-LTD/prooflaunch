-- Keycard returns an adminUrl containing a per-gate admin key on create.
-- We store it (server-side only, never exposed to clients) so we can
-- later PATCH the gate (update content, change rule, etc.) on behalf
-- of the creator. Phase 4 MVP just stores it; Phase 4.1 will expose
-- "Edit lounge content" UX backed by this URL.

ALTER TABLE memes
  ADD COLUMN IF NOT EXISTS keycard_admin_url TEXT;

COMMENT ON COLUMN memes.keycard_admin_url IS
  'Secret admin URL returned by Keycard /v1/gates on create. Contains the admin key. NEVER expose via public API responses.';
