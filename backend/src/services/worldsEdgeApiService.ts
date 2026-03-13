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
      // Upstream expects JSON array for profile_ids (not a comma-separated string)
      url.searchParams.set('profile_ids', JSON.stringify(c));

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

    // Some upstream shapes include a top-level `profiles` array keyed by profile_id.
    // Use it as an additional source of identity.
    tryPush(raw?.profiles);

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

    // Some shapes may provide steam id directly.
    const steamIdRaw = (found?.steam_id ?? found?.steamId ?? null) as any;

    identity.nickname = typeof nickname === 'string' && nickname.trim() ? nickname.trim() : null;
    identity.steamProfileName = typeof steamProfileName === 'string' && steamProfileName.trim() ? steamProfileName.trim() : null;

    // steamProfileName expected like "/steam/7656119..."
    if (identity.steamProfileName) {
      const m = identity.steamProfileName.match(/^\/steam\/(\d{10,30})$/);
      identity.steamId = m ? m[1] : null;
    }

    // Direct steamId field fallback
    if (!identity.steamId && typeof steamIdRaw === 'string') {
      const v = steamIdRaw.trim();
      if (/^\d{10,30}$/.test(v)) identity.steamId = v;
    }
    if (!identity.steamId && typeof steamIdRaw === 'number' && Number.isFinite(steamIdRaw)) {
      const v = String(Math.trunc(steamIdRaw));
      if (/^\d{10,30}$/.test(v)) identity.steamId = v;
    }

    return identity;
  }

  async getPersonalStatByAliases(aliases: string[], opts?: { debug?: boolean }) {
    const list = Array.from(new Set(aliases.map((s) => String(s || '').trim()).filter(Boolean)));
    if (list.length === 0) return [] as WorldsEdgePersonalStatResponse[];

    // NOTE: Worlds Edge expects JSON array string in query param, e.g. aliases=["AoEE. Tsumi"].
    // URLSearchParams will URL-encode the JSON string safely.
    const url = new URL(`${this.baseUrl}/GetPersonalStat`);
    url.searchParams.set('title', 'age2');
    url.searchParams.set('aliases', JSON.stringify(list));

    if (opts?.debug) console.log('[worlds-edge][debug] GetPersonalStat url (aliases):', url.toString());

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

    const json = await res.json();
    if (opts?.debug) console.log('[worlds-edge][debug] GetPersonalStat raw (aliases):', JSON.stringify(json, null, 2));
    return json;
  }

  async getPersonalStatByProfileNames(profileNames: string[], opts?: { debug?: boolean }) {
    const list = Array.from(new Set(profileNames.map((s) => String(s || '').trim()).filter(Boolean)));
    if (list.length === 0) return [] as WorldsEdgePersonalStatResponse[];

    const url = new URL(`${this.baseUrl}/GetPersonalStat`);
    url.searchParams.set('title', 'age2');
    // Worlds Edge expects JSON array string in query param, e.g. profile_names=["/steam/7656..."].
    url.searchParams.set('profile_names', JSON.stringify(list));

    if (opts?.debug) console.log('[worlds-edge][debug] GetPersonalStat url (profile_names):', url.toString());

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

    const json = await res.json();
    if (opts?.debug) console.log('[worlds-edge][debug] GetPersonalStat raw (profile_names):', JSON.stringify(json, null, 2));
    return json;
  }

  /**
   * Normalize stat response.
   *
   * Leaderboard selection strategy (Stage 6A scope):
   * - pick a single "primary" leaderboard stat block
   * - prefer 1v1 RM if we can detect it
   * - else pick the first stat block that has rating/rank fields
   */
  normalizePrimaryStatSnapshot(raw: any, opts?: { debug?: boolean; aoeProfileId?: string }): NormalizedStatSnapshot | null {
    if (!raw) return null;

    const debug = !!opts?.debug;
    const aoeProfileId = opts?.aoeProfileId;

    const num = (v: any): number | null => {
      if (v == null) return null;
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isFinite(n) ? Math.trunc(n) : null;
    };

    const normalizeBlock = (b: any): NormalizedStatSnapshot => {
      if (!b) return {};

      // World’s Edge uses a couple different shapes; try both snake_case and camelCase.
      const leaderboardIdRaw = b?.leaderboard_id ?? b?.leaderboardId ?? b?.leaderboard ?? b?.leaderboardID ?? null;

      // rating may be absent in GetPersonalStat for some titles/modes.
      const rating = b?.rating ?? b?.elo ?? b?.mmr ?? b?.rating_value ?? b?.ratingValue ?? null;

      const rank = b?.rank ?? null;
      const rankTotal = b?.ranktotal ?? b?.rank_total ?? b?.rankTotal ?? null;

      const wins = b?.wins ?? b?.win_count ?? b?.winCount ?? b?.record?.wins ?? null;
      const losses = b?.losses ?? b?.loss_count ?? b?.lossCount ?? b?.record?.losses ?? null;
      const streak = b?.streak ?? b?.current_streak ?? b?.currentStreak ?? null;

      return {
        leaderboardId: typeof leaderboardIdRaw === 'string' && leaderboardIdRaw.trim() ? leaderboardIdRaw.trim() : leaderboardIdRaw != null ? String(leaderboardIdRaw) : null,
        rating: num(rating),
        rank: num(rank),
        rankTotal: num(rankTotal),
        wins: num(wins),
        losses: num(losses),
        streak: num(streak),
      };
    };

    // Collect candidate blocks from known GetPersonalStat shapes.
    const blocks: any[] = [];

    const pushArr = (arr: any) => {
      if (Array.isArray(arr)) blocks.push(...arr);
    };

    // Common observed fields in GetPersonalStat response: leaderboardStats / leaderboard_stats
    pushArr(raw?.leaderboardStats);
    pushArr(raw?.leaderboard_stats);

    // Backward-compat fallbacks (older/other shapes)
    pushArr(raw?.statGroups);
    pushArr(raw?.stats);

    if (!blocks.length && Array.isArray(raw)) pushArr(raw);

    if (!blocks.length) {
      if (debug) console.log('[worlds-edge][debug] normalizePrimaryStatSnapshot: no blocks found', { aoeProfileId, keys: Object.keys(raw ?? {}) });
      return null;
    }

    const looksLike1v1Rm = (g: any) => {
      const lid = String(g?.leaderboard_id ?? g?.leaderboardId ?? g?.leaderboard ?? '').toLowerCase();
      const name = String(g?.name ?? g?.leaderboard_name ?? g?.leaderboardName ?? '').toLowerCase();
      return lid.includes('1v1') || name.includes('1v1') || name.includes('rm');
    };

    const hasUsefulFields = (g: any) => {
      const n = normalizeBlock(g);
      return n.wins != null || n.losses != null || n.rank != null || n.rankTotal != null || n.streak != null || n.rating != null || n.leaderboardId != null;
    };

    // Strategy:
    // 1) prefer a block that looks like 1v1 RM AND has useful fields
    // 2) otherwise first block with useful fields
    // 3) otherwise first block
    const preferred = blocks.find((b) => looksLike1v1Rm(b) && hasUsefulFields(b));
    const fallback = blocks.find((b) => hasUsefulFields(b));
    const chosen = preferred ?? fallback ?? blocks[0];

    const chosenNorm = normalizeBlock(chosen);

    if (debug) {
      console.log('[worlds-edge][debug] normalizePrimaryStatSnapshot: candidates', {
        aoeProfileId,
        totalBlocks: blocks.length,
        chosenLeaderboardId: chosenNorm.leaderboardId,
        chosenKeys: Object.keys(chosen ?? {}),
      });
      console.log('[worlds-edge][debug] normalizePrimaryStatSnapshot: chosenNormalized', chosenNorm);
    }

    return chosenNorm;
  }
}
