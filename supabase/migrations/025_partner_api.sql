-- Partner API v1 — Tier 1 (Hosted Checkout) tables.
--
-- Two tables:
--   partners            — one row per integration partner (DAEMON, etc.)
--                         stores hashed API key + webhook secret + rev-share config
--   partner_sessions    — one row per checkout session (each meme submission
--                         initiated by a partner). Links partner → eventual meme_id.
--
-- Auth model: partner sends `Authorization: Bearer pl_live_<32chars>` on every
-- request. Server hashes the presented key (SHA-256, fixed salt) and looks it
-- up against partners.api_key_hash. We never store the raw key after issuance.
--
-- Webhook signing: HMAC-SHA256 with partners.webhook_secret. Partner verifies
-- by recomputing and comparing X-Proof-Signature header.
--
-- Rev-share: partners.rev_share_bps stores their cut of the platform's 5%
-- trading fee share, in basis points (250 = 2.5% absolute). Default 0 means
-- no rev-share until explicitly enabled per partner.

CREATE TABLE IF NOT EXISTS partners (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT NOT NULL UNIQUE,             -- e.g. 'daemon' — used in attribution URLs (?via=daemon)
  display_name    TEXT NOT NULL,                    -- e.g. 'DAEMON IDE' — shown publicly on launch pages
  contact_email   TEXT,                              -- where we email on webhook failures, key rotation, etc.

  -- Auth
  api_key_hash    TEXT NOT NULL UNIQUE,             -- sha256(api_key) hex. Raw key only shown at issuance.
  api_key_prefix  TEXT NOT NULL,                    -- first 12 chars of raw key, for partner identification ("pl_live_a1b2c3d4e5f6")
  webhook_secret  TEXT NOT NULL,                    -- 64-char hex, partner uses to verify webhook HMAC
  environment     TEXT NOT NULL DEFAULT 'live'
                    CHECK (environment IN ('live', 'test')),

  -- Rev-share & attribution
  partner_wallet      TEXT,                          -- Solana pubkey where partner's rev-share SOL routes
  rev_share_bps       INT NOT NULL DEFAULT 0,        -- partner's cut of platform's 5% in basis points (250 = 2.5% absolute)
                                                     -- e.g. rev_share_bps=250 → partner gets half the platform's 5% on their launches

  -- Webhooks
  default_webhook_url TEXT,                          -- fallback webhook URL if session doesn't specify one

  -- Operational
  rate_limit_per_minute INT NOT NULL DEFAULT 60,
  enabled         BOOLEAN NOT NULL DEFAULT TRUE,    -- kill switch; set FALSE to disable a partner without deleting

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  key_rotated_at  TIMESTAMPTZ,                       -- bumped when API key is regenerated
  last_seen_at    TIMESTAMPTZ                        -- bumped on every authenticated request
);

CREATE INDEX IF NOT EXISTS idx_partners_api_key_hash ON partners(api_key_hash);
CREATE INDEX IF NOT EXISTS idx_partners_slug ON partners(slug);


CREATE TABLE IF NOT EXISTS partner_sessions (
  id                  TEXT PRIMARY KEY,             -- 'pls_<16chars>' — returned to partner as session_id
  partner_id          UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,

  -- Captured at creation — what the user will see prefilled on /submit
  name                TEXT NOT NULL,
  symbol              TEXT NOT NULL,
  description         TEXT NOT NULL,
  image_url           TEXT,                          -- partner may supply remote URL; user can override
  creator_wallet      TEXT NOT NULL,                 -- wallet that will sign the submission tx
  total_slots         INT NOT NULL,
  min_backing_sol     NUMERIC(20,9) NOT NULL,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,   -- socials (twitter, telegram, discord, website) + freeform partner fields

  -- Callbacks
  return_url          TEXT,                          -- partner UI to redirect to after submission
  webhook_url         TEXT,                          -- overrides partners.default_webhook_url for this session
  partner_reference   TEXT,                          -- arbitrary string the partner uses to correlate (their own ID)

  -- State
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'submitted', 'expired', 'cancelled')),
  meme_id             UUID REFERENCES memes(id) ON DELETE SET NULL,  -- populated when user completes /submit

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at        TIMESTAMPTZ,
  expires_at          TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours'
);

CREATE INDEX IF NOT EXISTS idx_partner_sessions_partner ON partner_sessions(partner_id);
CREATE INDEX IF NOT EXISTS idx_partner_sessions_status ON partner_sessions(status);
CREATE INDEX IF NOT EXISTS idx_partner_sessions_meme ON partner_sessions(meme_id) WHERE meme_id IS NOT NULL;


-- Attach partner attribution directly to memes so the join is cheap when
-- listing a partner's launches and when routing rev-share at fee distribution.
ALTER TABLE memes
  ADD COLUMN IF NOT EXISTS partner_id         UUID REFERENCES partners(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS partner_session_id TEXT REFERENCES partner_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_memes_partner_id ON memes(partner_id) WHERE partner_id IS NOT NULL;


-- Request log — append-only audit trail. Enables rate limiting, debugging,
-- and forensics if a partner key gets compromised. Truncated by cron to
-- last 30 days (separate migration if/when we add the cron).
CREATE TABLE IF NOT EXISTS partner_request_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id      UUID REFERENCES partners(id) ON DELETE SET NULL,
  method          TEXT NOT NULL,                     -- 'POST' / 'GET' / etc.
  path            TEXT NOT NULL,                     -- '/api/v1/partners/sessions'
  status_code     INT NOT NULL,
  ip              TEXT,
  user_agent      TEXT,
  request_id      TEXT,                              -- partner's X-Request-Id header if supplied
  duration_ms     INT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_partner_log_partner_time ON partner_request_log(partner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_partner_log_time ON partner_request_log(created_at DESC);


-- RLS — partners and sessions are NEVER public-readable. Only service_role
-- writes/reads. Partner reads happen via authenticated API routes only,
-- which use the service-role client server-side.
ALTER TABLE partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_request_log ENABLE ROW LEVEL SECURITY;

-- No SELECT policies = no public reads (service_role bypasses RLS).
