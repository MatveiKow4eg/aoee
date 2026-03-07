import express from 'express';
import cors from 'cors';
import { env } from './config/env';
import { createCorsOptions } from './config/cors';
import { createApiRateLimiter, createHelmet } from './config/security';
import { apiRoutes } from './routes';
import { errorHandler } from './middleware/errorHandler';
import { notFoundHandler } from './middleware/notFoundHandler';
import { requestId } from './utils/requestId';

export function createApp() {
  const app = express();

  app.use(requestId);
  app.use(createHelmet());
  app.use(cors(createCorsOptions()));
  app.use(express.json({ limit: '2mb' }));

  // Attach req.user if a valid session cookie is present
  // (does not block unauthenticated requests)
  const { attachUser } = require('./middleware/auth');
  app.use(attachUser);

  // Top-level health (useful for load balancers)
  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Apply rate limit to API only (health stays unthrottled)
  app.use('/api', createApiRateLimiter());
  app.use('/api', apiRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export { env };
