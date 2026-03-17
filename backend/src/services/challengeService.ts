import { prisma } from '../db/prisma';
import { HttpError } from '../utils/httpError';
import { CHALLENGE_LOSS_POINTS, CHALLENGE_WIN_POINTS } from '../config/rating';

export type ChallengeStatus = 'ACTIVE' | 'COMPLETED' | 'EXPIRED' | 'CANCELLED';
export type ChallengeResult = 'CHALLENGER_WON' | 'CHALLENGER_LOST' | 'DRAW' | 'NO_SHOW';

export type CanChallengeReason =
  | 'SELF_CHALLENGE'
  | 'TARGET_NOT_FOUND'
  | 'COOLDOWN_ACTIVE'
  | 'ACTIVE_CHALLENGE_EXISTS';

export type CanChallengeResponse = {
  canChallenge: boolean;
  reason: CanChallengeReason | null;
  cooldownUntil: string | null;
  activeChallengeId: string | null;
};

export class ChallengeService {
  /**
   * Lazy expiry: any read path can call this to mark expired challenges.
   * By default, expiry also triggers challenger cooldown.
   */
  async expireOverdueChallenges(now = new Date()): Promise<{ expiredCount: number }> {
    // Find overdue ACTIVE challenges first (need challengerUserId for cooldown update)
    const overdue = await prisma.userChallenge.findMany({
      where: { status: 'ACTIVE', expiresAt: { lt: now } },
      select: { id: true, challengerUserId: true },
    });

    if (overdue.length === 0) return { expiredCount: 0 };

    const challengerIds: string[] = Array.from(new Set(overdue.map((x: { challengerUserId: string }) => x.challengerUserId)));

    await prisma.$transaction(async (tx) => {
      await tx.userChallenge.updateMany({
        where: { id: { in: overdue.map((x: { id: string }) => x.id) }, status: 'ACTIVE' },
        data: { status: 'EXPIRED', resolvedAt: now },
      });

      // Start cooldown on expiry to prevent abuse (can be changed later).
      const cooldownUntil = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      await tx.user.updateMany({
        where: { id: { in: challengerIds } },
        data: { challengeCooldownUntil: cooldownUntil },
      });
    });

    return { expiredCount: overdue.length };
  }

  async canChallenge(
    challengerUserId: string,
    targetUserId: string,
    now = new Date(),
    opts?: { skipTargetExistenceCheck?: boolean }
  ): Promise<CanChallengeResponse> {
    // always run expiry first to keep rules consistent
    await this.expireOverdueChallenges(now);

    if (challengerUserId === targetUserId) {
      return { canChallenge: false, reason: 'SELF_CHALLENGE', cooldownUntil: null, activeChallengeId: null };
    }

    const challenger = await prisma.user.findUnique({
      select: { id: true, challengeCooldownUntil: true },
      where: { id: challengerUserId },
    });

    // Optional: allow creating challenge placeholders when target is not a user yet.
    if (!opts?.skipTargetExistenceCheck) {
      const target = await prisma.user.findUnique({ select: { id: true }, where: { id: targetUserId } });
      if (!target) {
        return { canChallenge: false, reason: 'TARGET_NOT_FOUND', cooldownUntil: null, activeChallengeId: null };
      }
    }

    const cooldownUntil = challenger?.challengeCooldownUntil ?? null;
    if (cooldownUntil && cooldownUntil.getTime() > now.getTime()) {
      return {
        canChallenge: false,
        reason: 'COOLDOWN_ACTIVE',
        cooldownUntil: cooldownUntil.toISOString(),
        activeChallengeId: null,
      };
    }

    const active = await prisma.userChallenge.findFirst({
      where: { challengerUserId, status: 'ACTIVE' },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    });

    if (active) {
      return { canChallenge: false, reason: 'ACTIVE_CHALLENGE_EXISTS', cooldownUntil: null, activeChallengeId: active.id };
    }

    return { canChallenge: true, reason: null, cooldownUntil: null, activeChallengeId: null };
  }

