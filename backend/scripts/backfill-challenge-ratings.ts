import { prisma } from '../src/db/prisma';
import { ChallengeService } from '../src/services/challengeService';

/**
 * One-off backfill script.
 *
 * Finds COMPLETED challenges with:
 * - rating_applied_at IS NULL
 * - result in (CHALLENGER_WON, CHALLENGER_LOST)
 *
 * And attempts to apply rating via the same idempotent service logic.
 *
 * Safety:
 * - service checks ratingAppliedAt guard
 * - service checks status/result
 * - service will skip if player keys are missing
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
    },
    orderBy: { resolvedAt: 'asc' },
    take: limit,
  });

  console.log('[backfill-challenge-ratings] candidates', { count: rows.length });

  const svc = new ChallengeService();

  let applied = 0;
  let skipped = 0;

  for (const r of rows) {
    const challengeId = String(r.id);

    if (dryRun) {
      console.log('[backfill-challenge-ratings] dry-run candidate', {
        challengeId,
        result: r.result,
        resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
        challengerPlayerKey: r.challengerPlayerKey,
        targetPlayerKey: r.targetPlayerKey,
      });
      skipped++;
      continue;
    }

    try {
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

  console.log('[backfill-challenge-ratings] done', { applied, skipped, total: rows.length });
  process.exit(0);
}

main().catch((e) => {
  console.error('[backfill-challenge-ratings] fatal', e);
  process.exit(2);
});
