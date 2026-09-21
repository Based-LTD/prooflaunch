-- 063 — Robinhood Chain campaign media (banner)
--
-- pons' on-chain token meta carries a logo but no banner, and a banner is
-- too big to put on-chain anyway. Same pattern as the SOL side (028):
-- the image lives in Storage (token-assets/banners/<sha256>.<ext>, via
-- /api/upload/image kind=banner) and this row holds the public URL,
-- keyed by campaign address. Writes go through /api/rhc/media with an
-- EIP-191 signature AND an on-chain check that the signer is the
-- campaign's creator(); reads re-check that so a stale or squatted row
-- can never show. RLS on, no public policies (service role only).
create table if not exists rhc_campaign_media (
  campaign text primary key,        -- campaign contract address, lowercase 0x…
  banner_url text,
  set_by text not null,             -- EVM address that signed, lowercase
  updated_at timestamptz not null default now()
);

alter table rhc_campaign_media enable row level security;
