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

  private async resolvePlayerKeyByAoeProfileId(aoeProfileIdRaw: unknown): Promise<{ playerKey: string | null; reason: string }> {
    const aoeProfileId = typeof aoeProfileIdRaw === 'string' ? aoeProfileIdRaw.trim() : '';
    if (!aoeProfileId) return { playerKey: null, reason: 'NO_AOE_PROFILE_ID' };

    try {
      const { prisma } = await import('../db/prisma');
      const map = await prisma.mapState.findUnique({ where: { slug: 'default' }, select: { id: true } });
      if (!map) return { playerKey: null, reason: 'MAP_NOT_FOUND' };

      const all = await prisma.mapPlayer.findMany({
        where: { mapStateId: map.id },
        select: { playerKey: true, extraJson: true },
      });

      for (const row of all) {
        const extra = (row?.extraJson ?? {}) as any;
        const rowAoe = String((extra?.aoeProfileId ?? extra?.insightsUserId ?? '')).trim();
        if (rowAoe && rowAoe === aoeProfileId) {
          return { playerKey: String(row.playerKey).trim(), reason: 'OK' };
        }
      }

      return { playerKey: null, reason: 'MAP_PLAYER_NOT_FOUND_BY_AOE_PROFILE_ID' };
    } catch (e: any) {
      return { playerKey: null, reason: e?.message ? String(e.message) : 'unknown_error' };
    }
  }

  async listAvailable(query: unknown) {
    const { q, limit, cursor } = listSchema.parse(query);
    return this.repo.listAvailable({ q, limit, cursor: cursor ?? null });
  }

  // Given a list of aoeProfileIds, return a Set of those that are currently unclaimed.
  async filterUnclaimedByProfileIds(aoeProfileIds: string[]) {
    return this.repo.filterUnclaimedByProfileIds(aoeProfileIds);
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

    // OR-identity model: ensure PlayerProfile exists by playerKey and link it to the user.
    // This must NOT create a new rating identity; it must attach to the existing profile.
    try {
      const { prisma } = await import('../db/prisma');

      const keyRes = await this.resolvePlayerKeyByAoeProfileId(aoeProfileId);
      const playerKey = keyRes.playerKey;

      if (playerKey) {
        // Ensure profile exists
        const profile = await (prisma as any).playerProfile.upsert({
          where: { playerKey },
          create: {
            playerKey,
            aoeProfileId,
            displayName: safeNickname || undefined,
          },
          update: {
            aoeProfileId,
            displayName: safeNickname || undefined,
          },
        });

        const claimedByUserId = (profile as any).claimedByUserId ? String((profile as any).claimedByUserId).trim() : '';

        if (!claimedByUserId) {
          await (prisma as any).playerProfile.update({
            where: { playerKey },
            data: { claimedByUserId: userId },
          });
        } else if (claimedByUserId !== userId) {
          // Roll back roster claim? We intentionally do NOT attempt rollback here.
          // Instead, surface conflict so ops can resolve; this should be rare.
          throw new HttpError(409, 'PLAYER_PROFILE_ALREADY_CLAIMED', 'Player profile already claimed by another user');
        }
      } else {
        // Fallback: try to claim an existing profile by aoeProfileId.
        // This supports OR-identity: do not create a new rating identity.
        const existingByAoe = await (prisma as any).playerProfile.findFirst({
          where: { aoeProfileId },
          select: { playerKey: true, claimedByUserId: true },
        });

        if (existingByAoe?.playerKey) {
          const pk = String(existingByAoe.playerKey).trim();
          const claimed = existingByAoe.claimedByUserId ? String(existingByAoe.claimedByUserId).trim() : '';

          if (!claimed) {
            await (prisma as any).playerProfile.update({
              where: { playerKey: pk },
              data: { claimedByUserId: userId },
            });
          } else if (claimed !== userId) {
            throw new HttpError(409, 'PLAYER_PROFILE_ALREADY_CLAIMED', 'Player profile already claimed by another user');
          }
        } else {
          // No playerKey found in current map payload; keep roster claim only.
          // This still allows account ownership, but profile-based rating will appear once playerKey is known.
          if (String(process.env.DEBUG_CHALLENGES || '').trim() === '1') {
            console.log('[claim][playerProfile] skip: cannot resolve playerKey', { aoeProfileId, reason: keyRes.reason });
          }
        }
      }
    } catch (e: any) {
      // Do not break claim flow; log and continue.
      console.warn('[claim][playerProfile] failed', { aoeProfileId, reason: e?.message ? String(e.message) : 'unknown_error' });
    }

    const claimed = await this.repo.findClaimedByUserId(userId);
    return claimed;
  }
}
