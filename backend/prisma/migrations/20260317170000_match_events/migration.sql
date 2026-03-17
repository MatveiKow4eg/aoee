-- CreateEnum
CREATE TYPE "MatchEventFormat" AS ENUM ('ONE_V_ONE', 'TWO_V_TWO', 'THREE_V_THREE', 'FOUR_V_FOUR');

-- CreateEnum
CREATE TYPE "MatchEventStatus" AS ENUM ('OPEN', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MatchEventSide" AS ENUM ('A', 'B');

-- CreateEnum
CREATE TYPE "MatchEventParticipantResult" AS ENUM ('WIN', 'LOSS');

-- CreateTable
CREATE TABLE "match_events" (
    "id" TEXT NOT NULL,
    "format" "MatchEventFormat" NOT NULL,
    "status" "MatchEventStatus" NOT NULL DEFAULT 'OPEN',
    "winner_side" "MatchEventSide",
    "created_by_user_id" TEXT NOT NULL,
    "resolved_by_user_id" TEXT,
    "rating_applied_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "match_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_event_participants" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "side" "MatchEventSide" NOT NULL,
    "slot" INTEGER NOT NULL,
    "player_key" TEXT NOT NULL,
    "user_id" TEXT,
    "aoe_profile_id" TEXT,
    "display_name_snapshot" TEXT NOT NULL,
    "avatar_url_snapshot" TEXT,
    "result" "MatchEventParticipantResult",
    "rating_delta" INTEGER,

    CONSTRAINT "match_event_participants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "match_events_status_created_at_idx" ON "match_events"("status", "created_at");

-- CreateIndex
CREATE INDEX "match_events_created_by_user_id_idx" ON "match_events"("created_by_user_id");

-- CreateIndex
CREATE INDEX "match_events_resolved_by_user_id_idx" ON "match_events"("resolved_by_user_id");

-- CreateIndex
CREATE INDEX "match_event_participants_event_id_idx" ON "match_event_participants"("event_id");

-- CreateIndex
CREATE INDEX "match_event_participants_player_key_idx" ON "match_event_participants"("player_key");

-- CreateIndex
CREATE INDEX "match_event_participants_user_id_idx" ON "match_event_participants"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "match_event_participants_event_id_side_slot_key" ON "match_event_participants"("event_id", "side", "slot");

-- AddForeignKey
ALTER TABLE "match_events" ADD CONSTRAINT "match_events_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_events" ADD CONSTRAINT "match_events_resolved_by_user_id_fkey" FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_event_participants" ADD CONSTRAINT "match_event_participants_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "match_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_event_participants" ADD CONSTRAINT "match_event_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
