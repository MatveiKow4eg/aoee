import { Router } from 'express';
import {
  adminCancelMatchEvent,
  adminCreateMatchEvent,
  adminDeleteMatchEvent,
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
r.delete('/match-events/:id', adminDeleteMatchEvent);

export default r;
