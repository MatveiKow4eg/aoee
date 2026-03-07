import type { RequestHandler } from 'express';
import type { ZodSchema } from 'zod';
import { HttpError } from '../utils/httpError';

export function validateBody<T>(schema: ZodSchema<T>): RequestHandler {
  return (req, _res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return next(new HttpError(400, 'VALIDATION_ERROR', 'Invalid request body', parsed.error.issues));
    }
    (req as any).body = parsed.data;
    return next();
  };
}
