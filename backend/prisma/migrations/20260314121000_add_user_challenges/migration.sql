-- Create missing table for `UserChallenge` model.
-- This table is referenced by ChallengeService and required for /api/challenges.

-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ChallengeStatus') THEN
    CREATE TYPE "ChallengeStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'EXPIRED', 'CANCELLED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ChallengeResult') THEN
    CREATE TYPE "ChallengeResult" AS ENUM ('CHALLENGER_WON', 'CHALLENGER_LOST', 'DRAW', 'NO_SHOW');
  END IF;
END$$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "user_challenges" (
  "id" TEXT NOT NULL,

  "challenger_user_id" TEXT NOT NULL,
  "target_user_id" TEXT NOT NULL,

  "status" "ChallengeStatus" NOT NULL DEFAULT 'ACTIVE',
  "result" "ChallengeResult",

  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "accepted_at" TIMESTAMP(3) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,

  "resolved_at" TIMESTAMP(3),
  "resolved_by_user_id" TEXT,

  "winner_user_id" TEXT,
  "loser_user_id" TEXT,

  "notes" TEXT,

  CONSTRAINT "user_challenges_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX IF NOT EXISTS "user_challenges_challenger_user_id_idx" ON "user_challenges"("challenger_user_id");
CREATE INDEX IF NOT EXISTS "user_challenges_target_user_id_idx" ON "user_challenges"("target_user_id");
CREATE INDEX IF NOT EXISTS "user_challenges_status_idx" ON "user_challenges"("status");
CREATE INDEX IF NOT EXISTS "user_challenges_expires_at_idx" ON "user_challenges"("expires_at");

-- Foreign keys
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_challenges_challenger_user_id_fkey'
  ) THEN
    ALTER TABLE "user_challenges"
      ADD CONSTRAINT "user_challenges_challenger_user_id_fkey"
      FOREIGN KEY ("challenger_user_id") REFERENCES "users"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_challenges_target_user_id_fkey'
  ) THEN
    ALTER TABLE "user_challenges"
      ADD CONSTRAINT "user_challenges_target_user_id_fkey"
      FOREIGN KEY ("target_user_id") REFERENCES "users"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_challenges_resolved_by_user_id_fkey'
  ) THEN
    ALTER TABLE "user_challenges"
      ADD CONSTRAINT "user_challenges_resolved_by_user_id_fkey"
      FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END$$;
