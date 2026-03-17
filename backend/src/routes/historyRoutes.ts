import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/auth';
import { getUnifiedHistory } from '../controllers/historyController';

const r = Router();

const limiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

// Unified community history (auth required)
r.get('/history', limiter, requireAuth(), getUnifiedHistory);

export default r;
