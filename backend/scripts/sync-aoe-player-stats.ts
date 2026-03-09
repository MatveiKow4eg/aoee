import { prisma } from '../src/db/prisma';
import { AoePlayerStatsSyncService } from '../src/services/aoePlayerStatsSyncService';

async function main() {
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : 50;
  const onlyClaimed = process.argv.includes('--claimed');

  const players = await prisma.aoePlayer.findMany({
    where: onlyClaimed ? { NOT: { claimedByUserId: null } } : undefined,
    take: Math.max(1, Math.min(500, limit)),
    orderBy: { updatedAt: 'desc' },
    select: { aoeProfileId: true },
  });

  const ids = players.map((p) => p.aoeProfileId);

  // eslint-disable-next-line no-console
  console.log(`[sync-stats] players=${ids.length} claimedOnly=${onlyClaimed}`);

  const sync = new AoePlayerStatsSyncService();
  const { summary, results } = await sync.syncManyByAoeProfileIds(ids, { concurrency: 2 });

  // eslint-disable-next-line no-console
  console.log('[sync-stats] summary', summary);

  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    // eslint-disable-next-line no-console
    console.log('[sync-stats] failed', failed.slice(0, 30));
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('sync-stats failed', e);
  process.exitCode = 1;
});
