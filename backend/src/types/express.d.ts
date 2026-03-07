import 'express';

declare global {
  namespace Express {
    // Extend as needed later (auth user, request id, etc.)
    interface Request {
      requestId?: string;
    }
  }
}

export {};
