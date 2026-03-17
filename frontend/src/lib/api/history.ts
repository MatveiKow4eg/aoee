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

export async function listUnifiedHistory(params?: { limit?: number }) {
  const qs = new URLSearchParams();
  if (typeof params?.limit === "number") qs.set("limit", String(params.limit));
  const q = qs.toString();

  // Prefer versioned route (some deployments expose only /api/v1/*)
  try {
    return await apiFetch(`/api/v1/history${q ? `?${q}` : ""}`);
  } catch {
    return apiFetch(`/api/history${q ? `?${q}` : ""}`);
  }
}
