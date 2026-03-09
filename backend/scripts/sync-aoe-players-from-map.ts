import { MapService } from '../src/services/mapService';
import { AoePlayerDirectorySyncService } from '../src/services/aoePlayerDirectorySyncService';

async function main() {
  const slug = process.argv[2] || 'default';
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : 200;

  const map = new MapService();
  const payload = await map.getMapPayload(slug);
  const players = payload?.players ?? {};

  const ids = Object.values(players)
    .map((p: any) => String(p?.aoeProfileId ?? p?.insightsUserId ?? '').trim())
    .filter(Boolean);

  const unique = Array.from(new Set(ids)).slice(0, Math.max(1, Math.min(limit, 1000)));

  // eslint-disable-next-line no-console
  console.log(`[sync] mapSlug=${slug} candidates=${unique.length}`);

  const sync = new AoePlayerDirectorySyncService();
  const { summary, results } = await sync.syncManyByAoeProfileIds(unique, { concurrency: 2 });

  // eslint-disable-next-line no-console
  console.log('[sync] summary', summary);

  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    // eslint-disable-next-line no-console
    console.log('[sync] failed ids', failed.map((f) => ({ aoeProfileId: (f as any).aoeProfileId, reason: (f as any).reason })).slice(0, 30));
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('sync failed', e);
  process.exitCode = 1;
});
