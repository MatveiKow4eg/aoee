import { env } from '../config/env';
import { HttpError } from '../utils/httpError';

export type WorldsEdgeRecentMatchHistoryResponse = any;

export type WorldsEdgePersonalStatResponse = any;

export type NormalizedStatSnapshot = {
  leaderboardId?: string | null;
  rating?: number | null;
  rank?: number | null;
  rankTotal?: number | null;
  wins?: number | null;
  losses?: number | null;
  streak?: number | null;
};

export type WorldsEdgeIdentity = {
  aoeProfileId: string;
  nickname?: string | null;
  steamProfileName?: string | null; // e.g. "/steam/7656119..."
  steamId?: string | null; // parsed digits from steamProfileName
};

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export class WorldsEdgeApiService {
  private readonly baseUrl = env.WORLDS_EDGE_API_BASE_URL;
  private readonly timeoutMs = env.WORLDS_EDGE_API_TIMEOUT_MS;

  /**
   * World’s Edge community API.
   * Endpoint discussed: getRecentMatchHistory?title=age2&profile_ids=[...]
   *
   * We keep this method very defensive:
   * - chunk requests
   * - timeout
   * - return raw JSON
   */
  async getRecentMatchHistoryByProfileIds(profileIds: string[]) {
    const ids = Array.from(new Set(profileIds.map((s) => String(s || '').trim()).filter(Boolean)));
    if (ids.length === 0) return [] as WorldsEdgeRecentMatchHistoryResponse[];

    // Keep chunk small to avoid URL limits.
    const chunks = chunk(ids, 50);
    const all: WorldsEdgeRecentMatchHistoryResponse[] = [];

    for (const c of chunks) {
      const url = new URL(`${this.baseUrl}/getRecentMatchHistory`);
      url.searchParams.set('title', 'age2');
      url.searchParams.set('profile_ids', c.join(','));

      const res = await withTimeout(
        fetch(url.toString(), {
          method: 'GET',
          headers: { Accept: 'application/json' },
        }),
        this.timeoutMs,
        'worlds-edge getRecentMatchHistory',
      );

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new HttpError(502, 'WORLDS_EDGE_UPSTREAM_ERROR', `World’s Edge API error: ${res.status} ${text}`);
      }

      const json = await res.json();
      all.push(json);
    }

    return all;
  }

  /**
   * Extract stable identity from recentMatchHistory response.
   *
   * We do NOT rely on array index or match position.
   * We try multiple shapes because upstream may vary.
   */
  extractIdentityFromRecentMatchHistory(raw: any, aoeProfileId: string): WorldsEdgeIdentity {
    const targetId = String(aoeProfileId || '').trim();

    const identity: WorldsEdgeIdentity = {
      aoeProfileId: targetId,
      nickname: null,
      steamProfileName: null,
      steamId: null,
    };

    if (!raw || !targetId) return identity;

    // Most common structures observed in community APIs:
    // - raw = { players: [...], ... }
    // - raw = { matchHistoryStats: { players: [...] } }
    // - raw = { lastMatch: { players: [...] } }
    // We scan any plausible player/member arrays.

    const candidatesArrays: any[] = [];

    const tryPush = (v: any) => {
      if (Array.isArray(v)) candidatesArrays.push(v);
    };

    tryPush(raw?.players);
    tryPush(raw?.matchHistoryStats?.players);
    tryPush(raw?.lastMatch?.players);
    tryPush(raw?.matchHistoryStats?.matches?.flatMap?.((m: any) => m?.players ?? []) ?? null);
    // fallback: if raw itself is array, treat as players
    if (Array.isArray(raw)) tryPush(raw);

    let found: any = null;
    for (const arr of candidatesArrays) {
      found = arr.find((p: any) => String(p?.profile_id ?? p?.profileId ?? p?.profile?.id ?? '').trim() === targetId);
      if (found) break;

      // some shapes use nested member objects
      found = arr.find((p: any) => String(p?.member?.profile_id ?? p?.member?.profileId ?? '').trim() === targetId);
      if (found) {
        found = found.member;
        break;
      }
    }

    // If still not found, attempt deeper scan (bounded) through recent matches.
    if (!found && Array.isArray(raw?.matches)) {
      for (const m of raw.matches.slice(0, 10)) {
        const arr = m?.players;
        if (!Array.isArray(arr)) continue;
        found = arr.find((p: any) => String(p?.profile_id ?? '').trim() === targetId);
        if (found) break;
      }
    }

    const nickname = (found?.alias ?? found?.name ?? found?.player_name ?? found?.playerName ?? null) as any;
    const steamProfileName = (found?.steam_profile_name ?? found?.steamProfileName ?? found?.profile_name ?? found?.profileName ?? null) as any;

    identity.nickname = typeof nickname === 'string' && nickname.trim() ? nickname.trim() : null;
    identity.steamProfileName = typeof steamProfileName === 'string' && steamProfileName.trim() ? steamProfileName.trim() : null;

    // steamProfileName expected like "/steam/7656119..."
    if (identity.steamProfileName) {
      const m = identity.steamProfileName.match(/^\/steam\/(\d{10,30})$/);
      identity.steamId = m ? m[1] : null;
    }

    return identity;
  }

  async getPersonalStatByAliases(aliases: string[]) {
    const list = Array.from(new Set(aliases.map((s) => String(s || '').trim()).filter(Boolean)));
    if (list.length === 0) return [] as WorldsEdgePersonalStatResponse[];

    // NOTE: aliases can contain spaces/special chars; use URLSearchParams.
    const url = new URL(`${this.baseUrl}/GetPersonalStat`);
    url.searchParams.set('title', 'age2');
    url.searchParams.set('aliases', list.join(','));

    const res = await withTimeout(
      fetch(url.toString(), {
        method: 'GET',
        headers: { Accept: 'application/json' },
      }),
      this.timeoutMs,
      'worlds-edge GetPersonalStat (aliases)',
    );

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new HttpError(502, 'WORLDS_EDGE_UPSTREAM_ERROR', `World’s Edge API error: ${res.status} ${text}`);
    }

    return res.json();
  }

  async getPersonalStatByProfileNames(profileNames: string[]) {
    const list = Array.from(new Set(profileNames.map((s) => String(s || '').trim()).filter(Boolean)));
    if (list.length === 0) return [] as WorldsEdgePersonalStatResponse[];

    const url = new URL(`${this.baseUrl}/GetPersonalStat`);
    url.searchParams.set('title', 'age2');
    url.searchParams.set('profile_names', list.join(','));

    const res = await withTimeout(
      fetch(url.toString(), {
        method: 'GET',
        headers: { Accept: 'application/json' },
      }),
      this.timeoutMs,
      'worlds-edge GetPersonalStat (profile_names)',
    );

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new HttpError(502, 'WORLDS_EDGE_UPSTREAM_ERROR', `World’s Edge API error: ${res.status} ${text}`);
    }

    return res.json();
  }

  /**
   * Normalize stat response.
   *
   * Leaderboard selection strategy (Stage 6A scope):
   * - pick a single "primary" leaderboard stat block
   * - prefer 1v1 RM if we can detect it
   * - else pick the first stat block that has rating/rank fields
   */
  normalizePrimaryStatSnapshot(raw: any): NormalizedStatSnapshot | null {
    if (!raw) return null;

    // common shapes: { statGroups: [...] } or { stats: [...] } etc.
    const groups: any[] = Array.isArray(raw?.statGroups)
      ? raw.statGroups
      : Array.isArray(raw?.stats)
        ? raw.stats
        : Array.isArray(raw)
          ? raw
          : [];

    if (!groups.length) return null;

    const extract = (g: any): NormalizedStatSnapshot => {
      const leaderboardId = (g?.leaderboard_id ?? g?.leaderboardId ?? g?.leaderboard ?? null) as any;

      const rating = g?.rating ?? g?.elo ?? g?.mmr ?? null;
      const rank = g?.rank ?? null;
      const rankTotal = g?.rank_total ?? g?.rankTotal ?? null;

      // wins/losses/streak could be nested
      const wins = g?.wins ?? g?.win_count ?? g?.winCount ?? g?.record?.wins ?? null;
      const losses = g?.losses ?? g?.loss_count ?? g?.lossCount ?? g?.record?.losses ?? null;
      const streak = g?.streak ?? g?.current_streak ?? g?.currentStreak ?? null;

      const num = (v: any): number | null => {
        if (v == null) return null;
        const n = typeof v === 'number' ? v : Number(v);
        return Number.isFinite(n) ? Math.trunc(n) : null;
      };

      return {
        leaderboardId: typeof leaderboardId === 'string' && leaderboardId.trim() ? leaderboardId.trim() : null,
        rating: num(rating),
        rank: num(rank),
        rankTotal: num(rankTotal),
        wins: num(wins),
        losses: num(losses),
        streak: num(streak),
      };
    };

    const looksLike1v1Rm = (g: any) => {
      const lid = String(g?.leaderboard_id ?? g?.leaderboardId ?? '').toLowerCase();
      const name = String(g?.name ?? g?.leaderboard_name ?? '').toLowerCase();
      // heuristic only; upstream ids vary
      return lid.includes('1v1') || name.includes('1v1') || name.includes('rm');
    };

    // Prefer something that looks like 1v1 RM
    const preferred = groups.find((g) => looksLike1v1Rm(g));
    if (preferred) return extract(preferred);

    // Otherwise pick first with rating or rank
    const anyRated = groups.find((g) => g?.rating != null || g?.elo != null || g?.mmr != null || g?.rank != null);
    if (anyRated) return extract(anyRated);

    return extract(groups[0]);
  }
}
