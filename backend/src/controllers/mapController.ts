import type { RequestHandler } from 'express';
import { MapService } from '../services/mapService';
import { HttpError } from '../utils/httpError';

const mapService = new MapService();

export const getMapDefault: RequestHandler = async (_req, res, next) => {
  try {
    const payload = await mapService.getMapPayload('default');
    res.json({ version: 1, payload });
  } catch (err) {
    next(err);
  }
};

export const putMapDefault: RequestHandler = async (req, res, next) => {
  try {
    if (!req.body || typeof req.body !== 'object') throw new HttpError(400, 'INVALID_BODY', 'Body must be a JSON object');

    const { payload, version } = req.body as any;
    if (!payload || typeof payload !== 'object') throw new HttpError(400, 'INVALID_PAYLOAD', 'payload must be a JSON object');

    const savedPayload = await mapService.saveMap('default', payload, typeof version === 'number' ? version : undefined);
    res.json({ version: 1, payload: savedPayload });
  } catch (err) {
    next(err);
  }
};

export const getMapDefaultBuildings: RequestHandler = async (_req, res, next) => {
  try {
    const payload = await mapService.getMapPayload('default');
    res.json({ buildings: payload.buildings });
  } catch (err) {
    next(err);
  }
};

export const putMapDefaultBuildings: RequestHandler = async (req, res, next) => {
  try {
    if (!req.body || typeof req.body !== 'object') throw new HttpError(400, 'INVALID_BODY', 'Body must be a JSON object');

    const { buildings } = req.body as any;
    if (!buildings || typeof buildings !== 'object') throw new HttpError(400, 'INVALID_BUILDINGS', 'buildings must be a JSON object');

    const savedPayload = await mapService.saveBuildings('default', buildings);
    res.json({ buildings: savedPayload.buildings });
  } catch (err) {
    next(err);
  }
};

export const getMapDefaultPlayers: RequestHandler = async (_req, res, next) => {
  try {
    const payload = await mapService.getMapPayload('default');
    res.json({ players: payload.players });
  } catch (err) {
    next(err);
  }
};

export const putMapDefaultPlayers: RequestHandler = async (req, res, next) => {
  try {
    if (!req.body || typeof req.body !== 'object') throw new HttpError(400, 'INVALID_BODY', 'Body must be a JSON object');

    const { players } = req.body as any;
    if (!players || typeof players !== 'object') throw new HttpError(400, 'INVALID_PLAYERS', 'players must be a JSON object');

    const savedPayload = await mapService.savePlayers('default', players);
    res.json({ players: savedPayload.players });
  } catch (err) {
    next(err);
  }
};
