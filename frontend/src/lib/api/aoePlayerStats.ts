const API_ORIGIN =
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  (process.env.NODE_ENV !== "production" ? "http://localhost:3001" : "");

if (!API_ORIGIN) {
  throw new Error(
    "NEXT_PUBLIC_API_BASE_URL is not set (required in production to avoid localhost requests)."
  );
}

export type AoePlayerStatsSnapshot = {
  rating: number | null;
  rank: number | null;
  rankTotal: number | null;
  wins: number | null;
  losses: number | null;
  streak: number | null;
  winRate: number | null;
  leaderboardId: string | null;
  syncedAt: string;
};

export async function getAoePlayerStats(aoeProfileId: string): Promise<{
  aoeProfileId: string;
  source: "cached_worlds_edge";
  snapshot: AoePlayerStatsSnapshot | null;
}> {
  const res = await fetch(`${API_ORIGIN}/api/aoe-players/${encodeURIComponent(aoeProfileId)}/stats`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
    credentials: "include",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to load stats: ${res.status} ${text}`);
  }

  return (await res.json()) as any;
}

export type RefreshAoePlayerStatsResponse = {
  aoeProfileId: string;
  refreshed: boolean;
  reason?: string;
  source: "cached_worlds_edge";
  snapshot: AoePlayerStatsSnapshot | null;
};

export async function refreshAoePlayerStats(aoeProfileId: string): Promise<RefreshAoePlayerStatsResponse> {
  const res = await fetch(
    `${API_ORIGIN}/api/aoe-players/${encodeURIComponent(aoeProfileId)}/stats/refresh`,
    {
      method: "POST",
      headers: { Accept: "application/json" },
      cache: "no-store",
      credentials: "include",
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to refresh stats: ${res.status} ${text}`);
  }

  return (await res.json()) as any;
}
