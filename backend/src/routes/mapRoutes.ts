import { Router } from 'express';
import {
  getMapDefault,
  getMapDefaultBuildings,
  getMapDefaultPlayers,
  putMapDefault,
  putMapDefaultBuildings,
  putMapDefaultPlayers,
} from '../controllers/mapController';
import { attachUser, requireRole } from '../middleware/auth';

export const mapRoutes = Router();

// Attach user for all map routes
mapRoutes.use(attachUser);

mapRoutes.get('/maps/default', getMapDefault);
mapRoutes.put('/maps/default', requireRole('ADMIN'), putMapDefault);

mapRoutes.get('/maps/default/buildings', getMapDefaultBuildings);
mapRoutes.put('/maps/default/buildings', requireRole('ADMIN'), putMapDefaultBuildings);

mapRoutes.get('/maps/default/players', getMapDefaultPlayers);
mapRoutes.put('/maps/default/players', requireRole('ADMIN'), putMapDefaultPlayers);