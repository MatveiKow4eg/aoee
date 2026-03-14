import type { RequestHandler } from 'express';
import { ChallengeService, ChallengeResult, ChallengeStatus } from '../services/challengeService';
import { HttpError } from '../utils/httpError';
import { MapService } from '../services/mapService';

const challengeService = new ChallengeService();
const mapService = new MapService();

function requireAdmin(req: any) {
  const user = req?.user;
  if (!user) throw new HttpError(401, 'UNAUTHORIZED', 'Unauthorized');
  if (user.role !== 'ADMIN') throw new HttpError(403, 'FORBIDDEN', 'Admin only');
  return user;
}

export const getAdminChallenges: RequestHandler = async (req, res, next) => {
  try {
    const admin = requireAdmin(req as any);
    void admin;

    const status = String((req.query as any)?.status || '').trim().toUpperCase();
    const list = await challengeService.listAdminChallenges({
      status: (status ? (status as ChallengeStatus) : undefined) as any,
    });

    // Enrich with map player keys (u001/u003/...) so frontend can use /people/{key}.png
    // Map payload can have userId nested under the player record OR under extraJson (older shapes).
    let userIdToPlayerKey = new Map<string, string>();
    try {
      const payload = await mapService.getMapPayload('default');
      const players = ((payload as any)?.players ?? {}) as Record<string, any>;
      for (const [playerKey, rec] of Object.entries(players)) {
        const uidRaw = (rec as any)?.userId ?? (rec as any)?.extraJson?.userId ?? (rec as any)?.extra?.userId ?? null;
        const uid = typeof uidRaw === 'string' ? uidRaw.trim() : '';
        if (uid) {
          userIdToPlayerKey.set(uid, String(playerKey));
        }
      }
    } catch {
      // ignore - map payload might be missing
    }

    const enriched = (list ?? []).map((ch: any) => {
      const challengerPlayerKey = userIdToPlayerKey.get(String(ch?.challengerUserId || '').trim()) ?? null;
      const targetPlayerKey = userIdToPlayerKey.get(String(ch?.targetUserId || '').trim()) ?? null;
      return {
        ...ch,
        challengerPlayerKey,
        targetPlayerKey,
      };
    });

    res.json({ challenges: enriched });
  } catch (e) {
    next(e);
  }
};

export const postAdminResolveChallenge: RequestHandler = async (req, res, next) => {
  try {
    const admin = requireAdmin(req as any);
    const id = String(req.params.id || '').trim();
    if (!id) throw new HttpError(400, 'BAD_REQUEST', 'id is required');

    const result = String((req.body as any)?.result || '').trim().toUpperCase() as ChallengeResult;
    if (!result) throw new HttpError(400, 'BAD_REQUEST', 'result is required');

    const allowed: ChallengeResult[] = ['CHALLENGER_WON', 'CHALLENGER_LOST', 'DRAW', 'NO_SHOW'];
    if (!allowed.includes(result)) throw new HttpError(400, 'BAD_REQUEST', 'Invalid result');

    const notes = (req.body as any)?.notes;

    const updated = await challengeService.resolveChallenge({
      challengeId: id,
      adminUserId: admin.id,
      result,
      notes: typeof notes === 'string' ? notes : undefined,
    });

    res.json({ challenge: updated });
  } catch (e) {
    next(e);
  }
};

export const postAdminCancelChallenge: RequestHandler = async (req, res, next) => {
  try {
    const admin = requireAdmin(req as any);
    const id = String(req.params.id || '').trim();
    if (!id) throw new HttpError(400, 'BAD_REQUEST', 'id is required');

    const notes = (req.body as any)?.notes;

    const updated = await challengeService.cancelChallenge({
      challengeId: id,
      adminUserId: admin.id,
      notes: typeof notes === 'string' ? notes : undefined,
    });

    res.json({ challenge: updated });
  } catch (e) {
    next(e);
  }
};
