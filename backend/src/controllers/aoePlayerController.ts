import type { RequestHandler } from 'express';
import { AoePlayerService } from '../services/aoePlayerService';

const service = new AoePlayerService();

export const getAvailableAoePlayers: RequestHandler = async (req, res, next) => {
  try {
    const result = await service.listAvailable(req.query);
    res.json(result);
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
