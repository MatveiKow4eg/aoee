import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { getAvailableAoePlayers, getClaimCandidates, getClaimablePlayersFromMap, postClaimAoePlayer } from '../controllers/aoePlayerController';
import { getAoePlayerStatsSnapshot, postRefreshAoePlayerStatsSnapshot } from '../controllers/aoePlayerStatsController';
import { requireAuth } from '../middleware/auth';

export const aoePlayerRoutes = Router();

const listLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

const claimLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

aoePlayerRoutes.get('/aoe-players/available', listLimiter, getAvailableAoePlayers);

// Read-only stats snapshot (cached); does NOT call World’s Edge.
aoePlayerRoutes.get('/aoe-players/:aoeProfileId/stats', listLimiter, getAoePlayerStatsSnapshot);

// Refresh stats snapshot by running backend sync (World’s Edge access stays on backend).
aoePlayerRoutes.post('/aoe-players/:aoeProfileId/stats/refresh', claimLimiter, postRefreshAoePlayerStatsSnapshot);

// New official boundary: claim candidates sourced primarily from player directory (AoePlayer),
// with safe fallback to map payload.
aoePlayerRoutes.get('/aoe-players/claim-candidates', listLimiter, getClaimCandidates);

// Legacy/transitional: claimable players directly from current map payload (excluding already-claimed)
aoePlayerRoutes.get('/aoe-players/claimable-from-map', listLimiter, getClaimablePlayersFromMap);

// requires login
aoePlayerRoutes.post('/aoe-players/claim', claimLimiter, requireAuth(), postClaimAoePlayer);
