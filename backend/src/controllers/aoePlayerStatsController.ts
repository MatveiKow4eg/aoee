import type { RequestHandler } from 'express';
import { AoePlayerStatSnapshotRepository } from '../repositories/aoePlayerStatSnapshotRepository';
import { AoePlayerStatsSyncService } from '../services/aoePlayerStatsSyncService';

function toWinRate(wins: number | null, losses: number | null): number | null {
  if (wins == null || losses == null) return null;
  const total = wins + losses;
  if (!total) return null;
  return Math.round((wins / total) * 1000) / 10;
}

function toSnapshotDto(snap: any) {
  return {
    rating: snap.rating,
    rank: snap.rank,
    rankTotal: snap.rankTotal,
    wins: snap.wins,
    losses: snap.losses,
    streak: snap.streak,
    winRate: toWinRate(snap.wins, snap.losses),
    leaderboardId: snap.leaderboardId,
    syncedAt: snap.syncedAt,
  };
}

export const getAoePlayerStatsSnapshot: RequestHandler = async (req, res, next) => {
  try {
    const aoeProfileId = String((req.params as any)?.aoeProfileId || '').trim();
    if (!aoeProfileId) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'aoeProfileId required' } });

    const repo = new AoePlayerStatSnapshotRepository();
    const snap = await repo.findByAoeProfileId(aoeProfileId);

    if (!snap) {
      return res.json({
        aoeProfileId,
        source: 'cached_worlds_edge',
        snapshot: null,
      });
    }

    return res.json({
      aoeProfileId: snap.aoePlayer.aoeProfileId,
      source: 'cached_worlds_edge',
      snapshot: toSnapshotDto(snap),
    });
  } catch (e) {
    next(e);
  }
};

export const postRefreshAoePlayerStatsSnapshot: RequestHandler = async (req, res, next) => {
  try {
    const aoeProfileId = String((req.params as any)?.aoeProfileId || '').trim();
    if (!aoeProfileId) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'aoeProfileId required' } });

    const syncSvc = new AoePlayerStatsSyncService();
    const syncResult = await syncSvc.syncByAoeProfileId(aoeProfileId);

    // Always read the actual cached snapshot after attempting sync.
    const repo = new AoePlayerStatSnapshotRepository();
    const snap = await repo.findByAoeProfileId(aoeProfileId);

    if (!syncResult.ok) {
      return res.status(200).json({
        aoeProfileId,
        refreshed: false,
        reason: syncResult.reason,
        source: 'cached_worlds_edge',
        snapshot: snap ? toSnapshotDto(snap) : null,
      });
    }

    if (syncResult.status !== 'synced') {
      const reason = syncResult.reason ?? syncResult.status;
      return res.status(200).json({
        aoeProfileId,
        refreshed: false,
        reason,
        source: 'cached_worlds_edge',
        snapshot: snap ? toSnapshotDto(snap) : null,
      });
    }

    return res.status(200).json({
      aoeProfileId,
      refreshed: true,
      source: 'cached_worlds_edge',
      snapshot: snap ? toSnapshotDto(snap) : null,
    });
  } catch (e) {
    next(e);
  }
};
