import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).optional(),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGINS: z.string().optional().default(''),
  DATABASE_URL: z.string().optional(),

  // World’s Edge API (Age of Empires)
  WORLDS_EDGE_API_BASE_URL: z.string().optional().default('https://aoe-api.worldsedgelink.com/community/leaderboard'),
  WORLDS_EDGE_API_TIMEOUT_MS: z.coerce.number().int().positive().optional().default(7000),
});

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse(process.env);

export const corsOrigins = env.CORS_ORIGINS.split(',')
  .map((s) => s.trim())
  .filter(Boolean);
