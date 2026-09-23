-- 064 — creator-editable soft metadata for Robinhood Chain campaigns
--
-- pons' on-chain token meta is immutable once launched, and the campaign
-- contract's copy is immutable on v7. The SOL side lets creators edit the
-- soft fields (description, socials) for the token's lifetime, DexScreener
-- style. Same home as the banner (063), same write path (/api/rhc/media,
-- EIP-191 signature + on-chain creator() check), same read-time check.
-- Null = no override; the page falls back to what the contract says.
alter table rhc_campaign_media
  add column if not exists description text,
  add column if not exists twitter text,
  add column if not exists telegram text,
  add column if not exists discord text,
  add column if not exists website text;
