import { Router } from 'express';
import { getHealth } from '../controllers/healthController';

export const healthRoutes = Router();

healthRoutes.get('/health', getHealth);
