-- Migration: Add tokens_received column to backings
-- Tracks how many tokens each backer received from the burner buy

ALTER TABLE backings ADD COLUMN IF NOT EXISTS tokens_received NUMERIC DEFAULT 0;

COMMENT ON COLUMN backings.tokens_received IS 'Number of tokens received from the burner wallet buy';
