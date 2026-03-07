import type { RequestHandler } from 'express';
import { HealthService } from '../services/healthService';

const healthService = new HealthService();

export const getHealth: RequestHandler = async (_req, res, next) => {
  try {
    res.json(await healthService.getHealth());
  } catch (err) {
    next(err);
  }
};
