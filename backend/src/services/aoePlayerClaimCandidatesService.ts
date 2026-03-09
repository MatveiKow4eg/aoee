import { AoePlayerRepository } from '../repositories/aoePlayerRepository';
import { MapService } from './mapService';

export type ClaimCandidateSource = 'player_directory' | 'map_payload';

export type ClaimCandidate = {
  aoeProfileId: string;
  displayName: string;
  source: ClaimCandidateSource;
  steamId?: string | null;
  claimed?: boolean;
};

type Strategy = 'directory_first_fallback_if_empty' | 'union_dedupe';

export class AoePlayerClaimCandidatesService {
  constructor(private readonly repo = new AoePlayerRepository(), private readonly map = new MapService()) {}

  private normalizeId(raw: any): string {
    if (raw == null) return '';
    const s = typeof raw === 'string' ? raw : String(raw);
    return s.trim();
  }

  private normalizeName(raw: any): string {
    if (raw == null) return '';
    const s = typeof raw === 'string' ? raw : String(raw);
    return s.trim();
  }

  private dedupeByProfileId(items: ClaimCandidate[]): ClaimCandidate[] {
    const seen = new Map<string, ClaimCandidate>();
    for (const it of items) {
      if (!it.aoeProfileId) continue;
      // Keep the first occurrence (priority decided by construction order)
      if (!seen.has(it.aoeProfileId)) seen.set(it.aoeProfileId, it);
    }
    return Array.from(seen.values());
  }

  async listClaimCandidates(opts?: { strategy?: Strategy; limit?: number; mapSlug?: string }) {
    const strategy: Strategy = opts?.strategy ?? 'directory_first_fallback_if_empty';
    const limit = Math.max(1, Math.min(200, opts?.limit ?? 100));
    const mapSlug = opts?.mapSlug ?? 'default';

    const directory = await this.repo.listUnclaimedDirectoryCandidates({ limit });

    const directoryItems: ClaimCandidate[] = directory.items
      .map((p) => ({
        aoeProfileId: this.normalizeId(p.aoeProfileId),
        displayName: this.normalizeName(p.nickname),
        source: 'player_directory' as const,
        steamId: p.steamId ?? null,
      }))
      .filter((p) => p.aoeProfileId && p.displayName);

    if (strategy === 'directory_first_fallback_if_empty') {
      if (directoryItems.length > 0) {
        return { items: directoryItems };
      }
      const fallback = await this.getFallbackFromMap(mapSlug, limit);
      return { items: fallback };
    }

    const fallback = await this.getFallbackFromMap(mapSlug, limit);
    // Union with directory taking precedence on dedupe.
    const union = this.dedupeByProfileId([...directoryItems, ...fallback]);
    return { items: union };
  }

  private async getFallbackFromMap(mapSlug: string, limit: number): Promise<ClaimCandidate[]> {
    const payload = await this.map.getMapPayload(mapSlug);
    const players = payload?.players ?? {};

    const fromMap = Object.values(players)
      .map((p: any) => {
        // Transitional: accept legacy `insightsUserId` in old payloads.
        const aoeProfileIdRaw = (p as any)?.aoeProfileId ?? (p as any)?.insightsUserId ?? '';
        const aoeProfileId = this.normalizeId(aoeProfileIdRaw);
        const displayName = this.normalizeName((p as any)?.name);
        return {
          aoeProfileId,
          displayName,
          source: 'map_payload' as const,
        };
      })
      .filter((p) => p.aoeProfileId && p.displayName)
      .slice(0, limit);

    // Exclude those already claimed in DB
    const { unclaimedAoeProfileIds } = await this.repo.filterUnclaimedByProfileIds(fromMap.map((c) => c.aoeProfileId));

    return fromMap
      .filter((c) => unclaimedAoeProfileIds.has(c.aoeProfileId))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'ru'));
  }
}
