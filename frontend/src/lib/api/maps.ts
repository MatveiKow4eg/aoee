import type { MapStatePayloadV1 } from "../../store/mapStateStore";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  (process.env.NODE_ENV !== "production" ? "http://localhost:3001/api" : "");

if (!API_BASE) {
  throw new Error(
    "NEXT_PUBLIC_API_BASE_URL is not set (required in production to avoid localhost requests)."
  );
}

export async function getDefaultMap(): Promise<MapStatePayloadV1> {
  const res = await fetch(`${API_BASE}/maps/default`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
    credentials: "include",
  });

  if (!res.ok) {
    throw new Error(`Failed to load map: ${res.status}`);
  }

  const data = (await res.json()) as any;
  // backend returns { version: 1, payload }
  return (data?.payload ?? data) as MapStatePayloadV1;
}

export async function putDefaultMap(payload: MapStatePayloadV1): Promise<MapStatePayloadV1> {
  const res = await fetch(`${API_BASE}/maps/default`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ version: 1, payload }),
    credentials: "include",
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to save map: ${res.status} ${text}`);
  }

  const data = (await res.json()) as any;
  return (data?.payload ?? data) as MapStatePayloadV1;
}
