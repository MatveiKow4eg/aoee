import { Router } from 'express';
import {
  adminCancelMatchEvent,
  adminCreateMatchEvent,
  adminGetMatchEventById,
  adminListMatchEvents,
  adminResolveMatchEvent,
} from '../controllers/adminMatchEventController';

const r = Router();

r.get('/match-events', adminListMatchEvents);
r.post('/match-events', adminCreateMatchEvent);
r.get('/match-events/:id', adminGetMatchEventById);
r.post('/match-events/:id/resolve', adminResolveMatchEvent);
r.post('/match-events/:id/cancel', adminCancelMatchEvent);

export default r;
