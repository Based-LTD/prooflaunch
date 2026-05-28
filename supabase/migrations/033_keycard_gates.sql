-- Phase 4 — Keycard backer lounge integration.
--
-- When a meme transitions to 'live', a cron creates a Keycard gate
-- scoped to >0 balance of the meme's mint. Every backer (and every
-- future holder) gets access to a private chat / updates page without
-- us building auth, hosting, or moderation. Brand: "every funded
-- Proof Launch token ships with a holder lounge on day one."
--
-- gate_id is Keycard's UUID; gate_url is the public link we embed in
-- the BackerLoungePanel on the meme detail page. synced_at is null
-- until the cron successfully creates the gate; failures retry next
-- tick (idempotent — we only create when gate_id is still null).

ALTER TABLE memes
  ADD COLUMN IF NOT EXISTS keycard_gate_id TEXT,
  ADD COLUMN IF NOT EXISTS keycard_gate_url TEXT,
  ADD COLUMN IF NOT EXISTS keycard_synced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_memes_keycard_needs_sync
  ON memes (status) WHERE status = 'live' AND keycard_gate_id IS NULL;

COMMENT ON COLUMN memes.keycard_gate_id IS
  'Keycard-issued gate UUID for the per-meme backer lounge. Populated by /api/keycard/sync when KEYCARD_API_KEY is set + meme is live.';
COMMENT ON COLUMN memes.keycard_gate_url IS
  'Public URL backers click to enter the lounge — Keycard handles wallet sign + access check.';
