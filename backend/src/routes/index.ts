import { Router } from 'express';
import { healthRoutes } from './healthRoutes';
import { mapRoutes } from './mapRoutes';
import { authRoutes } from './authRoutes';
import { aoePlayerRoutes } from './aoePlayerRoutes';
import { adminRoutes } from './adminRoutes';

export const apiRoutes = Router();

// v1 placeholder (so we can evolve without breaking URLs later)
apiRoutes.use('/v1', healthRoutes);
apiRoutes.use('/v1', mapRoutes);
apiRoutes.use('/v1', authRoutes);
apiRoutes.use('/v1', aoePlayerRoutes);
apiRoutes.use('/v1', adminRoutes);

// Backward-compatible (current URLs)
apiRoutes.use(healthRoutes);
apiRoutes.use(mapRoutes);
apiRoutes.use(authRoutes);
apiRoutes.use(aoePlayerRoutes);
apiRoutes.use(adminRoutes);
