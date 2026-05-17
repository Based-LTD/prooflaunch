-- Migration: Durable launch-step logging
--
-- Serverless launch functions lose their console logs the moment the
-- invocation ends, so a silent buy failure (the $TEST incident) is
-- undiagnosable after the fact. This table persists every step of a
-- launch + every reconciliation action so failures are explainable
-- from data, not lost runtime logs.
--
-- Written fire-and-forget from the launch hot path (never blocks buys).

CREATE TABLE IF NOT EXISTS launch_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  meme_id UUID REFERENCES memes(id) ON DELETE CASCADE,
  backer_wallet TEXT,            -- null for create/curve-level events
  phase TEXT NOT NULL,           -- create_sent, curve_ready, buy_confirmed, reconcile_refunded, ...
  ok BOOLEAN NOT NULL DEFAULT TRUE,
  signature TEXT,
  detail JSONB
);

CREATE INDEX IF NOT EXISTS idx_launch_events_meme ON launch_events(meme_id, created_at);
CREATE INDEX IF NOT EXISTS idx_launch_events_phase ON launch_events(phase, created_at);

-- RLS: internal launch operations are not public.
-- API routes use the service role key (bypasses RLS); enabling RLS with
-- no policies means the anon key cannot read these rows at all.
ALTER TABLE launch_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE launch_events IS 'Durable per-step audit log of token launches and reconciliation/auto-recovery actions';
COMMENT ON COLUMN launch_events.phase IS 'Launch step or recovery action, e.g. create_sent, curve_ready, buy_confirmed, buy_failed, reconcile_recovered, reconcile_refunded';
COMMENT ON COLUMN launch_events.detail IS 'Arbitrary JSON context for the event (amounts, errors, balances)';
