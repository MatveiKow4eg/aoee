import type { RequestHandler } from 'express';
import crypto from 'crypto';

export const requestId: RequestHandler = (req, res, next) => {
  const existing = req.header('x-request-id');
  const id = existing && existing.length <= 200 ? existing : crypto.randomUUID();
  req.requestId = id;
  res.setHeader('x-request-id', id);
  next();
};
