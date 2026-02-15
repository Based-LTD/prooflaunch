-- Add slot-based backing columns to memes table
-- Replaces the old backing_goal_sol system with per-slot minimum backing

-- Number of backer slots (2-8)
ALTER TABLE memes ADD COLUMN IF NOT EXISTS total_slots INTEGER DEFAULT 4;

-- Minimum SOL per backer (set by creator)
ALTER TABLE memes ADD COLUMN IF NOT EXISTS min_backing_sol NUMERIC(20, 9) DEFAULT 0.1;

-- Creator's personal twitter (not token metadata twitter)
ALTER TABLE memes ADD COLUMN IF NOT EXISTS creator_twitter TEXT;

-- Slot number for backings
ALTER TABLE backings ADD COLUMN IF NOT EXISTS slot_number INTEGER;

-- Add constraints
ALTER TABLE memes ADD CONSTRAINT check_total_slots_range
  CHECK (total_slots >= 2 AND total_slots <= 8);

ALTER TABLE memes ADD CONSTRAINT check_min_backing_positive
  CHECK (min_backing_sol > 0);
