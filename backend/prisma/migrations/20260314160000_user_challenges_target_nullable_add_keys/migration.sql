-- Make challenges creatable even when the target is not claimed yet.
-- Store map playerKey + aoeProfileId so we can later resolve to a User once claim appears.

-- 1) Allow target_user_id to be NULL
ALTER TABLE "user_challenges" ALTER COLUMN "target_user_id" DROP NOT NULL;

-- 1.1) Drop FK and recreate it with ON DELETE SET NULL (target can be missing)
ALTER TABLE "user_challenges" DROP CONSTRAINT IF EXISTS "user_challenges_target_user_id_fkey";
ALTER TABLE "user_challenges"
  ADD CONSTRAINT "user_challenges_target_user_id_fkey"
  FOREIGN KEY ("target_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 2) Add optional target_player_key and target_aoe_profile_id
ALTER TABLE "user_challenges" ADD COLUMN IF NOT EXISTS "target_player_key" TEXT;
ALTER TABLE "user_challenges" ADD COLUMN IF NOT EXISTS "target_aoe_profile_id" TEXT;

-- 3) Indexes for lookups
CREATE INDEX IF NOT EXISTS "user_challenges_target_player_key_idx" ON "user_challenges" ("target_player_key");
CREATE INDEX IF NOT EXISTS "user_challenges_target_aoe_profile_id_idx" ON "user_challenges" ("target_aoe_profile_id");
