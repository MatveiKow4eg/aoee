import type { RequestHandler } from 'express';
import { prisma } from '../db/prisma';
import { HttpError } from '../utils/httpError';

/**
 * Unified community history:
 * - solo challenges (existing)
 * - admin-created match events (new)
 *
 * Auth required.
 */
export const getUnifiedHistory: RequestHandler = async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (!user) throw new HttpError(401, 'UNAUTHORIZED', 'Unauthorized');

    const limitRaw = typeof (req.query as any)?.limit === 'string' ? parseInt(String((req.query as any).limit), 10) : undefined;
    const limit = Number.isFinite(limitRaw as any) && (limitRaw as any) > 0 ? Math.min(200, Math.trunc(limitRaw as any)) : 100;

    const challenges = await prisma.userChallenge.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        challengerUser: { select: { id: true, displayName: true } },
        targetUser: { select: { id: true, displayName: true } },
      },
    });

    const matchEvents = await prisma.matchEvent.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        createdByUser: { select: { id: true, displayName: true } },
        resolvedByUser: { select: { id: true, displayName: true } },
        participants: { orderBy: [{ side: 'asc' }, { slot: 'asc' }] },
      },
    });

    // Normalize into a single list with a discriminator.
    const items = [
      ...challenges.map((c: any) => ({ type: 'challenge' as const, createdAt: c.createdAt, data: c })),
      ...matchEvents.map((m: any) => ({ type: 'matchEvent' as const, createdAt: m.createdAt, data: m })),
    ]
      .sort((a, b) => {
        const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return tb - ta;
      })
      .slice(0, limit);

    res.json({ items });
  } catch (e) {
    next(e);
  }
};