  async createChallenge(
    challengerUserId: string,
    params:
      | { targetUserId: string }
      | { targetAoeProfileId: string; targetPlayerKey?: string | null }
      | { targetPlayerKey: string },
    now = new Date()
  ) {
    // Resolve target identifiers
    let targetUserId: string | null = null;
    let targetAoeProfileId: string | null = null;
    let targetPlayerKey: string | null = null;

    if ('targetUserId' in params) {
      // If an explicit targetUserId is provided but doesn't exist,
      // we must NOT attempt to write it (will violate FK).
      // Instead, treat it as an unresolved target and rely on optional identifiers.
      const raw = String(params.targetUserId).trim();
      if (raw) {
        const exists = await prisma.user.findUnique({ where: { id: raw }, select: { id: true } });
        targetUserId = exists ? raw : null;
      }
    } else if ('targetAoeProfileId' in params) {
      targetAoeProfileId = String(params.targetAoeProfileId).trim();
      targetPlayerKey = params.targetPlayerKey ? String(params.targetPlayerKey).trim() : null;
    } else if ('targetPlayerKey' in params) {
      targetPlayerKey = String(params.targetPlayerKey).trim();
    }

    // If caller passed something but we couldn't resolve any identifiers,
    // refuse to create a "blank" challenge that can't be displayed/handled.
    if (!targetUserId && !targetAoeProfileId && !targetPlayerKey) {
      throw new HttpError(400, 'TARGET_NOT_RESOLVED', 'Target could not be resolved; pass targetPlayerKey or targetAoeProfileId');
    }

    // If only playerKey was provided, try to resolve aoeProfileId from current map payload.
    if (!targetAoeProfileId && targetPlayerKey) {
      try {
        const map = await prisma.mapState.findUnique({ where: { slug: 'default' }, select: { id: true } });
        if (map) {
          const mp = await prisma.mapPlayer.findFirst({
            where: { mapStateId: map.id, playerKey: targetPlayerKey },
            select: { extraJson: true, name: true },
          });
          const extra = (mp?.extraJson ?? {}) as any;
          const fromExtra = (extra?.aoeProfileId ?? extra?.insightsUserId ?? '').toString().trim();
          if (fromExtra) targetAoeProfileId = fromExtra;
        }
      } catch {
        // ignore
      }
    }

    // If we have aoeProfileId, try to resolve targetUserId via claim.
    if (!targetUserId && targetAoeProfileId) {
      const aoe = await prisma.aoePlayer.findUnique({
        where: { aoeProfileId: targetAoeProfileId },
        select: { claimedByUserId: true },
      });

      const claimed = aoe?.claimedByUserId ? String(aoe.claimedByUserId).trim() : '';
      if (claimed) {
        // Defensive: aoe_players.claimedByUserId might be stale; ensure referenced user exists
        // to avoid FK violations when creating userChallenge.
        const exists = await prisma.user.findUnique({ where: { id: claimed }, select: { id: true } });
        targetUserId = exists ? claimed : null;
      } else {
        targetUserId = null;
      }
    }

    // If aoeProfileId is provided but playerKey was not, try to resolve it from current map payload.
    // This ensures challenges against unclaimed players still keep a stable map identity for UI rendering.
    if (!targetPlayerKey && targetAoeProfileId) {
      const debug = String(process.env.DEBUG_CHALLENGES || '').trim() === '1';
      const want = String(targetAoeProfileId).trim();
      if (debug) {
        console.log('[challenge][reverse-resolve] start', {
          want,
          targetPlayerKeyBefore: targetPlayerKey,
          targetAoeProfileId,
        });
      }

      try {
        const map = await prisma.mapState.findUnique({ where: { slug: 'default' }, select: { id: true } });
        if (debug) console.log('[challenge][reverse-resolve] mapState', { found: !!map, mapStateId: map?.id ?? null });

        if (map) {
          // Note: need to scan all players; Prisma doesn't support JSON query reliably across DBs here.
          // We'll fetch all map players and match in memory.
          const all = await prisma.mapPlayer.findMany({
            where: { mapStateId: map.id },
            select: { playerKey: true, extraJson: true, name: true },
          });
          if (debug) console.log('[challenge][reverse-resolve] mapPlayers loaded', { count: all.length });

          let matched: { playerKey: string; aoe: string; name: string | null } | null = null;

          for (const row of all) {
            const extra = (row?.extraJson ?? {}) as any;
            const aoe = String((extra?.aoeProfileId ?? extra?.insightsUserId ?? '')).trim();
            if (aoe && aoe === want) {
              matched = { playerKey: String(row.playerKey).trim(), aoe, name: (row as any)?.name ?? null };
              targetPlayerKey = matched.playerKey;
              break;
            }
          }

          if (debug) {
            console.log('[challenge][reverse-resolve] match', {
              want,
              matched: matched ?? null,
              targetPlayerKeyAfter: targetPlayerKey,
            });
          }
        }
      } catch (e: any) {
        if (debug) console.log('[challenge][reverse-resolve] exception', { want, reason: e?.message ? String(e.message) : 'unknown_error' });
        // ignore
      }
    }

    // Always enforce challenger-side restrictions (cooldown, 1 active challenge at a time).
    // This MUST apply even when targetUserId is null (unclaimed map players).
    {
      await this.expireOverdueChallenges(now);

      const challenger = await prisma.user.findUnique({
        select: { id: true, challengeCooldownUntil: true },
        where: { id: challengerUserId },
      });

      const cooldownUntil = challenger?.challengeCooldownUntil ?? null;
      if (cooldownUntil && cooldownUntil.getTime() > now.getTime()) {
        throw new HttpError(400, 'COOLDOWN_ACTIVE', 'Cannot create challenge', {
          canChallenge: {
            canChallenge: false,
            reason: 'COOLDOWN_ACTIVE',
            cooldownUntil: cooldownUntil.toISOString(),
            activeChallengeId: null,
          },
        });
      }

      const active = await prisma.userChallenge.findFirst({
        where: { challengerUserId, status: 'ACTIVE' },
        select: { id: true },
        orderBy: { createdAt: 'desc' },
      });

      if (active) {
        throw new HttpError(400, 'ACTIVE_CHALLENGE_EXISTS', 'Cannot create challenge', {
          canChallenge: {
            canChallenge: false,
            reason: 'ACTIVE_CHALLENGE_EXISTS',
            cooldownUntil: null,
            activeChallengeId: active.id,
          },
        });
      }
    }

    // If we resolved a real target user, enforce target-specific rules via canChallenge
    // (self-challenge, optional existence checks, etc.)
    if (targetUserId) {
      const can = await this.canChallenge(challengerUserId, targetUserId, now, { skipTargetExistenceCheck: true });
      if (!can.canChallenge) {
        throw new HttpError(400, can.reason ?? 'CANNOT_CHALLENGE', 'Cannot create challenge', {
          canChallenge: can,
        });
      }
    }

    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    // Resolve challengerPlayerKey (for playerKey-based rating & history)
    // Best-effort: user -> claimed aoeProfileId -> map_players.playerKey
    let challengerPlayerKey: string | null = null;
    try {
      const aoe = await prisma.aoePlayer.findFirst({
        where: { claimedByUserId: challengerUserId },
        select: { aoeProfileId: true },
      });
      const aoeProfileId = aoe?.aoeProfileId ? String(aoe.aoeProfileId).trim() : '';
      if (aoeProfileId) {
        const map = await prisma.mapState.findUnique({ where: { slug: 'default' }, select: { id: true } });
        if (map) {
          const all = await prisma.mapPlayer.findMany({
            where: { mapStateId: map.id },
            select: { playerKey: true, extraJson: true },
          });

          for (const row of all) {
            const extra = (row?.extraJson ?? {}) as any;
            const rowAoe = String((extra?.aoeProfileId ?? extra?.insightsUserId ?? '')).trim();
            if (rowAoe && rowAoe === aoeProfileId) {
              challengerPlayerKey = String(row.playerKey).trim();
              break;
            }
          }
        }
      }
    } catch {
      // ignore
    }

    const data: any = {
      challengerUserId,
      challengerPlayerKey,
      status: 'ACTIVE',
      createdAt: now,
      acceptedAt: now,
      expiresAt,
    };

    if (targetUserId) data.targetUserId = targetUserId;
    if (targetPlayerKey) data.targetPlayerKey = targetPlayerKey;
    if (targetAoeProfileId) data.targetAoeProfileId = targetAoeProfileId;

    // Final defensive FK guard (covers any future targetUserId assignment paths)
    if (data.targetUserId) {
      const uid = String(data.targetUserId).trim();
      const exists = await prisma.user.findUnique({ where: { id: uid }, select: { id: true } });
      if (!exists) {
        const debug = String(process.env.DEBUG_CHALLENGES || '').trim() === '1';
        if (debug) console.log('[challenge][create] dropping invalid targetUserId before insert', { uid });
        delete data.targetUserId;
      }
    }

    // Debug final insert payload
    if (String(process.env.DEBUG_CHALLENGES || '').trim() === '1') {
      console.log('[challenge][create] final data', {
        challengerUserId: data.challengerUserId,
        targetUserId: data.targetUserId ?? null,
        targetPlayerKey: data.targetPlayerKey ?? null,
        targetAoeProfileId: data.targetAoeProfileId ?? null,
      });
    }

    const ch = await prisma.userChallenge.create({
      data,
    });

    return ch;
  }

