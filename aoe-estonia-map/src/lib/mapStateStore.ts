import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { getDb } from "./firebase";

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
  players: Record<string, { x?: number; y?: number; tier?: string; name?: string; title?: string; desc?: string }>;
};

const DOC_PATH = "maps/default";

type FirestoreDoc = {
  payload: MapStatePayloadV1;
  version: 1;
  updatedAt?: unknown;
};

export async function loadMapState(): Promise<MapStatePayloadV1 | null> {
  let db;
  try {
    db = getDb();
  } catch (e) {
    console.warn("[Firestore] getDb() failed", e);
    return null;
  }

  try {
    const ref = doc(db, DOC_PATH);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      console.warn("[Firestore] doc does not exist:", DOC_PATH);
      return null;
    }

    const data = snap.data() as Partial<FirestoreDoc>;
    console.log("[Firestore] loaded:", DOC_PATH, data);

    if (!data || data.version !== 1 || !data.payload) {
      console.warn("[Firestore] invalid doc shape:", data);
      return null;
    }

    return data.payload;
  } catch (e) {
    console.warn("[Firestore] getDoc failed", e);
    return null;
  }
}

export async function saveMapState(payload: MapStatePayloadV1): Promise<void> {
  const db = getDb();
  if (!db) return;

  const ref = doc(db, DOC_PATH);

  // Load current doc to protect existing players from accidental wipe
  let existingPlayers: MapStatePayloadV1["players"] | undefined;
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const data = snap.data() as Partial<FirestoreDoc> | undefined;
      const prevPayload = data?.payload as MapStatePayloadV1 | undefined;
      existingPlayers = prevPayload?.players;
    }
  } catch {}

  const incomingPlayers = payload?.players ?? {};
  const incomingPlayersCount = Object.keys(incomingPlayers || {}).length;
  const existingPlayersCount = Object.keys(existingPlayers || {}).length;

  // Safety: if incoming players is empty while existing has data, skip writing players field at all
  const skipPlayersWrite = incomingPlayersCount === 0 && existingPlayersCount > 0;

  // Build a partial nested object with merge to avoid destructive overwrites
  const partial: any = {
    version: 1,
    updatedAt: serverTimestamp(),
    payload: {
      world: payload.world,
      buildings: payload.buildings,
    },
  };
  // meta may be used by admin UI; persist if present
  if ((payload as any)?.meta) {
    partial.payload.meta = (payload as any).meta;
  }
  if (!skipPlayersWrite) {
    partial.payload.players = incomingPlayers;
  }

  await setDoc(ref, partial, { merge: true });
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
