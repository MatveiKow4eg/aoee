import { prisma } from '../src/db/prisma';

async function rebuildPlayerProfileRatings() {
  console.log('[rebuild-ratings] Rebuilding player_profiles.rating_points from player_rating_events...');

  // Aggregate deltas per playerKey
  const rows = await (prisma as any).$queryRawUnsafe(`
    SELECT pr.player_key as "playerKey", COALESCE(SUM(prr.delta),0) as "sum"
    FROM player_profiles pr
    LEFT JOIN player_rating_events prr ON pr.player_key = prr.player_key
    GROUP BY pr.player_key
  `);

  console.log('[rebuild-ratings] Found', rows.length, 'player profile rows');

  let updated = 0;
  for (const r of rows) {
    const key = String(r.playerKey);
    const sum = Number(r.sum) || 0;
    const cur = await prisma.playerProfile.findUnique({ where: { playerKey: key }, select: { ratingPoints: true } });
    if (!cur) continue;
    if ((cur.ratingPoints ?? 0) !== sum) {
      await prisma.playerProfile.update({ where: { playerKey: key }, data: { ratingPoints: sum } });
      updated++;
    }
  }

  console.log('[rebuild-ratings] player_profiles updated:', updated);
}

async function rebuildUserRatings() {
  console.log('[rebuild-ratings] Rebuilding users.rating_points from user_rating_events...');

  const rows = await (prisma as any).$queryRawUnsafe(`
    SELECT u.id as "userId", COALESCE(SUM(ure.delta),0) as "sum"
    FROM users u
    LEFT JOIN user_rating_events ure ON u.id = ure.user_id
    GROUP BY u.id
  `);

  console.log('[rebuild-ratings] Found', rows.length, 'user rows');

  let updated = 0;
  for (const r of rows) {
    const uid = String(r.userId);
    const sum = Number(r.sum) || 0;
    const cur = await prisma.user.findUnique({ where: { id: uid }, select: { ratingPoints: true } });
    if (!cur) continue;
    if ((cur.ratingPoints ?? 0) !== sum) {
      await prisma.user.update({ where: { id: uid }, data: { ratingPoints: sum } });
      updated++;
    }
  }

  console.log('[rebuild-ratings] users updated:', updated);
}

async function main() {
  try {
    await rebuildPlayerProfileRatings();
    await rebuildUserRatings();
    console.log('[rebuild-ratings] Done.');
    process.exit(0);
  } catch (e) {
    console.error('[rebuild-ratings] Error:', e);
    process.exit(2);
  }
}

main();
