-- CreateTable
CREATE TABLE "map_states" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "world_w" INTEGER NOT NULL,
    "world_h" INTEGER NOT NULL,
    "map_texture_version" INTEGER NOT NULL DEFAULT 1,
    "meta_json" JSONB,

    CONSTRAINT "map_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "map_buildings" (
    "id" TEXT NOT NULL,
    "map_state_id" TEXT NOT NULL,
    "building_key" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "zone_x" DOUBLE PRECISION NOT NULL,
    "zone_y" DOUBLE PRECISION NOT NULL,
    "zone_w" DOUBLE PRECISION NOT NULL,
    "zone_h" DOUBLE PRECISION NOT NULL,
    "scale" DOUBLE PRECISION,
    "rotation" DOUBLE PRECISION,
    "proj_0" DOUBLE PRECISION,
    "proj_1" DOUBLE PRECISION,
    "proj_2" DOUBLE PRECISION,
    "proj_3" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "map_buildings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "map_players" (
    "id" TEXT NOT NULL,
    "map_state_id" TEXT NOT NULL,
    "player_key" TEXT NOT NULL,
    "x" DOUBLE PRECISION,
    "y" DOUBLE PRECISION,
    "tier" INTEGER,
    "name" TEXT,
    "title" TEXT,
    "desc" TEXT,
    "extra_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "map_players_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "map_states_slug_key" ON "map_states"("slug");

-- CreateIndex
CREATE INDEX "map_states_slug_idx" ON "map_states"("slug");

-- CreateIndex
CREATE INDEX "map_buildings_map_state_id_building_key_idx" ON "map_buildings"("map_state_id", "building_key");

-- CreateIndex
CREATE INDEX "map_players_map_state_id_player_key_idx" ON "map_players"("map_state_id", "player_key");

-- AddForeignKey
ALTER TABLE "map_buildings" ADD CONSTRAINT "map_buildings_map_state_id_fkey" FOREIGN KEY ("map_state_id") REFERENCES "map_states"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "map_players" ADD CONSTRAINT "map_players_map_state_id_fkey" FOREIGN KEY ("map_state_id") REFERENCES "map_states"("id") ON DELETE CASCADE ON UPDATE CASCADE;
