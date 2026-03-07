import { env } from '../config/env';
import { prisma } from '../db/prisma';

export class HealthRepository {
  async ping(): Promise<{ db: 'not-configured' } | { db: 'ok' } | { db: 'error' }> {
    if (!env.DATABASE_URL) return { db: 'not-configured' };

    try {
      // Lightweight connectivity check
      await prisma.$queryRaw`SELECT 1`;
      return { db: 'ok' };
    } catch {
      return { db: 'error' };
    }
  }
}
