import type { RequestHandler } from 'express';
import { AoePlayerService } from '../services/aoePlayerService';
import { MapService } from '../services/mapService';

const service = new AoePlayerService();

export const getAvailableAoePlayers: RequestHandler = async (req, res, next) => {
  try {
    const result = await service.listAvailable(req.query);
    res.json(result);
  } catch (e) {
    next(e);
  }
};

// Returns claimable players sourced from current map payload (maps/default),
// excluding those already claimed in DB. Does not require auth to browse.
export const getClaimablePlayersFromMap: RequestHandler = async (_req, res, next) => {
  try {
    const map = new MapService();
    const payload = await map.getMapPayload('default');
    const players = payload?.players ?? {};

    const candidates = Object.values(players)
      .map((p: any) => ({
        name: typeof p?.name === 'string' ? p.name.trim() : '',
        insightsUserId: typeof p?.insightsUserId === 'string' ? p.insightsUserId.trim() : '',
      }))
      .filter((p) => p.name && p.insightsUserId);

    // Query DB for already-claimed profile IDs and filter them out.
    const result = await service.filterUnclaimedByProfileIds(candidates.map((c) => c.insightsUserId));

    // Map back to expected minimal shape for the client picker.
    const items = candidates
      .filter((c) => result.unclaimedAoeProfileIds.has(c.insightsUserId))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));

    res.json({ items });
  } catch (e) {
    next(e);
  }
};

export const postClaimAoePlayer: RequestHandler = async (req, res, next) => {
  try {
    const user = (req as any).user as { id: string } | null;
    if (!user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });

    const claimed = await service.claimForCurrentUser(user.id, req.body);
    res.json({ player: claimed });
  } catch (e) {
    next(e);
  }
};
