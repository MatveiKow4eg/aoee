import { prisma } from '../db/prisma';
import { HttpError } from '../utils/httpError';
import { CHALLENGE_LOSS_POINTS, CHALLENGE_WIN_POINTS } from '../config/rating';
import { MapService } from './mapService';

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

const isValidRatingResult = (result: any): result is 'CHALLENGER_WON' | 'CHALLENGER_LOST' => {
  return result === 'CHALLENGER_WON' || result === 'CHALLENGER_LOST';
};

export class ChallengeService {
  private readonly mapService = new MapService();

  private async resolvePlayerKeyByAoeProfileId(
    tx: any,
    aoeProfileIdRaw: unknown
  ): Promise<{ playerKey: string | null; reason: string }> {
    const aoeProfileId = typeof aoeProfileIdRaw === 'string' ? aoeProfileIdRaw.trim() : '';
    if (!aoeProfileId) return { playerKey: null, reason: 'NO_AOE_PROFILE_ID' };

    try {
      const map = await tx.mapState.findUnique({ where: { slug: 'default' }, select: { id: true } });
      if (!map) return { playerKey: null, reason: 'MAP_NOT_FOUND' };

      const all = await tx.mapPlayer.findMany({
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
      return { playerKey: null, reason: `EXCEPTION_${e?.message ? String(e.message) : 'unknown_error'}` };
    }
  }

  private async resolvePlayerKeyByUserId(
    tx: any,
    userIdRaw: unknown
  ): Promise<{ playerKey: string | null; reason: string; aoeProfileId: string | null }> {
    const userId = typeof userIdRaw === 'string' ? userIdRaw.trim() : '';
    if (!userId) return { playerKey: null, reason: 'NO_USER_ID', aoeProfileId: null };

    // Resolve aoeProfileId via claim
    const aoe = await tx.aoePlayer.findFirst({
      where: { claimedByUserId: userId },
      select: { aoeProfileId: true },
    });

    const aoeProfileId = aoe?.aoeProfileId ? String(aoe.aoeProfileId).trim() : '';
    if (!aoeProfileId) return { playerKey: null, reason: 'NO_CLAIMED_AOE_PROFILE', aoeProfileId: null };

    const r = await this.resolvePlayerKeyByAoeProfileId(tx, aoeProfileId);
    return { playerKey: r.playerKey, reason: r.playerKey ? 'OK' : `AOE_PROFILE_TO_PLAYERKEY_${r.reason}`, aoeProfileId };
  }

  private async resolveTargetPlayerKey(
    tx: any,
    params: { incomingTargetPlayerKey?: string | null; targetUserId?: string | null; targetAoeProfileId?: string | null }
  ): Promise<{ targetPlayerKey: string | null; reason: string }> {
    const incoming = typeof params.incomingTargetPlayerKey === 'string' ? params.incomingTargetPlayerKey.trim() : '';
    if (incoming) return { targetPlayerKey: incoming, reason: 'FROM_PAYLOAD' };

    const targetUserId = typeof params.targetUserId === 'string' ? params.targetUserId.trim() : '';
    if (targetUserId) {
      const r = await this.resolvePlayerKeyByUserId(tx, targetUserId);
      if (r.playerKey) return { targetPlayerKey: r.playerKey, reason: 'FROM_TARGET_USER_CLAIM' };
      // keep going: maybe aoeProfileId was provided explicitly
    }

    const targetAoeProfileId = typeof params.targetAoeProfileId === 'string' ? params.targetAoeProfileId.trim() : '';
    if (targetAoeProfileId) {
      const r = await this.resolvePlayerKeyByAoeProfileId(tx, targetAoeProfileId);
      if (r.playerKey) return { targetPlayerKey: r.playerKey, reason: 'FROM_TARGET_AOE_PROFILE_ID' };
      return { targetPlayerKey: null, reason: `CANNOT_RESOLVE_BY_AOE_PROFILE_ID_${r.reason}` };
    }

    return { targetPlayerKey: null, reason: 'NO_INPUTS' };
  }

  /**
   * Apply rating for a resolved challenge.
   *
   * Idempotent rules:
   * - challenge must be COMPLETED
   * - result must be CHALLENGER_WON/CHALLENGER_LOST
   * - ratingAppliedAt must be null
   *
   * This method is intentionally conservative: if required player keys are missing,
   * it will NOT apply rating and will return a reason.
   */
  private async applyRatingIfNeeded(
    tx: any,
    params: { challengeId: string; now: Date; debug?: boolean }
  ): Promise<{ applied: boolean; reason: string; ratingAppliedAtAfter: Date | null }> {
    const { challengeId, now, debug } = params;

    const ch = await tx.userChallenge.findUnique({ where: { id: challengeId } });
    if (!ch) return { applied: false, reason: 'NOT_FOUND', ratingAppliedAtAfter: null };

    if (ch.status !== 'COMPLETED') {
      return { applied: false, reason: `SKIP_STATUS_${String(ch.status)}`, ratingAppliedAtAfter: ch.ratingAppliedAt ?? null };
    }

    if (!isValidRatingResult(ch.result)) {
      return { applied: false, reason: `SKIP_RESULT_${String(ch.result ?? 'NULL')}`, ratingAppliedAtAfter: ch.ratingAppliedAt ?? null };
    }

    if (ch.ratingAppliedAt) {
      return { applied: false, reason: 'ALREADY_APPLIED', ratingAppliedAtAfter: ch.ratingAppliedAt };
    }

    const isChallengerWon = ch.result === 'CHALLENGER_WON';

    const challengerPlayerKey = (ch as any).challengerPlayerKey ? String((ch as any).challengerPlayerKey).trim() : '';
    const targetPlayerKey = (ch as any).targetPlayerKey ? String((ch as any).targetPlayerKey).trim() : '';

    const winnerPlayerKey = isChallengerWon ? challengerPlayerKey : targetPlayerKey;
    const loserPlayerKey = isChallengerWon ? targetPlayerKey : challengerPlayerKey;

    if (!winnerPlayerKey || !loserPlayerKey) {
      return { applied: false, reason: 'MISSING_PLAYER_KEYS', ratingAppliedAtAfter: null };
    }

    if (winnerPlayerKey === loserPlayerKey) {
      return { applied: false, reason: 'SAME_PLAYER_KEYS', ratingAppliedAtAfter: null };
    }

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
    const updated = await tx.userChallenge.update({
      where: { id: challengeId },
      data: { ratingAppliedAt: now },
    });

    if (debug) {
      console.log('[challenge][applyRating] applied', {
        challengeId,
        winnerPlayerKey,
        loserPlayerKey,
        ratingAppliedAt: updated.ratingAppliedAt ? updated.ratingAppliedAt.toISOString() : null,
      });
    }

    return { applied: true, reason: 'APPLIED', ratingAppliedAtAfter: updated.ratingAppliedAt ?? null };
  }

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

    // Resolve targetPlayerKey with strict priority:
    // a) payload
    // b) targetUserId -> claim -> aoeProfileId -> map playerKey
    // c) targetAoeProfileId -> map playerKey
    const targetKeyRes = await this.resolveTargetPlayerKey(prisma, {
      incomingTargetPlayerKey: targetPlayerKey,
      targetUserId,
      targetAoeProfileId,
    });

    const resolvedTargetPlayerKey = targetKeyRes.targetPlayerKey;

    // TEMP debug log (required by task)
    if (String(process.env.DEBUG_CHALLENGES || '').trim() === '1') {
      console.log('[challenge][create][resolve-target-key]', {
        challengerUserId,
        targetUserId: targetUserId ?? null,
        incomingTargetPlayerKey: targetPlayerKey ?? null,
        incomingTargetAoeProfileId: targetAoeProfileId ?? null,
        resolvedTargetPlayerKey: resolvedTargetPlayerKey ?? null,
        reason: targetKeyRes.reason,
      });
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
    if (resolvedTargetPlayerKey) data.targetPlayerKey = resolvedTargetPlayerKey;
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

    const rows = await prisma.userChallenge.findMany({
      where: filter.status ? { status: filter.status } : undefined,
      orderBy: { createdAt: 'desc' },
      include: {
        challengerUser: { select: { id: true, displayName: true } },
        targetUser: { select: { id: true, displayName: true } },
      },
    });

    // Enrich users with INTERNAL site avatars.
    // Frontend expects local sprites like /people/u001.png (NOT Steam URLs).
    const playerKeyToPeopleUrl = (playerKeyRaw: unknown): string | null => {
      const k = typeof playerKeyRaw === 'string' ? playerKeyRaw.trim() : '';
      if (!k) return null;
      return `/people/${encodeURIComponent(k)}.png`;
    };

    // Map userId -> playerKey using current map payload + aoe_players claims.
    // This is needed because userId is CUID (no numeric uXXX derivation).
    let userIdToPlayerKey = new Map<string, string>();
    // playerKey -> displayName (from map payload)
    let playerKeyToName = new Map<string, string>();
    try {
      const payload = await this.mapService.getMapPayload('default');
      const players = ((payload as any)?.players ?? {}) as Record<string, any>;

      const aoeProfileIds: string[] = [];
      const playerKeyByProfileId = new Map<string, string>();

      for (const [playerKey, rec] of Object.entries(players)) {
        const aoe = String((rec as any)?.aoeProfileId ?? (rec as any)?.insightsUserId ?? '').trim();
        if (aoe) {
          aoeProfileIds.push(aoe);
          if (!playerKeyByProfileId.has(aoe)) playerKeyByProfileId.set(aoe, String(playerKey));
        }

        // store display name from map payload
        const mapName = (rec as any)?.name ?? (rec as any)?.nickname ?? null;
        if (mapName && !playerKeyToName.has(String(playerKey))) playerKeyToName.set(String(playerKey), String(mapName));

        // Fallback: if map payload already has explicit userId
        const uidRaw = (rec as any)?.userId ?? (rec as any)?.extraJson?.userId ?? (rec as any)?.extra?.userId ?? null;
        const uid = typeof uidRaw === 'string' ? uidRaw.trim() : '';
        if (uid && !userIdToPlayerKey.has(uid)) userIdToPlayerKey.set(uid, String(playerKey));
      }

      const unique = Array.from(new Set(aoeProfileIds.map((x) => String(x).trim()).filter(Boolean)));
      if (unique.length) {
        const rowsAoe = await prisma.aoePlayer.findMany({
          where: { aoeProfileId: { in: unique } },
          select: { aoeProfileId: true, claimedByUserId: true },
        });

        for (const r of rowsAoe) {
          const uid = r.claimedByUserId ? String(r.claimedByUserId).trim() : '';
          if (!uid) continue;
          const key = playerKeyByProfileId.get(String(r.aoeProfileId).trim());
          if (!key) continue;
          if (!userIdToPlayerKey.has(uid)) userIdToPlayerKey.set(uid, key);
        }
      }
    } catch {
      // ignore mapping failures; we'll fall back to null avatarUrl
    }

    // Load PlayerProfile data for any playerKeys we can resolve.
    const keys = Array.from(
      new Set(
        rows
          .flatMap((ch: any) => [
            typeof ch?.challengerPlayerKey === 'string' ? ch.challengerPlayerKey.trim() : '',
            typeof ch?.targetPlayerKey === 'string' ? ch.targetPlayerKey.trim() : '',
          ])
          .filter(Boolean)
      )
    ).slice(0, 800);

    const profiles = keys.length
      ? await prisma.playerProfile.findMany({
          where: { playerKey: { in: keys } },
          select: { playerKey: true, ratingPoints: true, displayName: true, claimedByUserId: true },
        })
      : [];

    const profileByKey = new Map(profiles.map((p: any) => [String(p.playerKey).trim(), p] as const));

    return rows.map((ch: any) => {
      const challengerKey =
        typeof ch?.challengerPlayerKey === 'string' && ch.challengerPlayerKey.trim()
          ? ch.challengerPlayerKey.trim()
          : userIdToPlayerKey.get(String(ch?.challengerUser?.id ?? ch?.challengerUserId ?? '').trim()) ?? null;

      const targetKey =
        typeof ch?.targetPlayerKey === 'string' && ch.targetPlayerKey.trim()
          ? ch.targetPlayerKey.trim()
          : userIdToPlayerKey.get(String(ch?.targetUser?.id ?? ch?.targetUserId ?? '').trim()) ?? null;

      const challengerAvatar = playerKeyToPeopleUrl(challengerKey);
      const targetAvatar = playerKeyToPeopleUrl(targetKey);

      const challengerProfile = challengerKey ? profileByKey.get(challengerKey) ?? null : null;
      const targetProfile = targetKey ? profileByKey.get(targetKey) ?? null : null;

      const challengerDisplayName =
        (challengerProfile?.displayName ? String(challengerProfile.displayName).trim() : '') ||
        (challengerKey ? playerKeyToName.get(challengerKey) ?? String(challengerKey) : null);

      const targetDisplayName =
        (targetProfile?.displayName ? String(targetProfile.displayName).trim() : '') ||
        (targetKey ? playerKeyToName.get(targetKey) ?? String(targetKey) : null);

      // Build minimal user objects when original relation is null but we have a playerKey
      const challengerUserObj = ch.challengerUser
        ? { ...ch.challengerUser, avatarUrl: challengerAvatar }
        : challengerKey
          ? { id: null, displayName: challengerDisplayName, avatarUrl: challengerAvatar }
          : null;

      const targetUserObj = ch.targetUser
        ? { ...ch.targetUser, avatarUrl: targetAvatar }
        : targetKey
          ? { id: null, displayName: targetDisplayName, avatarUrl: targetAvatar }
          : null;

      return {
        ...ch,
        challengerUser: challengerUserObj,
        targetUser: targetUserObj,
        // Also expose best-effort keys for frontend history rendering.
        challengerPlayerKey: challengerKey ?? ch?.challengerPlayerKey ?? null,
        targetPlayerKey: targetKey ?? ch?.targetPlayerKey ?? null,
        // OR-identity: expose profile-based rating/claim info for UI cards.
        challengerProfile: challengerKey
          ? {
              playerKey: challengerKey,
              displayName: challengerDisplayName,
              avatarUrl: challengerAvatar,
              ratingPoints: typeof challengerProfile?.ratingPoints === 'number' ? challengerProfile.ratingPoints : 0,
              claimedByUserId: challengerProfile?.claimedByUserId ? String(challengerProfile.claimedByUserId).trim() : null,
            }
          : null,
        targetProfile: targetKey
          ? {
              playerKey: targetKey,
              displayName: targetDisplayName,
              avatarUrl: targetAvatar,
              ratingPoints: typeof targetProfile?.ratingPoints === 'number' ? targetProfile.ratingPoints : 0,
              claimedByUserId: targetProfile?.claimedByUserId ? String(targetProfile.claimedByUserId).trim() : null,
            }
          : null,
      };
    });
  }

  async resolveChallenge(params: { challengeId: string; adminUserId: string; result: ChallengeResult; notes?: string | null }, now = new Date()) {
    const { challengeId, adminUserId, result, notes } = params;

    const debug = String(process.env.DEBUG_CHALLENGES || '').trim() === '1';

    return prisma.$transaction(async (tx) => {
      // expiry inside tx (simple / safe)
      const challenge = await tx.userChallenge.findUnique({ where: { id: challengeId } });
      if (!challenge) throw new HttpError(404, 'NOT_FOUND', 'Challenge not found');

      const oldStatus = String(challenge.status);

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

      const ratingAppliedAtBefore = challenge.ratingAppliedAt ? new Date(challenge.ratingAppliedAt) : null;

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
          ...({
            winnerPlayerKey: winnerPlayerKey || null,
            loserPlayerKey: loserPlayerKey || null,
          } as any),
          notes: typeof notes === 'string' ? notes : undefined,
        } as any,
      });

      // 2) Apply rating via a single idempotent helper
      const applyRes = await this.applyRatingIfNeeded(tx, { challengeId, now, debug });

      const ratingAppliedAtAfter = applyRes.ratingAppliedAtAfter;

      // TEMP debug log (required by task)
      if (debug) {
        console.log('[challenge][finalize]', {
          challengeId,
          oldStatus,
          newStatus: 'COMPLETED',
          result,
          ratingAppliedAtBefore: ratingAppliedAtBefore ? ratingAppliedAtBefore.toISOString() : null,
          applyRatingCalled: true,
          applyRatingApplied: applyRes.applied,
          applyRatingReason: applyRes.reason,
          ratingAppliedAtAfter: ratingAppliedAtAfter ? ratingAppliedAtAfter.toISOString() : null,
        });
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

  /**
   * DANGEROUS: permanently deletes ALL challenge history from DB.
   * Admin-only operation.
   */
  async adminPurgeAllChallenges() {
    return prisma.$transaction(async (tx) => {
      // Delete dependent rating events first (FK safety).
      // Prisma schema doesn't specify cascade here, so do it explicitly.
      const userRatingEventsDeleted = await (tx as any).userRatingEvent.deleteMany({
        where: { challengeId: { not: null } },
      });

      const playerRatingEventsDeleted = await (tx as any).playerRatingEvent.deleteMany({
        where: { challengeId: { not: null } },
      });

      const challengesDeleted = await tx.userChallenge.deleteMany({});

      return {
        challengesDeleted: challengesDeleted.count ?? 0,
        userRatingEventsDeleted: userRatingEventsDeleted.count ?? 0,
        playerRatingEventsDeleted: playerRatingEventsDeleted.count ?? 0,
      };
    });
  }

  /**
   * Permanently deletes selected challenges by id.
   * Admin-only operation.
   */
  async adminDeleteChallengesByIds(ids: string[]) {
    const uniq = Array.from(new Set((ids ?? []).map((x) => String(x || '').trim()).filter(Boolean)));
    if (uniq.length === 0) {
      return { challengesDeleted: 0, userRatingEventsDeleted: 0, playerRatingEventsDeleted: 0 };
    }

    return prisma.$transaction(async (tx) => {
      const userRatingEventsDeleted = await (tx as any).userRatingEvent.deleteMany({
        where: { challengeId: { in: uniq } },
      });

      const playerRatingEventsDeleted = await (tx as any).playerRatingEvent.deleteMany({
        where: { challengeId: { in: uniq } },
      });

      const challengesDeleted = await tx.userChallenge.deleteMany({
        where: { id: { in: uniq } },
      });

      return {
        challengesDeleted: challengesDeleted.count ?? 0,
        userRatingEventsDeleted: userRatingEventsDeleted.count ?? 0,
        playerRatingEventsDeleted: playerRatingEventsDeleted.count ?? 0,
      };
    });
  }

  /**
   * Backfill utility: apply rating for a single challenge id.
   *
   * This is intentionally exposed as a public method so scripts/admin utilities
   * can reuse the same idempotent logic.
   */
  async backfillApplyRatingForChallenge(challengeId: string, now = new Date()) {
    const debug = String(process.env.DEBUG_CHALLENGES || '').trim() === '1';

    return prisma.$transaction(async (tx) => {
      return this.applyRatingIfNeeded(tx, { challengeId, now, debug });
    });
  }
}
