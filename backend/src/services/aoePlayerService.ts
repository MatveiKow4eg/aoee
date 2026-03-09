import { z } from 'zod';
import { AoePlayerRepository } from '../repositories/aoePlayerRepository';
import { HttpError } from '../utils/httpError';

const listSchema = z.object({
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(30),
  cursor: z.string().optional(),
});

const claimSchema = z.object({
  aoeProfileId: z.string().min(1),
  nickname: z.string().min(1).optional(),
});

export class AoePlayerService {
  constructor(private readonly repo = new AoePlayerRepository()) {}

  async listAvailable(query: unknown) {
    const { q, limit, cursor } = listSchema.parse(query);
    return this.repo.listAvailable({ q, limit, cursor: cursor ?? null });
  }

  // Given a list of aoeProfileIds, return a Set of those that are currently unclaimed.
  async filterUnclaimedByProfileIds(aoeProfileIds: string[]) {
    const ids = Array.from(new Set(aoeProfileIds.map((s) => String(s || '').trim()).filter(Boolean)));
    if (ids.length === 0) return { unclaimedAoeProfileIds: new Set<string>() };

    // Query claimed ones in a single call and subtract.
    const claimed = await this.repo.findClaimedByAoeProfileIds(ids);
    const claimedSet = new Set(claimed.map((r) => r.aoeProfileId));
    const unclaimed = new Set(ids.filter((id) => !claimedSet.has(id)));
    return { unclaimedAoeProfileIds: unclaimed };
  }

  async claimForCurrentUser(userId: string, body: unknown) {
    const { aoeProfileId, nickname } = claimSchema.parse(body);

    const safeNickname = (nickname ?? '').trim();
    // Transitional legacy: do NOT generate aoe2insights profile URLs automatically.
    // aoeProfileUrl remains in schema for backward-compat, but is not source of truth.
    const computedUrl = '';

    const already = await this.repo.findClaimedByUserId(userId);
    if (already) {
      throw new HttpError(409, 'USER_ALREADY_CLAIMED', 'User already claimed a player');
    }

    let exists = await this.repo.findByAoeProfileId(aoeProfileId);
    if (!exists) {
      // Allow claiming players that already exist in the map payload by auto-creating roster record (best-effort)
      if (!safeNickname) {
        throw new HttpError(400, 'NICKNAME_REQUIRED', 'Nickname required to create player');
      }
      await this.repo.createIfMissing({
        aoeProfileId,
        aoeProfileUrl: computedUrl,
        nickname: safeNickname,
      });
      exists = await this.repo.findByAoeProfileId(aoeProfileId);
      if (!exists) {
        throw new HttpError(500, 'PLAYER_CREATE_FAILED', 'Unable to create player');
      }
    }

    if (exists.claimedByUserId) {
      throw new HttpError(409, 'PLAYER_ALREADY_CLAIMED', 'Player already claimed');
    }

    const count = await this.repo.claimByAoeProfileId({ userId, aoeProfileId });
    if (count !== 1) {
      // race: someone else claimed between checks
      throw new HttpError(409, 'PLAYER_ALREADY_CLAIMED', 'Player already claimed');
    }

    const claimed = await this.repo.findClaimedByUserId(userId);
    return claimed;
  }
}
