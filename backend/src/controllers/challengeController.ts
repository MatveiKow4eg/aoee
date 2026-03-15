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

    const targetUserId = String((req.body as any)?.targetUserId || '').trim();
    const targetAoeProfileId = String((req.body as any)?.targetAoeProfileId || '').trim();
    const targetPlayerKey = String((req.body as any)?.targetPlayerKey || '').trim();

    // Accept legacy/alias field names from frontend
    // so the UI can send e.g. { playerKey: 'u005' } or { aoeProfileId: '12550310' }.
    const aliasPlayerKey = String((req.body as any)?.playerKey || '').trim();
    const aliasAoeProfileId = String((req.body as any)?.aoeProfileId || '').trim();

    const finalTargetPlayerKey = targetPlayerKey || aliasPlayerKey;
    const finalTargetAoeProfileId = targetAoeProfileId || aliasAoeProfileId;

    if (!targetUserId && !finalTargetAoeProfileId && !finalTargetPlayerKey) {
      throw new HttpError(400, 'BAD_REQUEST', 'targetUserId or targetAoeProfileId or targetPlayerKey is required');
    }

    const ch = await challengeService.createChallenge(
      user.id,
      targetUserId
        ? { targetUserId }
        : finalTargetAoeProfileId
          ? { targetAoeProfileId: finalTargetAoeProfileId, targetPlayerKey: finalTargetPlayerKey || null }
          : { targetPlayerKey: finalTargetPlayerKey }
    );

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
