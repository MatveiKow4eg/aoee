import { MapRepository } from '../repositories/mapRepository';
import { HttpError } from '../utils/httpError';

export type MapStatePayloadV1 = {
  world: { w: number; h: number; mapTextureVersion: number };
  buildings: Record<
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
  /**
   * players payload:
   * - NEW canonical reference: `aoeProfileId` (string)
   * - Deprecated transitional fallback: `insightsUserId` (string)
   */
  players: Record<
    string,
    {
      x?: number;
      y?: number;
      tier?: string;
      name?: string;
      title?: string;
      desc?: string;
      aoeProfileId?: string;
      /** @deprecated legacy field kept for backward compatibility */
      insightsUserId?: string;
    }
  >;
  meta?: unknown;
};

export class MapService {
  constructor(private readonly repo = new MapRepository()) {}

  async getMapPayload(slug: string): Promise<MapStatePayloadV1> {
    const state = await this.repo.getBySlug(slug);
    if (!state) throw new HttpError(404, 'MAP_NOT_FOUND', `Map '${slug}' not found`);

    const buildings: MapStatePayloadV1['buildings'] = {};
    for (const b of state.buildings) {
      const proj =
        typeof b.proj0 === 'number' || typeof b.proj1 === 'number' || typeof b.proj2 === 'number' || typeof b.proj3 === 'number'
          ? ([b.proj0 ?? 0, b.proj1 ?? 0, b.proj2 ?? 0, b.proj3 ?? 0] as [number, number, number, number])
          : undefined;

      buildings[b.buildingKey] = {
        x: b.x,
        y: b.y,
        zone: { x: b.zoneX, y: b.zoneY, w: b.zoneW, h: b.zoneH },
        ...(typeof b.scale === 'number' ? { scale: b.scale } : {}),
        ...(typeof b.rotation === 'number' ? { rotation: b.rotation } : {}),
        ...(proj ? { proj } : {}),
      };
    }

    const players: MapStatePayloadV1['players'] = {};
    for (const p of state.players) {
      players[p.playerKey] = {
        ...(typeof p.x === 'number' ? { x: p.x } : {}),
        ...(typeof p.y === 'number' ? { y: p.y } : {}),
        ...(typeof p.tier === 'string' ? { tier: p.tier } : {}),
        ...(p.name ? { name: p.name } : {}),
        ...(p.title ? { title: p.title } : {}),
        ...(p.desc ? { desc: p.desc } : {}),
        ...(p.extraJson && typeof p.extraJson === 'object' ? (p.extraJson as any) : {}),
      };
    }

    return {
      world: {
        w: state.worldW,
        h: state.worldH,
        mapTextureVersion: state.mapTextureVersion,
      },
      buildings,
      players,
      ...(state.metaJson ? { meta: state.metaJson } : {}),
    };
  }

  async saveMap(slug: string, payload: Partial<MapStatePayloadV1>, version?: number) {
    const saved = await this.repo.saveMapTransactional({
      slug,
      version,
      ...(payload.world !== undefined ? { world: payload.world } : {}),
      ...(payload.buildings !== undefined ? { buildings: payload.buildings } : {}),
      ...(payload.players !== undefined ? { players: payload.players as any } : {}),
      ...(payload.meta !== undefined ? { meta: payload.meta } : {}),
    });

    if (!saved) throw new HttpError(500, 'MAP_SAVE_FAILED', `Failed to save map '${slug}'`);
    return this.getMapPayload(slug);
  }

  async saveBuildings(slug: string, buildings: MapStatePayloadV1['buildings']) {
    const saved = await this.repo.saveMapTransactional({ slug, buildings });
    if (!saved) throw new HttpError(500, 'MAP_SAVE_FAILED', `Failed to save buildings for map '${slug}'`);
    return this.getMapPayload(slug);
  }

  async savePlayers(slug: string, players: MapStatePayloadV1['players']) {
    const saved = await this.repo.saveMapTransactional({ slug, players: players as any });
    if (!saved) throw new HttpError(500, 'MAP_SAVE_FAILED', `Failed to save players for map '${slug}'`);
    return this.getMapPayload(slug);
  }
}
