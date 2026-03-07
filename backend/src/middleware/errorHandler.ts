import type { ErrorRequestHandler } from 'express';
import { HttpError } from '../utils/httpError';

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) {
    return res.status(err.status).json({
      error: err.code,
      message: err.message,
      details: err.details,
      requestId: req.requestId,
    });
  }

  // Avoid leaking internals
  console.error(err);
  return res.status(500).json({
    error: 'INTERNAL_SERVER_ERROR',
    requestId: req.requestId,
  });
};
