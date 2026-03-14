import { getDefaultMap, putDefaultMap } from "../lib/api/maps";

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
  // Player records may include extra profile fields used by the UI (admin edits):
  // name/title/desc are intentionally allowed and persisted.
  // Identity is canonicalized to `aoeProfileId` (string). Legacy `insightsUserId` may exist in old payloads.
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
      /** user id linked via claim (enriched by backend) */
      userId?: string;
      /** @deprecated legacy; should not be produced by admin/editor */
      insightsUserId?: string;
    }
  >;
  meta?: unknown;
};

export async function loadMapState(): Promise<MapStatePayloadV1 | null> {
  try {
    return await getDefaultMap();
  } catch (e) {
    console.warn("[API] getDefaultMap failed", e);
    return null;
  }
}

export async function saveMapState(payload: MapStatePayloadV1): Promise<void> {
  await putDefaultMap(payload);
}

export function debounce<T extends (...args: any[]) => void>(fn: T, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  const wrapped = (...args: Parameters<T>) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => {
    if (t) clearTimeout(t);
    t = undefined;
  };
  return wrapped as T & { cancel: () => void };
}
