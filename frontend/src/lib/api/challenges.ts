const API_ORIGIN = process.env.NEXT_PUBLIC_API_ORIGIN || "";

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_ORIGIN}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (data as any)?.error?.message || `Request failed: ${res.status}`;
    const code = (data as any)?.error?.code || "REQUEST_FAILED";
    const err: any = new Error(msg);
    err.code = code;
    err.data = data;
    throw err;
  }
  return data as T;
}

export type CanChallengeResponse = {
  canChallenge: boolean;
  reason: string | null;
  cooldownUntil: string | null;
  activeChallengeId: string | null;
};

export type Challenge = {
  id: string;
  challengerUserId: string;
  targetUserId: string;
  status: string;
  result?: string | null;
  createdAt: string;
  acceptedAt: string;
  expiresAt: string;
  resolvedAt?: string | null;
  resolvedByUserId?: string | null;
  winnerUserId?: string | null;
  loserUserId?: string | null;
  notes?: string | null;
};

export async function canChallenge(targetUserId: string): Promise<CanChallengeResponse> {
  return jsonFetch<CanChallengeResponse>(`/api/challenges/can-challenge/${encodeURIComponent(targetUserId)}`, {
    method: "GET",
  });
}

export async function createChallenge(targetUserId: string): Promise<{ challenge: Challenge }> {
  return jsonFetch<{ challenge: Challenge }>(`/api/challenges`, {
    method: "POST",
    body: JSON.stringify({ targetUserId }),
  });
}

export async function listMyChallenges(): Promise<{ challenges: Challenge[] }> {
  return jsonFetch<{ challenges: Challenge[] }>(`/api/challenges/my`, { method: "GET" });
}

export async function adminListChallenges(status?: string): Promise<{ challenges: any[] }> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  return jsonFetch<{ challenges: any[] }>(`/api/admin/challenges${qs}`, { method: "GET" });
}

export async function adminResolveChallenge(id: string, result: string, notes?: string): Promise<{ challenge: any }> {
  return jsonFetch<{ challenge: any }>(`/api/admin/challenges/${encodeURIComponent(id)}/resolve`, {
    method: "POST",
    body: JSON.stringify({ result, ...(notes ? { notes } : {}) }),
  });
}

export async function adminCancelChallenge(id: string, notes?: string): Promise<{ challenge: any }> {
  return jsonFetch<{ challenge: any }>(`/api/admin/challenges/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
    body: JSON.stringify({ ...(notes ? { notes } : {}) }),
  });
}
