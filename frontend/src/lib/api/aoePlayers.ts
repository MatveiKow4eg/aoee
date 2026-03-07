const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  (process.env.NODE_ENV !== "production" ? "http://localhost:3001/api" : "");

if (!API_BASE) {
  throw new Error(
    "NEXT_PUBLIC_API_BASE_URL is not set (required in production to avoid localhost requests)."
  );
}

export type AoePlayer = {
  id: string;
  aoeProfileId: string;
  aoeProfileUrl: string;
  nickname: string;
  claimedAt?: string | null;
};

export async function listAvailableAoePlayers(args?: { q?: string; limit?: number; cursor?: string | null }) {
  const sp = new URLSearchParams();
  if (args?.q) sp.set("q", args.q);
  if (args?.limit) sp.set("limit", String(args.limit));
  if (args?.cursor) sp.set("cursor", String(args.cursor));

  const res = await fetch(`${API_BASE}/aoe-players/available${sp.toString() ? `?${sp.toString()}` : ""}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
    credentials: "include",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to load players: ${res.status} ${text}`);
  }

  return (await res.json()) as { items: AoePlayer[]; nextCursor: string | null };
}

export async function claimAoePlayer(input: { aoeProfileId: string; nickname?: string }) {
  const res = await fetch(`${API_BASE}/aoe-players/claim`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    cache: "no-store",
    credentials: "include",
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to claim: ${res.status} ${text}`);
  }

  return (await res.json()) as { player: AoePlayer };
}
