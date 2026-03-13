import { prisma } from '../db/prisma';
import { AoePlayerStatSnapshotRepository } from '../repositories/aoePlayerStatSnapshotRepository';
import { WorldsEdgeApiService } from './worldsEdgeApiService';

export type StatsSyncResult =
  | {
      ok: true;
      status: 'synced' | 'noop' | 'skipped';
      reason?: 'no_player' | 'not_enough_identity_for_stats_sync' | 'no_stats_found';
      aoeProfileId: string;
      aoePlayerId?: string;
      snapshot?: any;
    }
  | {
      ok: false;
      status: 'failed';
      aoeProfileId: string;
      reason: string;
    };

export class AoePlayerStatsSyncService {
  constructor(
    private readonly repo = new AoePlayerStatSnapshotRepository(),
    private readonly we = new WorldsEdgeApiService(),
  ) {}

  private toWinRate(wins: number | null, losses: number | null): number | null {
    if (wins == null || losses == null) return null;
    const total = wins + losses;
    if (!total) return null;
    return Math.round((wins / total) * 1000) / 10; // 1 decimal
  }

  async syncByAoeProfileId(aoeProfileId: string): Promise<StatsSyncResult> {
    const id = String(aoeProfileId || '').trim();
    if (!id) return { ok: false, status: 'failed', aoeProfileId: id, reason: 'empty_aoeProfileId' };

    // Targeted debug (safe): enabled only for specific profile ids.
    const debugIds = new Set(['11375082', '420789', '4207889']);
    const debug = debugIds.has(id);

    try {
      const player = await prisma.aoePlayer.findUnique({
        where: { aoeProfileId: id },
        select: { id: true, aoeProfileId: true, steamId: true, nickname: true, aoeProfileUrl: true },
      });

      if (debug) {
        console.log('[stats-sync][debug] aoePlayer lookup', {
          aoeProfileId: id,
          found: !!player,
          player: player
            ? {
                id: player.id,
                aoeProfileId: player.aoeProfileId,
                steamId: player.steamId,
                nickname: player.nickname,
                aoeProfileUrl: (player as any).aoeProfileUrl,
              }
            : null,
        });
      }

      if (!player) {
        return { ok: true, status: 'skipped', reason: 'no_player', aoeProfileId: id };
      }

      // Lookup key priority:
      // 1) steamId -> profile_names: "/steam/<id>" (preferred, more stable)
      // 2) nickname alias fallback (optional, less reliable)
      const profileName = player.steamId ? `/steam/${player.steamId}` : '';

      let rawResp: any = null;
      let raw: any = null;
      let lookup: 'profile_names' | 'aliases' | 'none' = 'none';
      let lookupValue = '';

      if (profileName) {
        lookup = 'profile_names';
        lookupValue = profileName;
        if (debug) console.log('[stats-sync][debug] lookup selected', { aoeProfileId: id, lookup, value: lookupValue });
        const resp = await this.we.getPersonalStatByProfileNames([profileName], { debug });
        rawResp = resp;
        raw = Array.isArray(resp) ? resp[0] : resp;
      } else {
        // Conservative alias fallback: only if nickname is non-empty.
        const alias = String(player.nickname || '').trim();
        if (!alias) {
          if (debug) console.log('[stats-sync][debug] skip: not enough identity', { aoeProfileId: id, steamId: player.steamId, nickname: player.nickname });
          return { ok: true, status: 'skipped', reason: 'not_enough_identity_for_stats_sync', aoeProfileId: id, aoePlayerId: player.id };
        }
        lookup = 'aliases';
        lookupValue = alias;
        if (debug) console.log('[stats-sync][debug] lookup selected', { aoeProfileId: id, lookup, value: lookupValue });
        const resp = await this.we.getPersonalStatByAliases([alias], { debug });
        rawResp = resp;
        raw = Array.isArray(resp) ? resp[0] : resp;
      }

      if (debug) {
        const summarize = (obj: any) => {
          const blocks = [
            ...(Array.isArray(obj?.leaderboardStats) ? obj.leaderboardStats : []),
            ...(Array.isArray(obj?.leaderboard_stats) ? obj.leaderboard_stats : []),
            ...(Array.isArray(obj?.statGroups) ? obj.statGroups : []),
            ...(Array.isArray(obj?.stats) ? obj.stats : []),
          ];
          const leaderboardIds = blocks
            .map((b: any) => b?.leaderboard_id ?? b?.leaderboardId ?? b?.leaderboard ?? b?.leaderboardID)
            .filter((x: any) => x != null)
            .map((x: any) => String(x));

          return {
            type: Array.isArray(obj) ? 'array' : typeof obj,
            topKeys: obj && typeof obj === 'object' && !Array.isArray(obj) ? Object.keys(obj).slice(0, 30) : [],
            hasLeaderboardStats: Array.isArray(obj?.leaderboardStats) || Array.isArray(obj?.leaderboard_stats),
            leaderboardStatsCount: (Array.isArray(obj?.leaderboardStats) ? obj.leaderboardStats.length : 0) +
              (Array.isArray(obj?.leaderboard_stats) ? obj.leaderboard_stats.length : 0),
            statGroupsCount: Array.isArray(obj?.statGroups) ? obj.statGroups.length : 0,
            statsCount: Array.isArray(obj?.stats) ? obj.stats.length : 0,
            blocksCount: blocks.length,
            leaderboardIds: Array.from(new Set(leaderboardIds)).slice(0, 30),
            profileIdHints: {
              profile_id: obj?.profile_id ?? null,
              profileId: obj?.profileId ?? null,
              profile: obj?.profile?.id ?? null,
            },
          };
        };

        console.log('[stats-sync][debug] upstream response summary', {
          aoeProfileId: id,
          lookup,
          lookupValue,
          rawRespIsArray: Array.isArray(rawResp),
          rawRespLength: Array.isArray(rawResp) ? rawResp.length : null,
          firstItemSummary: summarize(raw),
        });
      }

      const normalized = this.we.normalizePrimaryStatSnapshot(raw, { debug, aoeProfileId: id });
      if (!normalized) {
        if (debug) {
          console.log('[stats-sync][debug] normalizePrimaryStatSnapshot returned null => no_stats_found', {
            aoeProfileId: id,
            lookup,
            lookupValue,
            rawKeys: raw && typeof raw === 'object' && !Array.isArray(raw) ? Object.keys(raw) : null,
          });
        }
        return { ok: true, status: 'skipped', reason: 'no_stats_found', aoeProfileId: id, aoePlayerId: player.id };
      }

      const snapshot = await this.repo.upsertByAoePlayerId({
        aoePlayerId: player.id,
        leaderboardId: normalized.leaderboardId ?? null,
        rating: normalized.rating ?? null,
        rank: normalized.rank ?? null,
        rankTotal: normalized.rankTotal ?? null,
        wins: normalized.wins ?? null,
        losses: normalized.losses ?? null,
        streak: normalized.streak ?? null,
        syncedAt: new Date(),
      });

      return {
        ok: true,
        status: 'synced',
        aoeProfileId: id,
        aoePlayerId: player.id,
        snapshot: {
          ...snapshot,
          winRate: this.toWinRate(snapshot.wins, snapshot.losses),
          source: 'cached_worlds_edge',
        },
      };
    } catch (e: any) {
      return {
        ok: false,
        status: 'failed',
        aoeProfileId: id,
        reason: e?.message ? String(e.message) : 'unknown_error',
      };
    }
  }

  async syncManyByAoeProfileIds(profileIds: string[], opts?: { concurrency?: number }) {
    const ids = Array.from(new Set(profileIds.map((s) => String(s || '').trim()).filter(Boolean)));
    const concurrency = Math.max(1, Math.min(5, opts?.concurrency ?? 2));

    const results: StatsSyncResult[] = [];
    let i = 0;

    const workers = Array.from({ length: concurrency }).map(async () => {
      while (true) {
        const idx = i++;
        if (idx >= ids.length) break;
        const id = ids[idx]!;
        const r = await this.syncByAoeProfileId(id);
        results.push(r);
      }
    });

    await Promise.all(workers);

    const summary = {
      total: results.length,
      synced: results.filter((r) => r.ok && r.status === 'synced').length,
      skipped: results.filter((r) => r.ok && r.status === 'skipped').length,
      failed: results.filter((r) => !r.ok).length,
    };

    return { results, summary };
  }
}
