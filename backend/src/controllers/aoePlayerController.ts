import type { RequestHandler } from 'express';
import { AoePlayerService } from '../services/aoePlayerService';
import { AoePlayerClaimCandidatesService } from '../services/aoePlayerClaimCandidatesService';
import { MapService } from '../services/mapService';

const service = new AoePlayerService();
const claimCandidatesService = new AoePlayerClaimCandidatesService();

export const getAvailableAoePlayers: RequestHandler = async (req, res, next) => {
  try {
    const result = await service.listAvailable(req.query);
    res.json(result);
  } catch (e) {
    next(e);
  }
};

// Returns claimable players sourced from current map payload (maps/default),
// excluding those already claimed in DB. Does not require auth to browse.
export const getClaimCandidates: RequestHandler = async (req, res, next) => {
  try {
    const limitRaw = (req.query as any)?.limit;
    const limit = limitRaw == null ? undefined : Number(limitRaw);
    const strategy = (req.query as any)?.strategy as any;

    const { items } = await claimCandidatesService.listClaimCandidates({
      limit: Number.isFinite(limit) ? limit : undefined,
      // default strategy is safe: directory first, map fallback only if directory empty
      strategy: strategy === 'union_dedupe' ? 'union_dedupe' : undefined,
      mapSlug: 'default',
    });

    res.json({ items });
  } catch (e) {
    next(e);
  }
};

// Returns claimable players sourced from current map payload (maps/default),
// excluding those already claimed in DB. Does not require auth to browse.
// Legacy/transitional endpoint: prefer GET /api/aoe-players/claim-candidates
export const getClaimablePlayersFromMap: RequestHandler = async (_req, res, next) => {
  try {
    const map = new MapService();
    const payload = await map.getMapPayload('default');
    const players = payload?.players ?? {};

    // Transitional source: map payload is still the source, but canonical identity is now `aoeProfileId`.
    // Legacy `insightsUserId` is accepted as a fallback for old payloads.
    const candidates = Object.values(players)
      .map((p: any) => {
        const aoeProfileIdRaw = (p as any)?.aoeProfileId ?? (p as any)?.insightsUserId ?? '';
        const aoeProfileId = typeof aoeProfileIdRaw === 'string' ? aoeProfileIdRaw.trim() : String(aoeProfileIdRaw || '').trim();
        return {
          displayName: typeof p?.name === 'string' ? p.name.trim() : '',
          aoeProfileId,
          source: 'map_payload' as const,
        };
      })
      .filter((p) => p.displayName && p.aoeProfileId);

    // Query DB for already-claimed profile IDs and filter them out.
    const result = await service.filterUnclaimedByProfileIds(candidates.map((c) => c.aoeProfileId));

    const items = candidates
      .filter((c) => result.unclaimedAoeProfileIds.has(c.aoeProfileId))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'ru'));

    res.json({ items });
  } catch (e) {
    next(e);
  }
};

export const postClaimAoePlayer: RequestHandler = async (req, res, next) => {
  try {
    const user = (req as any).user as { id: string } | null;
    if (!user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });

    const claimed = await service.claimForCurrentUser(user.id, req.body);
    res.json({ player: claimed });
  } catch (e) {
    next(e);
  }
};
