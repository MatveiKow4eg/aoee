import type { CorsOptions } from 'cors';
import { corsOrigins, env } from './env';

export function createCorsOptions(): CorsOptions {
  // If origins are not configured, disable CORS entirely (safer than '*')
  if (corsOrigins.length === 0) {
    return { origin: false };
  }

  return {
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    maxAge: env.NODE_ENV === 'production' ? 86_400 : 600,
  };
}
