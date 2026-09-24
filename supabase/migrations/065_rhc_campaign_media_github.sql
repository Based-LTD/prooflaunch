-- 065 — GitHub link for Robinhood Chain campaigns
-- pons' on-chain socials struct is fixed (twitter, telegram, discord,
-- website, farcaster), so the repo link lives with the other creator-signed
-- soft metadata (064). Same write path, same creator() check.
alter table rhc_campaign_media add column if not exists github text;
