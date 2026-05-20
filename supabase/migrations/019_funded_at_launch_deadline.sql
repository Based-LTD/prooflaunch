-- 019 — funded_at + 24h launch countdown
--
-- Adds the timestamp the meme reached `funded` status. When set, the
-- meme MUST be launched within LAUNCH_DEADLINE_HOURS (24h, enforced
-- in /api/process-memes) or every backer is auto-refunded and the
-- meme flips to `failed`. Pre-existing funded memes (PROOF) keep
-- `funded_at = NULL` and are grandfathered out of the rule forever
-- — the cron's IS NOT NULL gate skips them.
--
-- Closes the abandonment hole where a creator could withdraw their
-- own backing mid-fill, watch the meme reach `funded` via other
-- backers, and then never click launch — backers' SOL would have
-- been locked in the pool wallet indefinitely.

ALTER TABLE memes
  ADD COLUMN IF NOT EXISTS funded_at TIMESTAMPTZ;

-- Helpful index for the new cron query
-- (status='funded' AND launched_at IS NULL AND funded_at < NOW() - 24h)
CREATE INDEX IF NOT EXISTS idx_memes_funded_at_pending_launch
  ON memes(funded_at)
  WHERE status = 'funded' AND launched_at IS NULL AND funded_at IS NOT NULL;

COMMENT ON COLUMN memes.funded_at IS
  'When the meme first reached funded status. NULL = grandfathered (pre-019 funded memes never expire). Non-NULL + status=funded + launched_at IS NULL + funded_at < NOW()-24h => process-memes cron auto-refunds all backers.';
