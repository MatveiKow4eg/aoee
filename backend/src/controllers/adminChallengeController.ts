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
    // Preferred mapping:
    //   playerKey(u001) -> player.aoeProfileId -> AoePlayer.claimedByUserId -> userId
    // Fallback mapping:
    //   playerKey(u001) -> player.userId (if already present in payload)
    let userIdToPlayerKey = new Map<string, string>();
    try {
      const payload = await mapService.getMapPayload('default');
      const players = ((payload as any)?.players ?? {}) as Record<string, any>;

      // 1) collect aoeProfileIds from map
      const aoeProfileIds: string[] = [];
      const playerKeyByProfileId = new Map<string, string>();
      for (const [playerKey, rec] of Object.entries(players)) {
        const aoe = String((rec as any)?.aoeProfileId ?? (rec as any)?.insightsUserId ?? '').trim();
        if (aoe) {
          aoeProfileIds.push(aoe);
          if (!playerKeyByProfileId.has(aoe)) playerKeyByProfileId.set(aoe, String(playerKey));
        }

        // also keep direct userId if present (fallback)
        const uidRaw = (rec as any)?.userId ?? (rec as any)?.extraJson?.userId ?? (rec as any)?.extra?.userId ?? null;
        const uid = typeof uidRaw === 'string' ? uidRaw.trim() : '';
        if (uid && !userIdToPlayerKey.has(uid)) {
          userIdToPlayerKey.set(uid, String(playerKey));
        }
      }

      // 2) map aoeProfileId -> claimedByUserId
      const unique = Array.from(new Set(aoeProfileIds));
      if (unique.length) {
        const rows = await (mapService as any).prisma?.aoePlayer.findMany?.({
          where: { aoeProfileId: { in: unique } },
          select: { aoeProfileId: true, claimedByUserId: true },
        });
        // If MapService doesn't expose prisma, fall back to direct prisma import below.
        void rows;
      }
    } catch {
      // ignore
    }

    // If the above couldn't access prisma via mapService, use direct prisma (main path).
    try {
      const payload = await mapService.getMapPayload('default');
      const players = ((payload as any)?.players ?? {}) as Record<string, any>;

      const aoeProfileIds: string[] = [];
      const playerKeyByProfileId = new Map<string, string>();
      for (const [playerKey, rec] of Object.entries(players)) {
        const aoe = String((rec as any)?.aoeProfileId ?? (rec as any)?.insightsUserId ?? '').trim();
        if (aoe) {
          aoeProfileIds.push(aoe);
          if (!playerKeyByProfileId.has(aoe)) playerKeyByProfileId.set(aoe, String(playerKey));
        }
      }

      const unique = Array.from(new Set(aoeProfileIds));
      if (unique.length) {
        const { prisma } = await import('../db/prisma');
        const rows = await prisma.aoePlayer.findMany({
          where: { aoeProfileId: { in: unique } },
          select: { aoeProfileId: true, claimedByUserId: true },
        });

        for (const r of rows) {
          const uid = r.claimedByUserId ? String(r.claimedByUserId).trim() : '';
          if (!uid) continue;
          const key = playerKeyByProfileId.get(String(r.aoeProfileId).trim());
          if (!key) continue;
          if (!userIdToPlayerKey.has(uid)) userIdToPlayerKey.set(uid, key);
        }
      }
    } catch {
      // ignore
    }

    const enriched = (list ?? []).map((ch: any) => {
      const challengerPlayerKey = userIdToPlayerKey.get(String(ch?.challengerUserId || '').trim()) ?? null;

      // Preserve DB value if present (important for unclaimed targets where targetUserId is null).
      const dbTargetKey = typeof (ch as any)?.targetPlayerKey === 'string' ? String((ch as any).targetPlayerKey).trim() : '';
      const mappedTargetKey = userIdToPlayerKey.get(String(ch?.targetUserId || '').trim()) ?? null;
      const targetPlayerKey = dbTargetKey || mappedTargetKey || null;

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

export const getAdminCooldownUsers: RequestHandler = async (req, res, next) => {
  try {
    const admin = requireAdmin(req as any);
    void admin;

    const { prisma } = await import('../db/prisma');
    const now = new Date();

    const users = await prisma.user.findMany({
      where: {
        challengeCooldownUntil: {
          not: null,
          gt: now,
        },
      },
      select: {
        id: true,
        displayName: true,
        email: true,
        challengeCooldownUntil: true,
        role: true,
      },
      orderBy: {
        challengeCooldownUntil: 'desc',
      },
    });

    res.json({ users });
  } catch (e) {
    next(e);
  }
};

export const postAdminClearCooldown: RequestHandler = async (req, res, next) => {
  try {
    const admin = requireAdmin(req as any);
    void admin;

    const userId = String((req.params as any)?.userId || '').trim();
    if (!userId) throw new HttpError(400, 'BAD_REQUEST', 'userId is required');

    const { prisma } = await import('../db/prisma');
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { challengeCooldownUntil: null },
      select: {
        id: true,
        displayName: true,
        email: true,
        challengeCooldownUntil: true,
      },
    });

    res.json({ user: updated });
  } catch (e) {
    next(e);
  }
};

export const postAdminPurgeChallenges: RequestHandler = async (req, res, next) => {
  try {
    const admin = requireAdmin(req as any);
    void admin;

    const r = await challengeService.adminPurgeAllChallenges();
    res.json({ ok: true, ...r });
  } catch (e) {
    next(e);
  }
};

export const postAdminDeleteChallenges: RequestHandler = async (req, res, next) => {
  try {
    const admin = requireAdmin(req as any);
    void admin;

    const ids = (req.body as any)?.ids;
    if (!Array.isArray(ids)) throw new HttpError(400, 'BAD_REQUEST', 'ids must be an array');

    const r = await challengeService.adminDeleteChallengesByIds(ids as any);
    res.json({ ok: true, ...r });
  } catch (e) {
    next(e);
  }
};
