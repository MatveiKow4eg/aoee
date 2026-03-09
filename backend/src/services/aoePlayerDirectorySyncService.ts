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

    try {
      const rawArr = await this.we.getRecentMatchHistoryByProfileIds([id]);
      const raw = rawArr?.[0];
      const identity = this.we.extractIdentityFromRecentMatchHistory(raw, id);

      const existing = await this.repo.findByAoeProfileId(id);

      if (!existing) {
        // Create new record.
        // NOTE: aoeProfileUrl is legacy-required; keep it as empty string placeholder.
        const nickname = (identity.nickname ?? '').trim();
        const safeNickname = nickname || `Player ${id}`;

        await this.repo.createIfMissing({
          aoeProfileId: id,
          aoeProfileUrl: '',
          nickname: safeNickname,
        });

        // Apply steamId if we got it (createIfMissing doesn't set it)
        if (identity.steamId) {
          try {
            await this.repo.updateDirectoryFieldsByAoeProfileId({ aoeProfileId: id, steamId: identity.steamId });
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
