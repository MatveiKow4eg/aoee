import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/auth';
import { getCanChallenge, getChallengeHistory, getMyChallenges, postCreateChallenge } from '../controllers/challengeController';

export const challengeRoutes = Router();

const limiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

// public/user endpoints (auth required)
challengeRoutes.get('/challenges/can-challenge/:targetUserId', limiter, requireAuth(), getCanChallenge);
challengeRoutes.post('/challenges', limiter, requireAuth(), postCreateChallenge);
challengeRoutes.get('/challenges/my', limiter, requireAuth(), getMyChallenges);

// Global community history (auth required)
challengeRoutes.get('/challenges/history', limiter, requireAuth(), getChallengeHistory);
