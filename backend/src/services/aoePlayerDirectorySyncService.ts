import { AoePlayerRepository } from '../repositories/aoePlayerRepository';
import { WorldsEdgeApiService } from './worldsEdgeApiService';

export type SyncResult =
  | { ok: true; status: 'created' | 'updated' | 'noop'; player: any; identity: any }
  | { ok: false; status: 'failed'; aoeProfileId: string; reason: string };

export class AoePlayerDirectorySyncService {
  constructor(
    private readonly repo = new AoePlayerRepository(),
    private readonly we = new WorldsEdgeApiService(),
  ) {}

  private pickNickname(args: { existingNickname?: string | null; incomingNickname?: string | null }) {
    const existing = typeof args.existingNickname === 'string' ? args.existingNickname.trim() : '';
    const incoming = typeof args.incomingNickname === 'string' ? args.incomingNickname.trim() : '';

    // Never overwrite a non-empty nickname with empty.
    if (!incoming) return null;

    // If existing empty -> take.
    if (!existing) return incoming;

    // If different -> update (incoming is assumed fresher from official API).
    if (existing !== incoming) return incoming;

    return null;
  }

  private pickSteamId(args: { existingSteamId?: string | null; incomingSteamId?: string | null }) {
    const existing = typeof args.existingSteamId === 'string' ? args.existingSteamId.trim() : '';
    const incoming = typeof args.incomingSteamId === 'string' ? args.incomingSteamId.trim() : '';

    // Only write if we have a valid-looking incoming steamId
    if (!incoming) return null;
    if (!/^\d{10,30}$/.test(incoming)) return null;

    // If empty -> set.
    if (!existing) return incoming;

    // If different -> update (safe because this is canonical id). But could be wrong if upstream mismatch.
    // To be extra safe, we update only if it matches exactly or existing is empty.
    // In Stage 5 we avoid changing non-empty steamId.
    return null;
  }

