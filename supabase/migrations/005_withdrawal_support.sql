-- Add withdrawal support to backings table

-- Transaction signature for refunds/withdrawals
ALTER TABLE backings ADD COLUMN IF NOT EXISTS refund_tx TEXT;

-- Comment on new column
COMMENT ON COLUMN backings.refund_tx IS 'Transaction signature for SOL refund when backer withdraws';

-- Update the trigger function to handle withdrawals
-- When a backing is withdrawn, subtract from current_backing_sol
CREATE OR REPLACE FUNCTION update_meme_backing()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- New backing added
    UPDATE memes
    SET current_backing_sol = current_backing_sol + NEW.amount_sol
    WHERE id = NEW.meme_id;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Check if status changed to 'withdrawn'
    IF OLD.status != 'withdrawn' AND NEW.status = 'withdrawn' THEN
      UPDATE memes
      SET current_backing_sol = current_backing_sol - NEW.amount_sol
      WHERE id = NEW.meme_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    -- Backing deleted (shouldn't happen normally)
    UPDATE memes
    SET current_backing_sol = current_backing_sol - OLD.amount_sol
    WHERE id = OLD.meme_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Recreate trigger to include UPDATE events
DROP TRIGGER IF EXISTS trigger_update_meme_backing ON backings;
CREATE TRIGGER trigger_update_meme_backing
  AFTER INSERT OR UPDATE OR DELETE ON backings
  FOR EACH ROW
  EXECUTE FUNCTION update_meme_backing();
