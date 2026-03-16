-- PlayerKey-based profiles and rating events

-- 1) New enum for player rating event reasons
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PlayerRatingEventReason') THEN
    CREATE TYPE "PlayerRatingEventReason" AS ENUM ('CHALLENGE_WIN', 'CHALLENGE_LOSS', 'ADMIN_ADJUST');
  END IF;
END$$;

-- 2) Player profiles table
CREATE TABLE IF NOT EXISTS "player_profiles" (
  "id" TEXT NOT NULL,
  "player_key" TEXT NOT NULL,
  "aoe_profile_id" TEXT,
  "user_id" TEXT,
  "display_name" TEXT,
  "rating_points" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "player_profiles_pkey" PRIMARY KEY ("id")
);

-- Unique playerKey (requested)
CREATE UNIQUE INDEX IF NOT EXISTS "player_profiles_player_key_key" ON "player_profiles"("player_key");

-- Helpful indexes
CREATE INDEX IF NOT EXISTS "player_profiles_aoe_profile_id_idx" ON "player_profiles"("aoe_profile_id");
CREATE INDEX IF NOT EXISTS "player_profiles_user_id_idx" ON "player_profiles"("user_id");
CREATE INDEX IF NOT EXISTS "player_profiles_rating_points_idx" ON "player_profiles"("rating_points");

-- FK to users (optional link)
ALTER TABLE "player_profiles" DROP CONSTRAINT IF EXISTS "player_profiles_user_id_fkey";
ALTER TABLE "player_profiles"
  ADD CONSTRAINT "player_profiles_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3) Player rating events table
CREATE TABLE IF NOT EXISTS "player_rating_events" (
  "id" TEXT NOT NULL,
  "player_key" TEXT NOT NULL,
  "challenge_id" TEXT,
  "delta" INTEGER NOT NULL,
  "reason" "PlayerRatingEventReason" NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "player_rating_events_pkey" PRIMARY KEY ("id")
);

-- Indexes (requested)
CREATE INDEX IF NOT EXISTS "player_rating_events_player_key_idx" ON "player_rating_events"("player_key");
CREATE INDEX IF NOT EXISTS "player_rating_events_challenge_id_idx" ON "player_rating_events"("challenge_id");
CREATE INDEX IF NOT EXISTS "player_rating_events_reason_idx" ON "player_rating_events"("reason");
CREATE INDEX IF NOT EXISTS "player_rating_events_created_at_idx" ON "player_rating_events"("created_at");

-- FK to player_profiles by player_key
ALTER TABLE "player_rating_events" DROP CONSTRAINT IF EXISTS "player_rating_events_player_key_fkey";
ALTER TABLE "player_rating_events"
  ADD CONSTRAINT "player_rating_events_player_key_fkey"
  FOREIGN KEY ("player_key") REFERENCES "player_profiles"("player_key") ON DELETE CASCADE ON UPDATE CASCADE;

-- FK to user_challenges
ALTER TABLE "player_rating_events" DROP CONSTRAINT IF EXISTS "player_rating_events_challenge_id_fkey";
ALTER TABLE "player_rating_events"
  ADD CONSTRAINT "player_rating_events_challenge_id_fkey"
  FOREIGN KEY ("challenge_id") REFERENCES "user_challenges"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4) Add new columns to user_challenges
ALTER TABLE "user_challenges" ADD COLUMN IF NOT EXISTS "challenger_player_key" TEXT;
ALTER TABLE "user_challenges" ADD COLUMN IF NOT EXISTS "winner_player_key" TEXT;
ALTER TABLE "user_challenges" ADD COLUMN IF NOT EXISTS "loser_player_key" TEXT;

-- Indexes for winner/loser + rating_applied_at
CREATE INDEX IF NOT EXISTS "user_challenges_winner_player_key_idx" ON "user_challenges"("winner_player_key");
CREATE INDEX IF NOT EXISTS "user_challenges_loser_player_key_idx" ON "user_challenges"("loser_player_key");
CREATE INDEX IF NOT EXISTS "user_challenges_rating_applied_at_idx" ON "user_challenges"("rating_applied_at");
