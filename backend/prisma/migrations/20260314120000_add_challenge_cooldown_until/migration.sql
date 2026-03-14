-- Add missing column for User.challengeCooldownUntil
-- This column exists in prisma/schema.prisma as @map("challenge_cooldown_until")
-- but was missing from migrations, causing Prisma P2022 ColumnNotFound on queries.

ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "challenge_cooldown_until" TIMESTAMP(3);