  /**
   * Sync (enrich/upsert) ONE player by aoeProfileId using World’s Edge.
   *
   * Safety rules:
   * - never overwrite existing non-empty fields with empty
   * - do not touch claimedByUserId/claimedAt
   * - do not mutate aoeProfileUrl meaningfully (keep legacy placeholder)
   */
  async syncByAoeProfileId(aoeProfileId: string): Promise<SyncResult> {
    const id = String(aoeProfileId || '').trim();
    if (!id) return { ok: false, status: 'failed', aoeProfileId: id, reason: 'empty_aoeProfileId' };

    // Targeted debug (safe): enabled only for a couple of profile ids.
    const debugIds = new Set(['11375082', '420789', '4207889']);
    const debug = debugIds.has(id);

    try {
      const rawArr = await this.we.getRecentMatchHistoryByProfileIds([id]);
      const raw = rawArr?.[0];
      if (debug) {
        console.log('[aoe-dir-sync][debug] recentMatchHistory response summary', {
          aoeProfileId: id,
          rawArrIsArray: Array.isArray(rawArr),
          rawArrLen: Array.isArray(rawArr) ? rawArr.length : null,
          rawType: Array.isArray(raw) ? 'array' : typeof raw,
          rawKeys: raw && typeof raw === 'object' && !Array.isArray(raw) ? Object.keys(raw).slice(0, 40) : null,
        });
      }

      const identity = this.we.extractIdentityFromRecentMatchHistory(raw, id);
      if (debug) {
        console.log('[aoe-dir-sync][debug] extracted identity', {
          aoeProfileId: id,
          identity,
        });
      }

      if (identity?.steamId && debug) {
        console.log('[aoe-dir-sync][debug] steamId found from identity', { aoeProfileId: id, steamId: identity.steamId });
      }

      const existing = await this.repo.findByAoeProfileId(id);

      if (debug) {
        console.log('[aoe-dir-sync][debug] existing aoePlayer', {
          aoeProfileId: id,
          exists: !!existing,
          existing: existing
            ? {
                id: (existing as any).id,
                aoeProfileId: (existing as any).aoeProfileId,
                nickname: (existing as any).nickname,
                steamId: (existing as any).steamId ?? null,
              }
            : null,
        });
      }

      if (!existing) {
        // Create new record.
        // NOTE: aoeProfileUrl is legacy-required; keep it as empty string placeholder.
        const nickname = (identity.nickname ?? '').trim();
        const safeNickname = nickname || `Player ${id}`;

        if (debug) {
          console.log('[aoe-dir-sync][debug] creating aoePlayer', {
            aoeProfileId: id,
            nickname,
            safeNickname,
            identity,
          });
        }

        await this.repo.createIfMissing({
          aoeProfileId: id,
          aoeProfileUrl: '',
          nickname: safeNickname,
        });

        if (debug) {
          console.log('[aoe-dir-sync][debug] created aoePlayer (post-create lookup)', {
            aoeProfileId: id,
          });
        }

        // Apply steamId if we got it (createIfMissing doesn't set it)
        if (identity.steamId) {
          try {
            await this.repo.updateDirectoryFieldsByAoeProfileId({ aoeProfileId: id, steamId: identity.steamId });
            if (debug) console.log('[aoe-dir-sync][debug] steamId saved to aoe_players', { aoeProfileId: id, steamId: identity.steamId });
          } catch {
            // ignore steamId conflicts (unique)
          }
        }

        const created = await this.repo.findByAoeProfileId(id);
        return { ok: true, status: 'created', player: created, identity };
      }

      // Update existing (directory enrichment)
      const patchNickname = this.pickNickname({ existingNickname: existing.nickname, incomingNickname: identity.nickname ?? null });
      const patchSteamId = this.pickSteamId({ existingSteamId: (existing as any).steamId ?? null, incomingSteamId: identity.steamId ?? null });
      if (debug && patchSteamId) {
        console.log('[aoe-dir-sync][debug] will patch steamId', {
          aoeProfileId: id,
          existingSteamId: (existing as any).steamId ?? null,
          incomingSteamId: identity.steamId ?? null,
          patchSteamId,
        });
      }

      let updatedPlayer = existing;
      let didUpdate = false;

      if (patchNickname || patchSteamId) {
        try {
          const updated = await this.repo.updateDirectoryFieldsByAoeProfileId({
            aoeProfileId: id,
            nickname: patchNickname ?? undefined,
            steamId: patchSteamId ?? undefined,
          });
          if (updated) {
            updatedPlayer = updated as any;
            didUpdate = true;
          }
        } catch {
          // steamId could violate unique constraint; ignore to avoid breaking sync.
          // nickname update shouldn't fail.
          if (patchNickname) {
            const updated = await this.repo.updateDirectoryFieldsByAoeProfileId({ aoeProfileId: id, nickname: patchNickname });
            if (updated) {
              updatedPlayer = updated as any;
              didUpdate = true;
            }
          }
        }
      }

      return { ok: true, status: didUpdate ? 'updated' : 'noop', player: updatedPlayer, identity };
    } catch (e: any) {
      if (debug) {
        console.warn('[aoe-dir-sync][debug] sync failed', {
          aoeProfileId: id,
          reason: e?.message ? String(e.message) : 'unknown_error',
        });
      }
      return {
        ok: false,
        status: 'failed',
        aoeProfileId: id,
        reason: e?.message ? String(e.message) : 'unknown_error',
      };
    }
  }

  async syncManyByAoeProfileIds(profileIds: string[], opts?: { concurrency?: number }) {
    const ids = Array.from(new Set(profileIds.map((s) => String(s || '').trim()).filter(Boolean)));
    const concurrency = Math.max(1, Math.min(5, opts?.concurrency ?? 2));

    const results: SyncResult[] = [];
    let i = 0;

    const workers = Array.from({ length: concurrency }).map(async () => {
      while (true) {
        const idx = i++;
        if (idx >= ids.length) break;
        const id = ids[idx]!;
        const r = await this.syncByAoeProfileId(id);
        results.push(r);
      }
    });

    await Promise.all(workers);

    const summary = {
      total: results.length,
      created: results.filter((r) => r.ok && r.status === 'created').length,
      updated: results.filter((r) => r.ok && r.status === 'updated').length,
      noop: results.filter((r) => r.ok && r.status === 'noop').length,
      failed: results.filter((r) => !r.ok).length,
    };

    return { results, summary };
  }
}
