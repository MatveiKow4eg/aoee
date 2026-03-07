import { PrismaClient } from '@prisma/client';

// NOTE: Prisma Client requires DATABASE_URL to be present in environment at runtime.
// prisma.config.ts is used by Prisma CLI for migrations/generate, but the runtime client still reads env.

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  // Fail fast with a clear message instead of Prisma's confusing initialization error.
  throw new Error(
    "[prisma] DATABASE_URL is missing. Add it to backend/.env (example: postgresql://USER:PASSWORD@HOST:5432/DB?schema=public)",
  );
}

// Prisma Client v7 in this project is configured to use engine type "client".
// That requires either a Driver Adapter (recommended) or Prisma Accelerate.
//
// For now, we use the official PostgreSQL adapter, so Prisma works with a normal DATABASE_URL.
// Docs: https://pris.ly/d/driver-adapters
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: databaseUrl });
const adapter = new PrismaPg(pool);

export const prisma: PrismaClient = global.__prisma ?? new PrismaClient({ adapter } as any);

if (process.env.NODE_ENV !== 'production') {
  global.__prisma = prisma;
}
