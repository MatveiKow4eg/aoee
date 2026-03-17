const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "";

async function apiFetch(path: string, opts?: RequestInit) {
  const url = `${API_BASE}${path}`;
  const r = await fetch(url, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(opts?.headers || {}),
    },
    credentials: "include",
  });

  const text = await r.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!r.ok) {
    const msg = json?.message || json?.error || text || `HTTP ${r.status}`;
    throw new Error(msg);
  }

  return json;
}

export type MatchEventFormat = "ONE_V_ONE" | "TWO_V_TWO" | "THREE_V_THREE" | "FOUR_V_FOUR";
export type MatchEventStatus = "OPEN" | "COMPLETED" | "CANCELLED";
export type MatchEventSide = "A" | "B";

export type CreateMatchEventParticipantInput = {
  side: MatchEventSide;
  slot: number;
  playerKey: string;
  userId?: string | null;
  aoeProfileId?: string | null;
  displayNameSnapshot: string;
  avatarUrlSnapshot?: string | null;
};

export async function adminListMatchEvents(params?: { status?: MatchEventStatus; limit?: number }) {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (typeof params?.limit === "number") qs.set("limit", String(params.limit));
  const q = qs.toString();
  return apiFetch(`/api/admin/match-events${q ? `?${q}` : ""}`);
}

export async function adminCreateMatchEvent(body: { format: MatchEventFormat; notes?: string | null; participants: CreateMatchEventParticipantInput[] }) {
  return apiFetch(`/api/admin/match-events`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function adminResolveMatchEvent(id: string, body: { winnerSide: MatchEventSide; notes?: string | null }) {
  return apiFetch(`/api/admin/match-events/${encodeURIComponent(id)}/resolve`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function adminCancelMatchEvent(id: string, body?: { notes?: string | null }) {
  return apiFetch(`/api/admin/match-events/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
    body: JSON.stringify(body || {}),
  });
}
