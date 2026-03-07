-- CreateTable
CREATE TABLE "aoe_players" (
    "id" TEXT NOT NULL,
    "aoe_profile_id" TEXT NOT NULL,
    "aoe_profile_url" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "claimed_by_user_id" TEXT,
    "claimed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aoe_players_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "aoe_players_aoe_profile_id_key" ON "aoe_players"("aoe_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "aoe_players_claimed_by_user_id_key" ON "aoe_players"("claimed_by_user_id");

-- CreateIndex
CREATE INDEX "aoe_players_claimed_by_user_id_idx" ON "aoe_players"("claimed_by_user_id");

-- AddForeignKey
ALTER TABLE "aoe_players" ADD CONSTRAINT "aoe_players_claimed_by_user_id_fkey" FOREIGN KEY ("claimed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
