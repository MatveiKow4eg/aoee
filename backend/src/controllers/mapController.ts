import type { RequestHandler } from 'express';
import { prisma } from '../db/prisma';
import { MapService } from '../services/mapService';
import { AoePlayerDirectorySyncService } from '../services/aoePlayerDirectorySyncService';
import { HttpError } from '../utils/httpError';

const mapService = new MapService();
const aoeDirSync = new AoePlayerDirectorySyncService();

const mergeSteamIdsIntoMapPlayers = async (players: Record<string, any> | null | undefined) => {
  const src = (players ?? {}) as Record<string, any>;
  const items = Object.entries(src).map(([playerKey, p]) => {
    const aoeProfileId = (p?.aoeProfileId ?? p?.insightsUserId ?? '').toString().trim();
    const steamId = (p?.steamId ?? '').toString().trim();
    return { playerKey, aoeProfileId, steamId };
  });

  const missing = items.filter((it) => it.aoeProfileId && !it.steamId);
  if (missing.length === 0) return src;

  const aoeProfileIds = Array.from(new Set(missing.map((m) => m.aoeProfileId)));
  if (aoeProfileIds.length === 0) return src;

  const rows = await prisma.aoePlayer.findMany({
    where: { aoeProfileId: { in: aoeProfileIds } },
    select: { aoeProfileId: true, steamId: true },
  });
  const steamByProfileId = new Map(rows.filter((r) => r.steamId).map((r) => [r.aoeProfileId, r.steamId!]));

  if (steamByProfileId.size === 0) return src;

  const next: Record<string, any> = { ...src };
  for (const it of missing) {
    const sid = steamByProfileId.get(it.aoeProfileId);
    if (!sid) continue;
    const cur = next[it.playerKey] ?? {};
    next[it.playerKey] = { ...cur, steamId: sid };
  }

  return next;
};

export const getMapDefault: RequestHandler = async (_req, res, next) => {
  try {
    const payload = await mapService.getMapPayload('default');

    // Best-effort: enrich map payload with known steamId values from the AoePlayer roster.
    // This lets admin UI "подсасывать" steamId without manually re-entering it.
    try {
      (payload as any).players = await mergeSteamIdsIntoMapPlayers((payload as any).players);
    } catch {
      // ignore
    }

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

    // Save map state first.
    const savedPayload = await mapService.saveMap('default', payload, typeof version === 'number' ? version : undefined);

    // Best-effort: ensure AoePlayer roster records exist for any aoeProfileIds present in map payload.
    // This keeps stats refresh working (refresh requires AoePlayer row).
    try {
      const players = (savedPayload as any)?.players ?? {};
      const ids = Array.from(
        new Set(
          Object.values(players)
            .map((p: any) => (p?.aoeProfileId ?? p?.insightsUserId ?? '').toString().trim())
            .filter(Boolean)
        )
      );

      // Keep it conservative to avoid heavy work on save.
      const limited = ids.slice(0, 200);

      void (async () => {
        for (const id of limited) {
          try {
            await aoeDirSync.syncByAoeProfileId(id);
          } catch {
            // ignore
          }
        }
      })();
    } catch {
      // ignore
    }

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

    // Best-effort: enrich map payload with known steamId values from the AoePlayer roster.
    try {
      (payload as any).players = await mergeSteamIdsIntoMapPlayers((payload as any).players);
    } catch {
      // ignore
    }

    res.json({ players: (payload as any).players });
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

    // Best-effort: ensure roster records exist for any incoming aoeProfileIds.
    try {
      const ids = Array.from(
        new Set(
          Object.values(players)
            .map((p: any) => (p?.aoeProfileId ?? p?.insightsUserId ?? '').toString().trim())
            .filter(Boolean)
        )
      );

      const limited = ids.slice(0, 200);
      void (async () => {
        for (const id of limited) {
          try {
            await aoeDirSync.syncByAoeProfileId(id);
          } catch {
            // ignore
          }
        }
      })();
    } catch {
      // ignore
    }

    res.json({ players: savedPayload.players });
  } catch (err) {
    next(err);
  }
};
