-- Add optional SteamID binding for existing player profiles

-- AlterTable
ALTER TABLE "aoe_players" ADD COLUMN "steam_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "aoe_players_steam_id_key" ON "aoe_players"("steam_id");
