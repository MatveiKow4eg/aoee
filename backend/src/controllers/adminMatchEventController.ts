import type { RequestHandler } from 'express';
import { MatchEventService } from '../services/matchEventService';
import { HttpError } from '../utils/httpError';

const svc = new MatchEventService();

const requireAdminUserId = (req: any): string => {
  const u = (req as any)?.user ?? null;
  const id = typeof u?.id === 'string' ? u.id.trim() : '';
  const role = typeof u?.role === 'string' ? u.role.trim() : '';
  if (!id) throw new HttpError(401, 'UNAUTHORIZED', 'Unauthorized');
  if (role !== 'ADMIN') throw new HttpError(403, 'FORBIDDEN', 'Admin only');
  return id;
};

export const adminCreateMatchEvent: RequestHandler = async (req, res, next) => {
  try {
    const adminUserId = requireAdminUserId(req);
    const body = (req.body ?? {}) as any;
    const created = await svc.adminCreate(adminUserId, body);
    res.json({ event: created });
  } catch (e) {
    next(e);
  }
};

export const adminListMatchEvents: RequestHandler = async (req, res, next) => {
  try {
    requireAdminUserId(req);
    const status = typeof req.query.status === 'string' ? (req.query.status.trim().toUpperCase() as any) : undefined;
    const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : undefined;
    const items = await svc.adminList({ status, limit });
    res.json({ events: items });
  } catch (e) {
    next(e);
  }
};

export const adminGetMatchEventById: RequestHandler = async (req, res, next) => {
  try {
    requireAdminUserId(req);
    const id = typeof req.params.id === 'string' ? req.params.id.trim() : '';
    const ev = await svc.getById(id);
    res.json({ event: ev });
  } catch (e) {
    next(e);
  }
};

export const adminResolveMatchEvent: RequestHandler = async (req, res, next) => {
  try {
    const adminUserId = requireAdminUserId(req);
    const id = typeof req.params.id === 'string' ? req.params.id.trim() : '';
    const winnerSide = typeof (req.body as any)?.winnerSide === 'string' ? (req.body as any).winnerSide.trim().toUpperCase() : '';
    const notes = typeof (req.body as any)?.notes === 'string' ? (req.body as any).notes : undefined;

    if (!id) throw new HttpError(400, 'INVALID_ID', 'id is required');
    if (winnerSide !== 'A' && winnerSide !== 'B') throw new HttpError(400, 'INVALID_WINNER_SIDE', 'winnerSide must be A or B');

    const updated = await svc.adminResolve({ eventId: id, adminUserId, winnerSide: winnerSide as any, notes });
    res.json({ event: updated });
  } catch (e) {
    next(e);
  }
};

export const adminCancelMatchEvent: RequestHandler = async (req, res, next) => {
  try {
    const adminUserId = requireAdminUserId(req);
    const id = typeof req.params.id === 'string' ? req.params.id.trim() : '';
    const notes = typeof (req.body as any)?.notes === 'string' ? (req.body as any).notes : undefined;

    if (!id) throw new HttpError(400, 'INVALID_ID', 'id is required');

    const updated = await svc.adminCancel({ eventId: id, adminUserId, notes });
    res.json({ event: updated });
  } catch (e) {
    next(e);
  }
};

export const adminDeleteMatchEvent: RequestHandler = async (req, res, next) => {
  try {
    const adminUserId = requireAdminUserId(req);
    const id = typeof req.params.id === 'string' ? req.params.id.trim() : '';
    if (!id) throw new HttpError(400, 'INVALID_ID', 'id is required');

    const r = await svc.adminDelete({ eventId: id, adminUserId });
    res.json(r);
  } catch (e) {
    next(e);
  }
};
