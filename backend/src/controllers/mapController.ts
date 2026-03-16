import type { RequestHandler } from 'express';
import { prisma } from '../db/prisma';
import { MapService } from '../services/mapService';
import { AoePlayerDirectorySyncService } from '../services/aoePlayerDirectorySyncService';
import { HttpError } from '../utils/httpError';

const normalizeNicknameForDirectory = (name: any): string => {
  const s = String(name ?? '').trim();
  if (!s) return '';
  // normalize spaces (including after dot) to reduce alias mismatch
  return s.replace(/\s+/g, ' ');
};

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

const mergeUserIdsIntoMapPlayers = async (players: Record<string, any> | null | undefined) => {
  const src = (players ?? {}) as Record<string, any>;

  const items = Object.entries(src).map(([playerKey, p]) => {
    const aoeProfileId = (p?.aoeProfileId ?? p?.insightsUserId ?? '').toString().trim();
    const userId = (p?.userId ?? '').toString().trim();
    return { playerKey, aoeProfileId, userId };
  });

  // Always try to resolve userId by claim, even if payload already has some value.
  // This makes challenges available as soon as a player is claimed and also fixes stale/incorrect userId fields.
  const withAoe = items.filter((it) => it.aoeProfileId);
  if (withAoe.length === 0) return src;

  const aoeProfileIds = Array.from(new Set(withAoe.map((m) => m.aoeProfileId)));
  if (aoeProfileIds.length === 0) return src;

  // AoePlayer.claimedByUserId is unique: that's our owner link.
  const rows = await prisma.aoePlayer.findMany({
    where: { aoeProfileId: { in: aoeProfileIds } },
    select: { aoeProfileId: true, claimedByUserId: true },
  });
  const userByProfileId = new Map(rows.filter((r) => r.claimedByUserId).map((r) => [r.aoeProfileId, r.claimedByUserId!]));

  // If no claims exist, still drop any userId fields from payload to avoid stale/incorrect values.
  // (Challenges rely on userId being accurate.)
  if (userByProfileId.size === 0) {
    let changed = false;
    const next: Record<string, any> = { ...src };
    for (const it of withAoe) {
      const cur = next[it.playerKey] ?? {};
      if ((cur?.userId ?? '').toString().trim()) {
        const { userId: _drop, ...rest } = cur;
        next[it.playerKey] = rest;
        changed = true;
      }
    }
    return changed ? next : src;
  }

  let changed = false;
  const next: Record<string, any> = { ...src };

  for (const it of withAoe) {
    const claimedUid = userByProfileId.get(it.aoeProfileId) ?? null;
    const cur = next[it.playerKey] ?? {};

    // If claimed, set/overwrite userId.
    if (claimedUid) {
      if ((cur?.userId ?? '').toString().trim() !== claimedUid) {
        next[it.playerKey] = { ...cur, userId: claimedUid };
        changed = true;
      }
      continue;
    }

    // If not claimed anymore, remove stale userId (optional but keeps data consistent).
    if ((cur?.userId ?? '').toString().trim()) {
      const { userId: _drop, ...rest } = cur;
      next[it.playerKey] = rest;
      changed = true;
    }
  }

  return changed ? next : src;
};

const mergePlayerProfileRatingsIntoMapPlayers = async (players: Record<string, any> | null | undefined) => {
  const src = (players ?? {}) as Record<string, any>;

  const playerKeys = Array.from(
    new Set(
      Object.keys(src)
        .map((k) => String(k ?? '').trim())
        .filter(Boolean)
    )
  ).slice(0, 800);

  if (playerKeys.length === 0) return src;

  const rows = await prisma.playerProfile.findMany({
    where: { playerKey: { in: playerKeys } },
    select: { playerKey: true, ratingPoints: true },
  });

  const ratingByPlayerKey = new Map(rows.map((r) => [r.playerKey, r.ratingPoints] as const));
  if (ratingByPlayerKey.size === 0) return src;

  let changed = false;
  const next: Record<string, any> = { ...src };

  for (const playerKey of playerKeys) {
    if (!ratingByPlayerKey.has(playerKey)) continue;
    const ratingPoints = ratingByPlayerKey.get(playerKey);
    const cur = next[playerKey] ?? {};
    if (cur?.ratingPoints !== ratingPoints) {
      next[playerKey] = { ...cur, ratingPoints };
      changed = true;
    }
  }

  return changed ? next : src;
};

