-- Add 'withdrawn' status to backing_status enum
-- This allows backers to voluntarily withdraw during the proving phase

-- Add the new enum value
ALTER TYPE backing_status ADD VALUE IF NOT EXISTS 'withdrawn';

-- Update the trigger to properly handle both withdrawn and refunded statuses
CREATE OR REPLACE FUNCTION update_meme_backing()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- New backing added - only count if confirmed
    IF NEW.status = 'confirmed' THEN
      UPDATE memes
      SET current_backing_sol = current_backing_sol + NEW.amount_sol,
          updated_at = NOW()
      WHERE id = NEW.meme_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Handle status transitions
    -- If going TO confirmed (first time confirmation)
    IF OLD.status != 'confirmed' AND NEW.status = 'confirmed' THEN
      UPDATE memes
      SET current_backing_sol = current_backing_sol + NEW.amount_sol,
          updated_at = NOW()
      WHERE id = NEW.meme_id;
    -- If going FROM confirmed TO withdrawn or refunded
    ELSIF OLD.status = 'confirmed' AND NEW.status IN ('withdrawn', 'refunded') THEN
      UPDATE memes
      SET current_backing_sol = current_backing_sol - OLD.amount_sol,
          updated_at = NOW()
      WHERE id = NEW.meme_id;
    END IF;

    -- Check if goal reached after any update
    UPDATE memes
    SET status = 'funded'
    WHERE id = NEW.meme_id
      AND current_backing_sol >= backing_goal_sol
      AND status = 'backing';

    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    -- Only subtract if was confirmed
    IF OLD.status = 'confirmed' THEN
      UPDATE memes
      SET current_backing_sol = current_backing_sol - OLD.amount_sol,
          updated_at = NOW()
      WHERE id = OLD.meme_id;
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Ensure trigger is set up correctly
DROP TRIGGER IF EXISTS trigger_update_meme_backing ON backings;
CREATE TRIGGER trigger_update_meme_backing
  AFTER INSERT OR UPDATE OR DELETE ON backings
  FOR EACH ROW
  EXECUTE FUNCTION update_meme_backing();
