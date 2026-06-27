-- Geographic-restriction attestation captured per-backing.
--
-- BACKGROUND: Prooflaunch's compliance posture for the KOL launch
-- includes a four-layer defense against passive fee distribution to
-- U.S. persons (and other OFAC-sanctioned jurisdictions):
--
--   Layer 1 — IP geoblock at the edge (src/middleware.ts)
--   Layer 2 — Frontend disclosure on token pages + backing dialog
--   Layer 3 — Per-action attestation captured BY THE USER, stored HERE
--   Layer 4 — Pull-claim fee distribution (already shipped — distribution.ts
--             only credits claimable_fees_sol, never auto-pushes SOL)
--
-- THIS MIGRATION is Layer 3's persistence: each backing row carries the
-- version-tagged + timestamped acknowledgement the user affirmatively
-- ticked in the confirm dialog. Capturing per-backing (rather than once
-- per wallet) means we have non-repudiable evidence for each individual
-- economic action — the stronger legal position.
--
-- attestation_version
--   The disclosure language is versioned (e.g. 'geo-v1'). When the
--   lawyer adjusts wording we bump the version, the API rejects old
--   versions, and users re-acknowledge. All historical attestations
--   remain queryable + auditable by version.
--
-- attested_at
--   Wall-clock ISO timestamp from the client at the moment of
--   acknowledgement. Server validates it's within a 24h window of
--   ingestion to defeat stale-replay (see src/app/api/backings/route.ts).
--
-- attested_from_country
--   The 2-letter country code Vercel's edge attributed to the request
--   IP at the moment of backing. NOT a gate — the IP geoblock middleware
--   already handles that. Stored for forensic comparison: if a row ever
--   shows attested_from_country='US' + attestation_version='geo-v1',
--   that's evidence of misrepresentation by the user (which the
--   acknowledgement language itself warns against).
--
-- All three columns are nullable for historical rows (pre-migration
-- backings predate the attestation gate). New rows ARE required to have
-- attestation_version + attested_at populated — the API enforces it
-- before insert; the DB level keeps them nullable to grandfather old
-- data.

ALTER TABLE backings
  ADD COLUMN IF NOT EXISTS attestation_version TEXT,
  ADD COLUMN IF NOT EXISTS attested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attested_from_country TEXT;

-- Index on attestation_version so the team can query forensically
-- (e.g. "how many backings on language version geo-v2 came from US IPs").
-- Tiny index; only meaningful when we have multiple versions in flight.
CREATE INDEX IF NOT EXISTS backings_attestation_version_idx
  ON backings(attestation_version) WHERE attestation_version IS NOT NULL;
