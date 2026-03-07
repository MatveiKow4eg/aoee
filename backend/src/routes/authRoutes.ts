import { Router } from 'express';
import { getMe, postLogin, postLogout, postRegister } from '../controllers/authController';
import rateLimit from 'express-rate-limit';
import { steamAuthStart, steamAuthCallback } from '../steam/routes';

export const authRoutes = Router();

const authLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

const steamLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

authRoutes.post('/auth/register', authLimiter, postRegister);
authRoutes.post('/auth/login', authLimiter, postLogin);
authRoutes.post('/auth/logout', postLogout);
authRoutes.get('/auth/me', getMe);

authRoutes.get('/auth/steam', steamLimiter, steamAuthStart);
authRoutes.get('/auth/steam/callback', steamLimiter, steamAuthCallback);
