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

    // Targeted debug (safe): enabled only for a single profile id.
    const debug = id === '11375082';

    try {
      const player = await prisma.aoePlayer.findUnique({
        where: { aoeProfileId: id },
        select: { id: true, aoeProfileId: true, steamId: true, nickname: true },
      });

      if (!player) {
        return { ok: true, status: 'skipped', reason: 'no_player', aoeProfileId: id };
      }

      // Lookup key priority:
      // 1) steamId -> profile_names: "/steam/<id>" (preferred, more stable)
      // 2) nickname alias fallback (optional, less reliable)
      const profileName = player.steamId ? `/steam/${player.steamId}` : '';

      let raw: any = null;
      if (profileName) {
        if (debug) console.log('[stats-sync][debug]', { aoeProfileId: id, lookup: 'profile_names', value: profileName });
        const resp = await this.we.getPersonalStatByProfileNames([profileName], { debug });
        raw = Array.isArray(resp) ? resp[0] : resp;
      } else {
        // Conservative alias fallback: only if nickname is non-empty.
        const alias = String(player.nickname || '').trim();
        if (!alias) {
          return { ok: true, status: 'skipped', reason: 'not_enough_identity_for_stats_sync', aoeProfileId: id, aoePlayerId: player.id };
        }
        if (debug) console.log('[stats-sync][debug]', { aoeProfileId: id, lookup: 'aliases', value: alias });
        const resp = await this.we.getPersonalStatByAliases([alias], { debug });
        raw = Array.isArray(resp) ? resp[0] : resp;
      }

      const normalized = this.we.normalizePrimaryStatSnapshot(raw, { debug, aoeProfileId: id });
      if (!normalized) {
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
