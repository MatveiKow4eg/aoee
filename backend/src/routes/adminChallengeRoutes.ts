import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/auth';
import { getAdminChallenges, postAdminCancelChallenge, postAdminResolveChallenge, getAdminCooldownUsers, postAdminClearCooldown, postAdminDeleteChallenges, postAdminPurgeChallenges } from '../controllers/adminChallengeController';

export const adminChallengeRoutes = Router();

const adminLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

adminChallengeRoutes.get('/admin/challenges', adminLimiter, requireAuth(), getAdminChallenges);
adminChallengeRoutes.post('/admin/challenges/:id/resolve', adminLimiter, requireAuth(), postAdminResolveChallenge);
adminChallengeRoutes.post('/admin/challenges/:id/cancel', adminLimiter, requireAuth(), postAdminCancelChallenge);

adminChallengeRoutes.get('/admin/cooldowns', adminLimiter, requireAuth(), getAdminCooldownUsers);
adminChallengeRoutes.post('/admin/cooldowns/:userId/clear', adminLimiter, requireAuth(), postAdminClearCooldown);

// Delete selected challenges
adminChallengeRoutes.post('/admin/challenges/delete', adminLimiter, requireAuth(), postAdminDeleteChallenges);

// DANGEROUS: purge all challenge history (kept for backward-compat / emergency)
adminChallengeRoutes.post('/admin/challenges/purge', adminLimiter, requireAuth(), postAdminPurgeChallenges);