const mergePlayerProfileWinLossIntoMapPlayers = async (players: Record<string, any> | null | undefined) => {
  const src = (players ?? {}) as Record<string, any>;

  const playerKeys = Array.from(
    new Set(
      Object.keys(src)
        .map((k) => String(k ?? '').trim())
        .filter(Boolean)
    )
  ).slice(0, 800);

  if (playerKeys.length === 0) return src;

  // We count ONLY challenges where rating was applied.
  // This aligns UI W/L with rating history and prevents showing unresolved/expired stats.
  const rows = await prisma.userChallenge.findMany({
    where: {
      status: 'COMPLETED',
      ratingAppliedAt: { not: null },
      OR: [{ winnerPlayerKey: { in: playerKeys } }, { loserPlayerKey: { in: playerKeys } }],
    },
    select: { winnerPlayerKey: true, loserPlayerKey: true },
  });

  const winsByPlayerKey = new Map<string, number>();
  const lossesByPlayerKey = new Map<string, number>();

  for (const r of rows) {
    const w = (r.winnerPlayerKey ?? '').toString().trim();
    const l = (r.loserPlayerKey ?? '').toString().trim();
    if (w) winsByPlayerKey.set(w, (winsByPlayerKey.get(w) ?? 0) + 1);
    if (l) lossesByPlayerKey.set(l, (lossesByPlayerKey.get(l) ?? 0) + 1);
  }

  let changed = false;
  const next: Record<string, any> = { ...src };

  for (const playerKey of playerKeys) {
    const wins = winsByPlayerKey.get(playerKey) ?? 0;
    const losses = lossesByPlayerKey.get(playerKey) ?? 0;
    const cur = next[playerKey] ?? {};

    if (cur?.wins !== wins || cur?.losses !== losses) {
      next[playerKey] = { ...cur, wins, losses };
      changed = true;
    }
  }

  return changed ? next : src;
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

    // Best-effort: enrich map payload with userId values based on claim links.
    // This is needed to implement challenges from a building/card reliably.
    try {
      (payload as any).players = await mergeUserIdsIntoMapPlayers((payload as any).players);
    } catch {
      // ignore
    }

    // Best-effort: enrich map payload with ratingPoints from PlayerProfile (playerKey-based rating).
    try {
      (payload as any).players = await mergePlayerProfileRatingsIntoMapPlayers((payload as any).players);
    } catch {
      // ignore
    }

    // Best-effort: enrich map payload with W/L counts from challenges by winner/loser playerKey.
    try {
      (payload as any).players = await mergePlayerProfileWinLossIntoMapPlayers((payload as any).players);
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

    // Best-effort: upsert directory nickname from map payload (admin-edited display name).
    // This helps alias-based stats sync and keeps roster aligned with map.
    try {
      const players = (savedPayload as any)?.players ?? {};
      const updates = Object.values(players)
        .map((p: any) => {
          const aoeProfileId = (p?.aoeProfileId ?? p?.insightsUserId ?? '').toString().trim();
          const nickname = normalizeNicknameForDirectory(p?.name);
          return { aoeProfileId, nickname };
        })
        .filter((x: any) => x.aoeProfileId && x.nickname)
        .slice(0, 200);

      if (updates.length) {
        void (async () => {
          for (const u of updates) {
            try {
              await prisma.aoePlayer.upsert({
                where: { aoeProfileId: u.aoeProfileId },
                create: {
                  aoeProfileId: u.aoeProfileId,
                  aoeProfileUrl: '',
                  nickname: u.nickname,
                },
                update: {
                  // Always take admin-provided display name (source of truth for presentation)
                  nickname: u.nickname,
                },
                select: { id: true },
              });
            } catch (e: any) {
              console.warn('[map-save][aoe-player-upsert] failed', {
                aoeProfileId: u.aoeProfileId,
                reason: e?.message ? String(e.message) : 'unknown_error',
              });
            }
          }
        })();
      }
    } catch {
      // ignore
    }

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

      // Do not block save response; run in background.
      void (async () => {
        for (const id of limited) {
          try {
            const r = await aoeDirSync.syncByAoeProfileId(id);
            // Minimal safe log for ops visibility (only on failures).
            if (!(r as any)?.ok) {
              console.warn('[map-save][aoe-dir-sync] failed', { aoeProfileId: id, reason: (r as any)?.reason });
            }
          } catch (e: any) {
            console.warn('[map-save][aoe-dir-sync] exception', {
              aoeProfileId: id,
              reason: e?.message ? String(e.message) : 'unknown_error',
            });
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

    // Best-effort: enrich map payload with userId values based on claim links.
    try {
      (payload as any).players = await mergeUserIdsIntoMapPlayers((payload as any).players);
    } catch {
      // ignore
    }

    // Best-effort: enrich map payload with ratingPoints from PlayerProfile (playerKey-based rating).
    try {
      (payload as any).players = await mergePlayerProfileRatingsIntoMapPlayers((payload as any).players);
    } catch {
      // ignore
    }

    // Best-effort: enrich map payload with W/L counts from challenges by winner/loser playerKey.
    try {
      (payload as any).players = await mergePlayerProfileWinLossIntoMapPlayers((payload as any).players);
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

    // Best-effort: upsert directory nickname from incoming map payload.
    try {
      const updates = Object.values(players)
        .map((p: any) => {
          const aoeProfileId = (p?.aoeProfileId ?? p?.insightsUserId ?? '').toString().trim();
          const nickname = normalizeNicknameForDirectory(p?.name);
          return { aoeProfileId, nickname };
        })
        .filter((x: any) => x.aoeProfileId && x.nickname)
        .slice(0, 200);

      if (updates.length) {
        void (async () => {
          for (const u of updates) {
            try {
              await prisma.aoePlayer.upsert({
                where: { aoeProfileId: u.aoeProfileId },
                create: {
                  aoeProfileId: u.aoeProfileId,
                  aoeProfileUrl: '',
                  nickname: u.nickname,
                },
                update: {
                  nickname: u.nickname,
                },
                select: { id: true },
              });
            } catch (e: any) {
              console.warn('[map-save][aoe-player-upsert] failed', {
                aoeProfileId: u.aoeProfileId,
                reason: e?.message ? String(e.message) : 'unknown_error',
              });
            }
          }
        })();
      }
    } catch {
      // ignore
    }

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
      // Do not block save response; run in background.
      void (async () => {
        for (const id of limited) {
          try {
            const r = await aoeDirSync.syncByAoeProfileId(id);
            if (!(r as any)?.ok) {
              console.warn('[map-save][aoe-dir-sync] failed', { aoeProfileId: id, reason: (r as any)?.reason });
            }
          } catch (e: any) {
            console.warn('[map-save][aoe-dir-sync] exception', {
              aoeProfileId: id,
              reason: e?.message ? String(e.message) : 'unknown_error',
            });
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
