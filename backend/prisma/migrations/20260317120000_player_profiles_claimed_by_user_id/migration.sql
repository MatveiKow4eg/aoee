-- Add claimed_by_user_id to player_profiles to support OR-identity model
-- Identity is always player_key; claim is an optional link to users.

ALTER TABLE "player_profiles" ADD COLUMN IF NOT EXISTS "claimed_by_user_id" TEXT;

-- One user can claim at most one player profile
CREATE UNIQUE INDEX IF NOT EXISTS "player_profiles_claimed_by_user_id_key" ON "player_profiles"("claimed_by_user_id");

CREATE INDEX IF NOT EXISTS "player_profiles_claimed_by_user_id_idx" ON "player_profiles"("claimed_by_user_id");

ALTER TABLE "player_profiles" DROP CONSTRAINT IF EXISTS "player_profiles_claimed_by_user_id_fkey";
ALTER TABLE "player_profiles"
  ADD CONSTRAINT "player_profiles_claimed_by_user_id_fkey"
  FOREIGN KEY ("claimed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backward-compat: if legacy user_id was used, mirror it into claimed_by_user_id when safe.
-- This is best-effort and will skip rows that would violate uniqueness.
DO $$
BEGIN
  -- Only run if user_id exists and claimed_by_user_id is still null
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'player_profiles' AND column_name = 'user_id'
  ) THEN
    -- Update rows where user_id is set and claimed_by_user_id is null,
    -- but only if that user_id is not already used as claimed_by_user_id elsewhere.
    UPDATE "player_profiles" pp
    SET "claimed_by_user_id" = pp."user_id"
    WHERE pp."claimed_by_user_id" IS NULL
      AND pp."user_id" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "player_profiles" pp2
        WHERE pp2."claimed_by_user_id" = pp."user_id"
      );
  END IF;
END$$;
