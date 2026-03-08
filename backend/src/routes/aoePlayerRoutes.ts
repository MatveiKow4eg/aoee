import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { getAvailableAoePlayers, getClaimablePlayersFromMap, postClaimAoePlayer } from '../controllers/aoePlayerController';
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
// New: claimable players directly from current map payload (excluding already-claimed)
aoePlayerRoutes.get('/aoe-players/claimable-from-map', listLimiter, getClaimablePlayersFromMap);

// requires login
aoePlayerRoutes.post('/aoe-players/claim', claimLimiter, requireAuth(), postClaimAoePlayer);
