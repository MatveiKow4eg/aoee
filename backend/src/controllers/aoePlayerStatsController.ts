import type { RequestHandler } from 'express';
import { AoePlayerStatSnapshotRepository } from '../repositories/aoePlayerStatSnapshotRepository';

function toWinRate(wins: number | null, losses: number | null): number | null {
  if (wins == null || losses == null) return null;
  const total = wins + losses;
  if (!total) return null;
  return Math.round((wins / total) * 1000) / 10;
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
      snapshot: {
        rating: snap.rating,
        rank: snap.rank,
        rankTotal: snap.rankTotal,
        wins: snap.wins,
        losses: snap.losses,
        streak: snap.streak,
        winRate: toWinRate(snap.wins, snap.losses),
        leaderboardId: snap.leaderboardId,
        syncedAt: snap.syncedAt,
      },
    });
  } catch (e) {
    next(e);
  }
};
