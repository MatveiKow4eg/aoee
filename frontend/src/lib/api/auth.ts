const API_BASE = process.env.NEXT_PUBLIC_BACKEND_API_BASE || "http://localhost:3001/api";

export type MeResponse = {
  user: {
    id: string;
    email?: string | null;
    displayName?: string | null;
    role?: string | null;
  } | null;
};

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
    credentials: "include",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${text}`);
  }

  if (res.status === 204) return undefined as any;
  return (await res.json()) as T;
}

export async function me(): Promise<MeResponse> {
  return jsonFetch<MeResponse>("/auth/me", { method: "GET", cache: "no-store" });
}

export async function register(email: string, password: string): Promise<void> {
  await jsonFetch("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function login(email: string, password: string): Promise<void> {
  await jsonFetch("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function logout(): Promise<void> {
  await jsonFetch("/auth/logout", { method: "POST" });
}

export function steamLoginUrl(): string {
  return `${API_BASE}/auth/steam`;
}
