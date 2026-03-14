import type { RequestHandler } from 'express';
import { ChallengeService } from '../services/challengeService';
import { HttpError } from '../utils/httpError';

const challengeService = new ChallengeService();

export const getCanChallenge: RequestHandler = async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (!user) throw new HttpError(401, 'UNAUTHORIZED', 'Unauthorized');
    const targetUserId = String(req.params.targetUserId || '').trim();
    if (!targetUserId) throw new HttpError(400, 'BAD_REQUEST', 'targetUserId is required');

    const r = await challengeService.canChallenge(user.id, targetUserId);
    res.json(r);
  } catch (e) {
    next(e);
  }
};

export const postCreateChallenge: RequestHandler = async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (!user) throw new HttpError(401, 'UNAUTHORIZED', 'Unauthorized');

    let targetUserId = String((req.body as any)?.targetUserId || '').trim();
    const targetAoeProfileId = String((req.body as any)?.targetAoeProfileId || '').trim();

    // Allow creating a challenge by aoeProfileId (map payload has aoeProfileId even when userId is missing).
    if (!targetUserId && targetAoeProfileId) {
      const { prisma } = await import('../db/prisma');
      const row = await prisma.aoePlayer.findUnique({
        where: { aoeProfileId: targetAoeProfileId },
        select: { claimedByUserId: true },
      });
      const claimed = row?.claimedByUserId ? String(row.claimedByUserId).trim() : '';
      if (!claimed) throw new HttpError(404, 'TARGET_NOT_FOUND', 'Target is not claimed');
      targetUserId = claimed;
    }

    if (!targetUserId) throw new HttpError(400, 'BAD_REQUEST', 'targetUserId or targetAoeProfileId is required');

    const ch = await challengeService.createChallenge(user.id, targetUserId);
    res.status(201).json({ challenge: ch });
  } catch (e) {
    next(e);
  }
};

export const getMyChallenges: RequestHandler = async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (!user) throw new HttpError(401, 'UNAUTHORIZED', 'Unauthorized');

    const status = String((req.query as any)?.status || '').trim().toUpperCase();
    const includeCompleted = status ? false : true;

    const list = await challengeService.listMyChallenges(user.id, { includeCompleted });
    const filtered = status ? list.filter((x: any) => String(x.status).toUpperCase() === status) : list;

    res.json({ challenges: filtered });
  } catch (e) {
    next(e);
  }
};
