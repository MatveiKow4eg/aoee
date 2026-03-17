import { prisma } from '../src/db/prisma';
import { ChallengeService } from '../src/services/challengeService';

/**
 * One-off backfill script.
 *
 * Finds COMPLETED challenges with:
 * - rating_applied_at IS NULL
 * - result in (CHALLENGER_WON, CHALLENGER_LOST)
 *
 * Backfill steps per challenge:
 * 1) If targetPlayerKey is missing, try to resolve it from targetUserId claim -> aoeProfileId -> map playerKey.
 * 2) If still missing, skip safely with a reason.
 * 3) If keys are present, apply rating via the same idempotent service logic.
 */
async function main() {
  const limit = Number(process.env.BACKFILL_LIMIT || 500);
  const dryRun = String(process.env.DRY_RUN || '').trim() === '1';

  console.log('[backfill-challenge-ratings] start', { limit, dryRun });

  const rows = await prisma.userChallenge.findMany({
    where: {
      status: 'COMPLETED',
      ratingAppliedAt: null,
      result: { in: ['CHALLENGER_WON', 'CHALLENGER_LOST'] },
    },
    select: {
      id: true,
      result: true,
      resolvedAt: true,
      ratingAppliedAt: true,
      challengerPlayerKey: true,
      targetPlayerKey: true,
      targetUserId: true,
      targetAoeProfileId: true,
    },
    orderBy: { resolvedAt: 'asc' },
    take: limit,
  });

  console.log('[backfill-challenge-ratings] candidates', { count: rows.length });

  const svc = new ChallengeService();

  let applied = 0;
  let skipped = 0;
  let keysBackfilled = 0;

  for (const r of rows) {
    const challengeId = String(r.id);

    const before = {
      challengerPlayerKey: r.challengerPlayerKey ? String(r.challengerPlayerKey).trim() : null,
      targetPlayerKey: r.targetPlayerKey ? String(r.targetPlayerKey).trim() : null,
    };

    if (dryRun) {
      console.log('[backfill-challenge-ratings] dry-run candidate', {
        challengeId,
        result: r.result,
        resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
        ...before,
        targetUserId: r.targetUserId,
        targetAoeProfileId: r.targetAoeProfileId,
      });
      skipped++;
      continue;
    }

    try {
      // Step 1: backfill missing targetPlayerKey if possible
      if (!before.targetPlayerKey) {
        const targetUserId = r.targetUserId ? String(r.targetUserId).trim() : '';
        const targetAoeProfileId = r.targetAoeProfileId ? String(r.targetAoeProfileId).trim() : '';

        let resolvedKey: string | null = null;
        let reason = 'NO_INPUTS';

        if (targetUserId) {
          const aoe = await prisma.aoePlayer.findFirst({
            where: { claimedByUserId: targetUserId },
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
                  resolvedKey = String(row.playerKey).trim();
                  reason = 'FROM_TARGET_USER_CLAIM';
                  break;
                }
              }
              if (!resolvedKey) reason = 'MAP_PLAYER_NOT_FOUND_BY_TARGET_USER_CLAIM';
            } else {
              reason = 'MAP_NOT_FOUND';
            }
          } else {
            reason = 'NO_CLAIMED_AOE_PROFILE';
          }
        }

        if (!resolvedKey && targetAoeProfileId) {
          const map = await prisma.mapState.findUnique({ where: { slug: 'default' }, select: { id: true } });
          if (map) {
            const all = await prisma.mapPlayer.findMany({
              where: { mapStateId: map.id },
              select: { playerKey: true, extraJson: true },
            });
            for (const row of all) {
              const extra = (row?.extraJson ?? {}) as any;
              const rowAoe = String((extra?.aoeProfileId ?? extra?.insightsUserId ?? '')).trim();
              if (rowAoe && rowAoe === targetAoeProfileId) {
                resolvedKey = String(row.playerKey).trim();
                reason = 'FROM_TARGET_AOE_PROFILE_ID';
                break;
              }
            }
            if (!resolvedKey && reason === 'NO_INPUTS') reason = 'MAP_PLAYER_NOT_FOUND_BY_TARGET_AOE_PROFILE_ID';
          } else {
            reason = 'MAP_NOT_FOUND';
          }
        }

        if (resolvedKey) {
          await prisma.userChallenge.update({
            where: { id: challengeId },
            data: { targetPlayerKey: resolvedKey },
          });
          keysBackfilled++;
          console.log('[backfill-challenge-ratings] backfilled targetPlayerKey', { challengeId, targetPlayerKey: resolvedKey, reason });
        } else {
          console.log('[backfill-challenge-ratings] skip (cannot backfill targetPlayerKey)', { challengeId, reason });
          skipped++;
          continue;
        }
      }

      // Step 2: apply rating (idempotent)
      const res = await svc.backfillApplyRatingForChallenge(challengeId, new Date());
      if (res.applied) applied++;
      else skipped++;

      console.log('[backfill-challenge-ratings] processed', {
        challengeId,
        applied: res.applied,
        reason: res.reason,
        ratingAppliedAtAfter: res.ratingAppliedAtAfter ? res.ratingAppliedAtAfter.toISOString() : null,
      });
    } catch (e: any) {
      skipped++;
      console.warn('[backfill-challenge-ratings] failed', {
        challengeId,
        reason: e?.message ? String(e.message) : 'unknown_error',
      });
    }
  }

  console.log('[backfill-challenge-ratings] done', { applied, skipped, keysBackfilled, total: rows.length });
  process.exit(0);
}

main().catch((e) => {
  console.error('[backfill-challenge-ratings] fatal', e);
  process.exit(2);
});
