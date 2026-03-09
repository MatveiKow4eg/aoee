-- Phase B: physically remove legacy AoE2Insights columns from `users`
-- Runtime / DTO / frontend already migrated to use `AoePlayer` as the only source of truth.

-- Drop legacy columns (nullable, legacy)
ALTER TABLE "users" DROP COLUMN IF EXISTS "aoe_linked_at";
ALTER TABLE "users" DROP COLUMN IF EXISTS "aoe_nickname";
ALTER TABLE "users" DROP COLUMN IF EXISTS "aoe_profile_id";
ALTER TABLE "users" DROP COLUMN IF EXISTS "aoe_profile_url";
