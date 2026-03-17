import { prisma } from '../src/db/prisma';

async function rebuildPlayerProfileRatings() {
  console.log('[rebuild-ratings] Rebuilding player_profiles.rating_points from player_rating_events...');

  // Aggregate deltas per playerKey using raw SQL
  const rows: Array<{ playerkey: string; sum: number }> = await prisma.$queryRaw`
    SELECT pr.player_key as playerkey, COALESCE(SUM(prr.delta),0) as sum
    FROM player_profiles pr
    LEFT JOIN player_rating_events prr ON pr.player_key = prr.player_key
    GROUP BY pr.player_key
  `;

  console.log('[rebuild-ratings] Found', rows.length, 'player profile rows');

  let updated = 0;
  for (const r of rows) {
    const key = String(r.playerkey);
    const sum = Number(r.sum) || 0;
    try {
      await prisma.$executeRaw`
        UPDATE player_profiles
        SET rating_points = ${sum}
        WHERE player_key = ${key}
      `;
      updated++;
    } catch (e) {
      console.warn('[rebuild-ratings] failed to update player_profile', { key, sum, reason: (e as any)?.message ?? e });
    }
  }

  console.log('[rebuild-ratings] player_profiles processed:', updated);
}

async function rebuildUserRatings() {
  console.log('[rebuild-ratings] Rebuilding users.rating_points from user_rating_events...');

  const rows: Array<{ userid: string; sum: number }> = await prisma.$queryRaw`
    SELECT u.id as userid, COALESCE(SUM(ure.delta),0) as sum
    FROM users u
    LEFT JOIN user_rating_events ure ON u.id = ure.user_id
    GROUP BY u.id
  `;

  console.log('[rebuild-ratings] Found', rows.length, 'user rows');

  let updated = 0;
  for (const r of rows) {
    const uid = String(r.userid);
    const sum = Number(r.sum) || 0;
    try {
      await prisma.$executeRaw`
        UPDATE users
        SET rating_points = ${sum}
        WHERE id = ${uid}
      `;
      updated++;
    } catch (e) {
      console.warn('[rebuild-ratings] failed to update user', { uid, sum, reason: (e as any)?.message ?? e });
    }
  }

  console.log('[rebuild-ratings] users processed:', updated);
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
