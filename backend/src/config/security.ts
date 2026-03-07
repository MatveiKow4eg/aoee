import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import type { RequestHandler } from 'express';

export function createHelmet(): RequestHandler {
  return helmet({
    // keep defaults; can tune later when we add cookies/auth
  });
}

export function createApiRateLimiter(): RequestHandler {
  return rateLimit({
    windowMs: 60_000,
    limit: 300,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  });
}
