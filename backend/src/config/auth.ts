import { z } from 'zod';

export const authEnvSchema = z.object({
  AUTH_COOKIE_NAME: z.string().optional().default('aoe_session'),
  AUTH_SESSION_TTL_DAYS: z.coerce.number().int().positive().optional().default(14),
  AUTH_TOKEN_PEPPER: z.string().min(16).optional(),
  FRONTEND_BASE_URL: z.string().url().optional(),
});

export type AuthEnv = z.infer<typeof authEnvSchema>;

export function getAuthConfig() {
  const env = authEnvSchema.parse(process.env);
  return {
    cookieName: env.AUTH_COOKIE_NAME,
    sessionTtlDays: env.AUTH_SESSION_TTL_DAYS,
    // Optional secret mixed into token hashing (recommended for production)
    tokenPepper: env.AUTH_TOKEN_PEPPER ?? '',
    frontendBaseUrl: env.FRONTEND_BASE_URL,
  } as const;
}
