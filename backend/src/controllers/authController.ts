import type { RequestHandler } from 'express';
import { z } from 'zod';
import { AuthService } from '../services/authService';
import { getAuthConfig } from '../config/auth';

const authService = new AuthService();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});

function setSessionCookie(res: any, token: string, expiresAt: Date) {
  const { cookieName } = getAuthConfig();
  const isProd = process.env.NODE_ENV === 'production';

  // Cross-origin cookie requirements:
  // - For frontend on a different origin to receive/send cookies, it must be SameSite=None; Secure.
  // - If SameSite=Lax, browsers will NOT send the cookie on XHR/fetch cross-site requests.
  //   That exactly causes: login seems OK, but subsequent /auth/me has no cookie => user:null.
  const sameSite = isProd ? 'None' : 'Lax';

  const parts = [
    `${cookieName}=${encodeURIComponent(token)}`,
    `Path=/`,
    `HttpOnly`,
    `SameSite=${sameSite}`,
    `Expires=${expiresAt.toUTCString()}`,
  ];

  // For SameSite=None the cookie MUST be Secure (Chrome/Safari).
  // In production we are behind HTTPS, so always set Secure.
  if (isProd) parts.push('Secure');

  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res: any) {
  const { cookieName } = getAuthConfig();
  const isProd = process.env.NODE_ENV === 'production';

  const sameSite = isProd ? 'None' : 'Lax';

  const parts = [
    `${cookieName}=`,
    `Path=/`,
    `HttpOnly`,
    `SameSite=${sameSite}`,
    `Expires=${new Date(0).toUTCString()}`,
  ];

  if (isProd) parts.push('Secure');

  res.setHeader('Set-Cookie', parts.join('; '));
}

export const postRegister: RequestHandler = async (req, res, next) => {
  try {
    const body = registerSchema.parse(req.body);
    await authService.register(body.email, body.password);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

export const postLogin: RequestHandler = async (req, res, next) => {
  try {
    const body = loginSchema.parse(req.body);

    const result = await authService.login(body.email, body.password, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    setSessionCookie(res, result.token, result.expiresAt);
    res.json({ user: result.user });
  } catch (err) {
    next(err);
  }
};

export const postLogout: RequestHandler = async (req, res, next) => {
  try {
    const token = (req as any).sessionToken as string | null;
    await authService.logout(token);
    clearSessionCookie(res);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

export const getMe: RequestHandler = async (req, res, next) => {
  try {
    const user = (req as any).user ?? null;
    res.json({ user });
  } catch (err) {
    next(err);
  }
};
