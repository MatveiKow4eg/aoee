import { prisma } from '../db/prisma';

export class MapRepository {
  async getBySlug(slug: string) {
    return prisma.mapState.findUnique({
      where: { slug },
      include: {
        buildings: true,
        players: true,
      },
    });
  }

  async ensureDefaultExists() {
    const slug = 'default';
    const existing = await prisma.mapState.findUnique({ where: { slug } });
    if (existing) return existing;

    return prisma.mapState.create({
      data: {
        slug,
        version: 1,
        worldW: 3000,
        worldH: 1800,
        mapTextureVersion: 1,
        metaJson: {},
      },
    });
  }

  /**
   * Atomic save of MapState + buildings + players.
   *
   * Rules:
   * - if buildings are omitted -> keep as is
   * - if players are omitted -> keep as is
   * - if players provided as empty object AND there are already players in DB -> keep as is (protective behavior)
   */
  async saveMapTransactional(args: {
    slug: string;
    version?: number;
    meta?: unknown;
    world?: { w: number; h: number; mapTextureVersion: number };
    buildings?: Record<
      string,
      {
        x: number;
        y: number;
        zone: { x: number; y: number; w: number; h: number };
        scale?: number;
        rotation?: number;
        proj?: [number, number, number, number];
      }
    >;
    players?: Record<string, any>;
  }) {
    const { slug, version, meta, world, buildings, players } = args;

    return prisma.$transaction(async (tx) => {
      const state = await tx.mapState.upsert({
        where: { slug },
        create: {
          slug,
          version: version ?? 1,
          worldW: world?.w ?? 3000,
          worldH: world?.h ?? 1800,
          mapTextureVersion: world?.mapTextureVersion ?? 1,
          metaJson: meta === undefined ? undefined : (meta as any),
        },
        update: {
          ...(typeof version === 'number' ? { version } : {}),
          ...(world
            ? {
                worldW: world.w,
                worldH: world.h,
                mapTextureVersion: world.mapTextureVersion,
              }
            : {}),
          ...(meta !== undefined ? { metaJson: meta as any } : {}),
          updatedAt: new Date(),
        },
      });

      if (buildings !== undefined) {
        await tx.mapBuilding.deleteMany({ where: { mapStateId: state.id } });
        const entries = Object.entries(buildings);
        if (entries.length) {
          await tx.mapBuilding.createMany({
            data: entries.map(([buildingKey, b]) => ({
              mapStateId: state.id,
              buildingKey,
              x: b.x,
              y: b.y,
              zoneX: b.zone.x,
              zoneY: b.zone.y,
              zoneW: b.zone.w,
              zoneH: b.zone.h,
              scale: typeof b.scale === 'number' ? b.scale : null,
              rotation: typeof b.rotation === 'number' ? b.rotation : null,
              proj0: b.proj ? b.proj[0] : null,
              proj1: b.proj ? b.proj[1] : null,
              proj2: b.proj ? b.proj[2] : null,
              proj3: b.proj ? b.proj[3] : null,
            })),
          });
        }
      }

      if (players !== undefined) {
        const incomingKeys = Object.keys(players);
        const existingCount = await tx.mapPlayer.count({ where: { mapStateId: state.id } });
        const isProtectiveEmpty = incomingKeys.length === 0 && existingCount > 0;

        if (!isProtectiveEmpty) {
          await tx.mapPlayer.deleteMany({ where: { mapStateId: state.id } });
          if (incomingKeys.length) {
            await tx.mapPlayer.createMany({
              data: incomingKeys.map((playerKey) => {
                const p = players[playerKey] ?? {};
                const { x, y, tier, name, title, desc, ...rest } = p;
                const extraJson = Object.keys(rest).length ? (rest as any) : null;

                return {
                  mapStateId: state.id,
                  playerKey,
                  x: typeof x === 'number' ? x : null,
                  y: typeof y === 'number' ? y : null,
                  tier: tier === undefined || tier === null ? null : String(tier),
                  name: typeof name === 'string' ? name : null,
                  title: typeof title === 'string' ? title : null,
                  desc: typeof desc === 'string' ? desc : null,
                  extraJson: extraJson as any,
                };
              }),
            });
          }
        }
      }

      return tx.mapState.findUnique({
        where: { slug },
        include: { buildings: true, players: true },
      });
    });
  }
}