  async listMyChallenges(userId: string, opts?: { includeCompleted?: boolean }) {
    const includeCompleted = opts?.includeCompleted ?? true;
    const where: any = {
      OR: [{ challengerUserId: userId }, { targetUserId: userId }],
    };
    if (!includeCompleted) where.status = 'ACTIVE';

    await this.expireOverdueChallenges(new Date());

    return prisma.userChallenge.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        challengerUser: { select: { id: true, displayName: true } },
        targetUser: { select: { id: true, displayName: true } },
      },
    });
  }

  async listAdminChallenges(filter: { status?: ChallengeStatus } = {}) {
    await this.expireOverdueChallenges(new Date());

    return prisma.userChallenge.findMany({
      where: filter.status ? { status: filter.status } : undefined,
      orderBy: { createdAt: 'desc' },
      include: {
        challengerUser: { select: { id: true, displayName: true, email: true } },
        targetUser: { select: { id: true, displayName: true, email: true } },
        resolvedByUser: { select: { id: true, displayName: true } },
      },
    });
  }

  /**
   * Global community history (read-only).
   * Auth required, but NOT admin-only.
   *
   * Keep the shape compatible with HUD history rendering:
   * - include challengerUser/targetUser displayName
   * - include playerKey-based fields if present in DB
   */
  async listChallengeHistory(filter: { status?: ChallengeStatus } = {}) {
    await this.expireOverdueChallenges(new Date());

    return prisma.userChallenge.findMany({
      where: filter.status ? { status: filter.status } : undefined,
      orderBy: { createdAt: 'desc' },
      include: {
        challengerUser: { select: { id: true, displayName: true } },
        targetUser: { select: { id: true, displayName: true } },
      },
    });
  }

  async resolveChallenge(params: { challengeId: string; adminUserId: string; result: ChallengeResult; notes?: string | null }, now = new Date()) {
    const { challengeId, adminUserId, result, notes } = params;

    return prisma.$transaction(async (tx) => {
      // expiry inside tx (simple / safe)
      const challenge = await tx.userChallenge.findUnique({ where: { id: challengeId } });
      if (!challenge) throw new HttpError(404, 'NOT_FOUND', 'Challenge not found');

      if (challenge.status !== 'ACTIVE') {
        throw new HttpError(400, 'INVALID_STATUS', `Challenge is not ACTIVE (status=${challenge.status})`);
      }

      const challengerUserId = challenge.challengerUserId;
      const targetUserId = challenge.targetUserId;

      const isChallengerWon = result === 'CHALLENGER_WON';
      const winnerUserId = isChallengerWon ? challengerUserId : targetUserId;
      const loserUserId = isChallengerWon ? targetUserId : challengerUserId;

      // PlayerKey-based winner/loser (works even when targetUserId is null)
      const challengerPlayerKey = (challenge as any).challengerPlayerKey ? String((challenge as any).challengerPlayerKey).trim() : '';
      const targetPlayerKey = (challenge as any).targetPlayerKey ? String((challenge as any).targetPlayerKey).trim() : '';
      const winnerPlayerKey = isChallengerWon ? challengerPlayerKey : targetPlayerKey;
      const loserPlayerKey = isChallengerWon ? targetPlayerKey : challengerPlayerKey;

      // 1) Resolve the challenge first (source of truth for winner/loser)
      const updated = await tx.userChallenge.update({
        where: { id: challengeId },
        data: {
          status: 'COMPLETED',
          result,
          resolvedAt: now,
          resolvedByUserId: adminUserId,
          winnerUserId,
          loserUserId,
          // Cast to any to avoid TS errors when Prisma client types are out of sync with the latest schema.
          ...( {
            winnerPlayerKey: winnerPlayerKey || null,
            loserPlayerKey: loserPlayerKey || null,
          } as any),
          notes: typeof notes === 'string' ? notes : undefined,
        } as any,
      });

      // 2) Apply PLAYER rating points (ONLY once per challenge)
      // Rules:
      // - Do NOT apply if result isn't a win/loss (DRAW/NO_SHOW)
      // - Do NOT apply twice (ratingAppliedAt guard)
      // - Apply to BOTH sides by playerKey (even if targetUserId is null)
      if (!challenge.ratingAppliedAt && (result === 'CHALLENGER_WON' || result === 'CHALLENGER_LOST')) {
        if (winnerPlayerKey && loserPlayerKey && winnerPlayerKey !== loserPlayerKey) {
          // Ensure PlayerProfile exists for both keys
          await (tx as any).playerProfile.upsert({
            where: { playerKey: winnerPlayerKey },
            create: { playerKey: winnerPlayerKey },
            update: {},
          });
          await (tx as any).playerProfile.upsert({
            where: { playerKey: loserPlayerKey },
            create: { playerKey: loserPlayerKey },
            update: {},
          });

          await (tx as any).playerProfile.update({
            where: { playerKey: winnerPlayerKey },
            data: { ratingPoints: { increment: CHALLENGE_WIN_POINTS } },
          });
          await (tx as any).playerProfile.update({
            where: { playerKey: loserPlayerKey },
            data: { ratingPoints: { increment: CHALLENGE_LOSS_POINTS } },
          });

          await (tx as any).playerRatingEvent.createMany({
            data: [
              {
                playerKey: winnerPlayerKey,
                challengeId: challengeId,
                delta: CHALLENGE_WIN_POINTS,
                reason: 'CHALLENGE_WIN',
                createdAt: now,
              },
              {
                playerKey: loserPlayerKey,
                challengeId: challengeId,
                delta: CHALLENGE_LOSS_POINTS,
                reason: 'CHALLENGE_LOSS',
                createdAt: now,
              },
            ],
          });

          // Mark as processed to prevent double-application.
          await tx.userChallenge.update({
            where: { id: challengeId },
            data: { ratingAppliedAt: now },
          });
        }
      }

      const cooldownUntil = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      await tx.user.update({
        where: { id: challengerUserId },
        data: { challengeCooldownUntil: cooldownUntil },
      });

      return updated;
    });
  }

  async cancelChallenge(params: { challengeId: string; adminUserId: string; notes?: string | null }, now = new Date()) {
    const { challengeId, adminUserId, notes } = params;

    return prisma.$transaction(async (tx) => {
      const challenge = await tx.userChallenge.findUnique({ where: { id: challengeId } });
      if (!challenge) throw new HttpError(404, 'NOT_FOUND', 'Challenge not found');
      if (challenge.status !== 'ACTIVE') throw new HttpError(400, 'INVALID_STATUS', 'Only ACTIVE challenges can be cancelled');

      return tx.userChallenge.update({
        where: { id: challengeId },
        data: {
          status: 'CANCELLED',
          resolvedAt: now,
          resolvedByUserId: adminUserId,
          notes: typeof notes === 'string' ? notes : undefined,
        },
      });
    });
  }
}
