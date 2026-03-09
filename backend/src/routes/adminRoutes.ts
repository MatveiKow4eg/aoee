import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/auth';
import { postAdminSyncAoePlayerDirectory, postAdminSyncAoePlayerStats } from '../controllers/adminAoePlayersController';

export const adminRoutes = Router();

const adminLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

// Admin-only helper endpoints (keep minimal; used for manual directory sync)
adminRoutes.post('/admin/aoe-players/sync-directory', adminLimiter, requireAuth(), postAdminSyncAoePlayerDirectory);
adminRoutes.post('/admin/aoe-players/sync-stats', adminLimiter, requireAuth(), postAdminSyncAoePlayerStats);
