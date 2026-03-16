-- Add rating points to users
ALTER TABLE "users" ADD COLUMN "rating_points" INTEGER NOT NULL DEFAULT 0;

-- Add guard to prevent double rating application
ALTER TABLE "user_challenges" ADD COLUMN "rating_applied_at" TIMESTAMP(3);

-- Create enum for rating event reasons
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'UserRatingEventReason') THEN
    CREATE TYPE "UserRatingEventReason" AS ENUM ('CHALLENGE_WIN', 'CHALLENGE_LOSS', 'ADMIN_ADJUST');
  END IF;
END$$;

-- Create rating events table
CREATE TABLE "user_rating_events" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "challenge_id" TEXT,
  "delta" INTEGER NOT NULL,
  "reason" "UserRatingEventReason" NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "user_rating_events_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "user_rating_events_user_id_idx" ON "user_rating_events"("user_id");
CREATE INDEX "user_rating_events_challenge_id_idx" ON "user_rating_events"("challenge_id");
CREATE INDEX "user_rating_events_reason_idx" ON "user_rating_events"("reason");
CREATE INDEX "user_rating_events_created_at_idx" ON "user_rating_events"("created_at");

CREATE INDEX "users_rating_points_idx" ON "users"("rating_points");

-- FKs
ALTER TABLE "user_rating_events" ADD CONSTRAINT "user_rating_events_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_rating_events" ADD CONSTRAINT "user_rating_events_challenge_id_fkey"
  FOREIGN KEY ("challenge_id") REFERENCES "user_challenges"("id") ON DELETE SET NULL ON UPDATE CASCADE;
