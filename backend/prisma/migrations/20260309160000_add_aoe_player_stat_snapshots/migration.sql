-- Add cached stat snapshots for AoePlayer (read-only enrichment layer)

CREATE TABLE "aoe_player_stat_snapshots" (
  "id" TEXT NOT NULL,
  "aoe_player_id" TEXT NOT NULL,
  "leaderboard_id" TEXT,
  "rating" INTEGER,
  "rank" INTEGER,
  "rank_total" INTEGER,
  "wins" INTEGER,
  "losses" INTEGER,
  "streak" INTEGER,
  "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "aoe_player_stat_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "aoe_player_stat_snapshots_aoe_player_id_key" ON "aoe_player_stat_snapshots"("aoe_player_id");
CREATE INDEX "aoe_player_stat_snapshots_synced_at_idx" ON "aoe_player_stat_snapshots"("synced_at");

ALTER TABLE "aoe_player_stat_snapshots" ADD CONSTRAINT "aoe_player_stat_snapshots_aoe_player_id_fkey"
  FOREIGN KEY ("aoe_player_id") REFERENCES "aoe_players"("id") ON DELETE CASCADE ON UPDATE CASCADE;
