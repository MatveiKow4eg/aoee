import { z } from 'zod';

const steamEnvSchema = z.object({
  STEAM_WEB_API_KEY: z.string().min(1).optional(),
});

function getSteamApiKey(): string | null {
  const env = steamEnvSchema.parse(process.env);
  return env.STEAM_WEB_API_KEY?.trim() ? env.STEAM_WEB_API_KEY.trim() : null;
}

function isValidSteamId(steamId: string) {
  return /^\d{15,20}$/.test(steamId);
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

export async function getSteamPersonaName(steamId: string): Promise<string | null> {
  try {
    const apiKey = getSteamApiKey();
    if (!apiKey) return null;

    const id = String(steamId || '').trim();
    if (!isValidSteamId(id)) return null;

    const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(apiKey)}&steamids=${encodeURIComponent(id)}`;

    const res = await fetchWithTimeout(
      url,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': 'aoe-estonia-map-backend/1.0',
        },
      },
      2500,
    );

    if (!res.ok) return null;

    const json = (await res.json().catch(() => null)) as any;
    const name = json?.response?.players?.[0]?.personaname;
    if (typeof name !== 'string') return null;

    const trimmed = name.trim();
    return trimmed ? trimmed : null;
  } catch {
    // Best-effort: never break login if Steam API fails.
    return null;
  }
}

export type SteamPlayerSummary = {
  personaName: string;
  avatarSmall?: string | null;
  avatarMedium?: string | null;
  avatarFull?: string | null;
};

export async function getSteamPlayerSummary(steamId: string): Promise<SteamPlayerSummary | null> {
  try {
    const apiKey = getSteamApiKey();
    if (!apiKey) return null;

    const id = String(steamId || '').trim();
    if (!isValidSteamId(id)) return null;

    const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(apiKey)}&steamids=${encodeURIComponent(id)}`;

    const res = await fetchWithTimeout(
      url,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': 'aoe-estonia-map-backend/1.0',
        },
      },
      2500,
    );

    if (!res.ok) return null;

    const json = (await res.json().catch(() => null)) as any;
    const p = json?.response?.players?.[0];
    if (!p || typeof p !== 'object') return null;

    const personaName = typeof p.personaname === 'string' ? p.personaname.trim() : '';
    if (!personaName) return null;

    const avatarSmall = typeof p.avatar === 'string' && p.avatar.trim() ? p.avatar.trim() : null;
    const avatarMedium = typeof p.avatarmedium === 'string' && p.avatarmedium.trim() ? p.avatarmedium.trim() : null;
    const avatarFull = typeof p.avatarfull === 'string' && p.avatarfull.trim() ? p.avatarfull.trim() : null;

    return { personaName, avatarSmall, avatarMedium, avatarFull };
  } catch {
    // Best-effort: never break UI if Steam API fails.
    return null;
  }
}
