import type { RequestHandler } from 'express';
import { z } from 'zod';
import { HttpError } from '../utils/httpError';
import { AoePlayerDirectorySyncService } from '../services/aoePlayerDirectorySyncService';
import { AoePlayerStatsSyncService } from '../services/aoePlayerStatsSyncService';

const syncSchema = z.object({
  profileIds: z.array(z.string().min(1)).min(1).max(500),
});

function requireAdmin(req: any) {
  const user = req?.user;
  if (!user) throw new HttpError(401, 'UNAUTHORIZED', 'Unauthorized');
  if (user.role !== 'ADMIN') throw new HttpError(403, 'FORBIDDEN', 'Admin only');
}

export const postAdminSyncAoePlayerDirectory: RequestHandler = async (req, res, next) => {
  try {
    requireAdmin(req as any);

    const { profileIds } = syncSchema.parse(req.body);
    const sync = new AoePlayerDirectorySyncService();
    const { summary, results } = await sync.syncManyByAoeProfileIds(profileIds, { concurrency: 2 });

    res.json({ summary, results });
  } catch (e) {
    next(e);
  }
};

export const postAdminSyncAoePlayerStats: RequestHandler = async (req, res, next) => {
  try {
    requireAdmin(req as any);

    const { profileIds } = syncSchema.parse(req.body);
    const sync = new AoePlayerStatsSyncService();
    const { summary, results } = await sync.syncManyByAoeProfileIds(profileIds, { concurrency: 2 });

    res.json({ summary, results });
  } catch (e) {
    next(e);
  }
};
