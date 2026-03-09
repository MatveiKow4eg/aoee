import { prisma } from '../src/db/prisma';

/**
 * Stage 7: Map payload identity coverage audit.
 *
 * What it measures (for each map slug):
 * - total map player rows
 * - players where extraJson.aoeProfileId exists (canonical)
 * - players where extraJson.insightsUserId exists (legacy)
 * - with both
 * - with neither
 *
 * Notes:
 * - `insightsUserId` historically lived only inside JSON payload.
 * - current write-path should persist identity back as `extraJson.aoeProfileId`.
 */

type Counters = {
  total: number;
  withAoeProfileId: number;
  withInsightsUserId: number;
  withBoth: number;
  withNeither: number;
};

function asStringOrNull(v: any): string | null {
  if (v == null) return null;
  const s = typeof v === 'string' ? v : String(v);
  const t = s.trim();
  return t ? t : null;
}

function initCounters(): Counters {
  return { total: 0, withAoeProfileId: 0, withInsightsUserId: 0, withBoth: 0, withNeither: 0 };
}

async function auditSlug(slug: string) {
  const state = await prisma.mapState.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      updatedAt: true,
      players: { select: { playerKey: true, extraJson: true } },
    },
  });

  if (!state) {
    console.log(JSON.stringify({ slug, ok: false, error: 'MAP_NOT_FOUND' }));
    return;
  }

  const c = initCounters();
  const examples: {
    onlyInsights: Array<{ playerKey: string; insightsUserId: string }>;
    neither: Array<{ playerKey: string }>;
    bothMismatch: Array<{ playerKey: string; aoeProfileId: string; insightsUserId: string }>;
  } = { onlyInsights: [], neither: [], bothMismatch: [] };

  for (const p of state.players) {
    c.total++;
    const extra = p.extraJson as any;
    const aoeProfileId = asStringOrNull(extra?.aoeProfileId);
    const insightsUserId = asStringOrNull(extra?.insightsUserId);

    const hasAoe = !!aoeProfileId;
    const hasInsights = !!insightsUserId;

    if (hasAoe) c.withAoeProfileId++;
    if (hasInsights) c.withInsightsUserId++;
    if (hasAoe && hasInsights) {
      c.withBoth++;
      if (aoeProfileId !== insightsUserId && examples.bothMismatch.length < 20) {
        examples.bothMismatch.push({ playerKey: p.playerKey, aoeProfileId: aoeProfileId!, insightsUserId: insightsUserId! });
      }
    }
    if (!hasAoe && !hasInsights) {
      c.withNeither++;
      if (examples.neither.length < 20) examples.neither.push({ playerKey: p.playerKey });
    }
    if (!hasAoe && hasInsights) {
      if (examples.onlyInsights.length < 20) examples.onlyInsights.push({ playerKey: p.playerKey, insightsUserId: insightsUserId! });
    }
  }

  const pct = (n: number) => (c.total ? Math.round((n / c.total) * 1000) / 10 : 0);

  console.log(
    JSON.stringify(
      {
        ok: true,
        slug: state.slug,
        updatedAt: state.updatedAt,
        counters: c,
        percents: {
          withAoeProfileId: pct(c.withAoeProfileId),
          withInsightsUserId: pct(c.withInsightsUserId),
          withBoth: pct(c.withBoth),
          withNeither: pct(c.withNeither),
        },
        examples,
      },
      null,
      2,
    ),
  );
}

async function main() {
  const slug = process.argv[2];

  if (slug) {
    await auditSlug(slug);
    return;
  }

  const states = await prisma.mapState.findMany({ select: { slug: true }, orderBy: { updatedAt: 'desc' } });
  const slugs = states.map((s) => s.slug);
  if (slugs.length === 0) {
    console.log(JSON.stringify({ ok: false, error: 'NO_MAP_STATES' }));
    return;
  }

  for (const s of slugs) {
    await auditSlug(s);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
