const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  (process.env.NODE_ENV !== "production" ? "http://localhost:3001/api" : "");

if (!API_BASE) {
  throw new Error(
    "NEXT_PUBLIC_API_BASE_URL is not set (required in production to avoid localhost requests)."
  );
}

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
  return jsonFetch<MeResponse>("/api/v1/auth/me", { method: "GET", cache: "no-store" });
}

export async function register(email: string, password: string): Promise<void> {
  await jsonFetch("/api/v1/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function login(email: string, password: string): Promise<void> {
  await jsonFetch("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function logout(): Promise<void> {
  await jsonFetch("/api/v1/auth/logout", { method: "POST" });
}

export function steamLoginUrl(): string {
  return `${API_BASE}/api/v1/auth/steam`;
}
