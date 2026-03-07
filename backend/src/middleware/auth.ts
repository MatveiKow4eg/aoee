import type { RequestHandler } from 'express';
import { AuthService } from '../services/authService';
import { getAuthConfig } from '../config/auth';

const authService = new AuthService();

function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  const parts = header.split(';').map((p) => p.trim());
  for (const p of parts) {
    if (!p) continue;
    const eq = p.indexOf('=');
    if (eq === -1) continue;
    const k = p.slice(0, eq);
    if (k !== name) continue;
    return decodeURIComponent(p.slice(eq + 1));
  }
  return null;
}

export const attachUser: RequestHandler = async (req, _res, next) => {
  try {
    const { cookieName } = getAuthConfig();
    const token = parseCookie(req.headers.cookie, cookieName);
    const me = await authService.me(token);
    (req as any).user = me.user;
    (req as any).sessionToken = token;
    next();
  } catch {
    // do not fail request if auth lookup fails
    (req as any).user = null;
    (req as any).sessionToken = null;
    next();
  }
};

export function requireAuth(): RequestHandler {
  return (req, res, next) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
    next();
  };
}

export function requireRole(role: string): RequestHandler {
  return (req, res, next) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
    if (user.role !== role) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    next();
  };
}
