import 'dotenv/config';

/**
 * STEP 5
 * Import Firestore document `maps/default` into PostgreSQL via Prisma.
 *
 * Why this script exists:
 * - one-time migration tool
 * - safe by default (supports --dry-run)
 * - does NOT delete/overwrite existing DB data unless --force is provided
 */

import { prisma } from '../src/db/prisma';

type FirestoreMapDocV1 = {
  version: number;
  updatedAt?: unknown;
  payload: {
    world: {
      w: number;
      h: number;
      mapTextureVersion?: number;
    };
    buildings: Record<
      string,
      {
        x: number;
        y: number;
        zone?: any;
        scale?: number;
        rotation?: number;
        proj?: [number, number, number, number];
      }
    >;
    players: Record<
      string,
      {
        x?: number;
        y?: number;
        tier?: string | number;
        name?: string;
        title?: string;
        desc?: string;
        [k: string]: unknown;
      }
    >;
    meta?: unknown;
  };
};

function parseArgs(argv: string[]) {
  const dryRun = argv.includes('--dry-run');
  const force = argv.includes('--force');
  const slugArgIdx = argv.findIndex((a) => a === '--slug');
  const slug = slugArgIdx >= 0 ? argv[slugArgIdx + 1] : 'default';

  const projectIdIdx = argv.findIndex((a) => a === '--project-id');
  const projectId = projectIdIdx >= 0 ? argv[projectIdIdx + 1] : process.env.FIREBASE_PROJECT_ID;

  const credentialsIdx = argv.findIndex((a) => a === '--credentials');
  const credentialsPath = credentialsIdx >= 0 ? argv[credentialsIdx + 1] : process.env.GOOGLE_APPLICATION_CREDENTIALS;

  return { dryRun, force, slug, projectId, credentialsPath };
}

function assertPresent(name: string, value?: string) {
  if (!value) throw new Error(`[import] Missing ${name}. Provide via CLI flag or env.`);
  return value;
}

function safeJson(value: unknown) {
  // Prisma Json accepts null / object / array / primitives.
  // We keep meta as-is; if it's undefined, store null.
  return value === undefined ? null : (value as any);
}

async function readFirestoreDoc(slug: string, projectId: string, credentialsPath: string): Promise<FirestoreMapDocV1> {
  // Dynamic import to avoid hard dependency unless user runs the script.
  const admin = await import('firebase-admin');

  if (admin.apps.length === 0) {
    admin.initializeApp({
      credential: admin.credential.cert(credentialsPath),
      projectId,
    } as any);
  }

  const db = admin.firestore();
  const ref = db.collection('maps').doc(slug);
  const snap = await ref.get();

  if (!snap.exists) {
    throw new Error(`[import] Firestore document maps/${slug} does not exist`);
  }

  const data = snap.data();
  if (!data) throw new Error('[import] Firestore returned empty data');

  // Normalize Firestore Timestamp to JS Date for logs if present.
  const updatedAt = (data as any).updatedAt;
  const normalizedUpdatedAt =
    updatedAt && typeof updatedAt === 'object' && typeof (updatedAt as any).toDate === 'function'
      ? (updatedAt as any).toDate()
      : updatedAt;

  return {
    ...(data as any),
    updatedAt: normalizedUpdatedAt,
  } as FirestoreMapDocV1;
}

async function main() {
  const { dryRun, force, slug, projectId, credentialsPath } = parseArgs(process.argv.slice(2));

  const pid = assertPresent('FIREBASE_PROJECT_ID/--project-id', projectId);
  const credPath = assertPresent('GOOGLE_APPLICATION_CREDENTIALS/--credentials', credentialsPath);

  console.log('[import] Starting import', { slug, dryRun, force, projectId: pid });

  const doc = await readFirestoreDoc(slug, pid, credPath);

  const buildings = doc.payload?.buildings ?? {};
  const players = doc.payload?.players ?? {};

  console.log('[import] Read Firestore maps/%s', slug);
  console.log('[import] version=%s updatedAt=%s', doc.version, (doc as any).updatedAt ?? null);
  console.log('[import] world=%j', doc.payload?.world);
  console.log('[import] buildings=%d players=%d', Object.keys(buildings).length, Object.keys(players).length);

  const existing = await prisma.mapState.findUnique({ where: { slug } });
  if (existing && !force) {
    throw new Error(
      `[import] MapState '${slug}' already exists in DB (id=${existing.id}). Refusing to overwrite without --force.`,
    );
  }

  const world = doc.payload.world;

  const mapStateCreate = {
    slug,
    version: doc.version ?? 1,
    worldW: world.w,
    worldH: world.h,
    mapTextureVersion: world.mapTextureVersion ?? 1,
    metaJson: safeJson(doc.payload.meta),
  };

  const buildingCreates = Object.entries(buildings).map(([buildingKey, b]) => {
    const zone = (b as any).zone;
    const proj = (b as any).proj;

    const zoneX = zone?.x ?? null;
    const zoneY = zone?.y ?? null;
    const zoneW = zone?.w ?? null;
    const zoneH = zone?.h ?? null;

    const proj0 = Array.isArray(proj) ? proj[0] ?? null : null;
    const proj1 = Array.isArray(proj) ? proj[1] ?? null : null;
    const proj2 = Array.isArray(proj) ? proj[2] ?? null : null;
    const proj3 = Array.isArray(proj) ? proj[3] ?? null : null;

    return {
      buildingKey,
      x: b.x,
      y: b.y,
      zoneX,
      zoneY,
      zoneW,
      zoneH,
      scale: b.scale ?? null,
      rotation: b.rotation ?? null,
      proj0,
      proj1,
      proj2,
      proj3,
    };
  });

  const playerCreates = Object.entries(players).map(([playerKey, p]) => {
    const { x, y, tier, name, title, desc, ...extra } = p ?? ({} as any);

    // If extra has no keys, store null to keep DB cleaner.
    const extraJson = Object.keys(extra).length ? safeJson(extra) : null;

    // DB schema uses tier as Int? (legacy choice). Firestore has tier as string in this project (e.g. "Замки").
    // We preserve it in extraJson as tierLabel and keep tier as null.
    const tierLabel = tier === undefined || tier === null || tier === '' ? null : String(tier);
    if (tierLabel) {
      (extra as any).tierLabel = tierLabel;
    }

    return {
      playerKey,
      x: x ?? null,
      y: y ?? null,
      tier: null,
      name: name ?? null,
      title: title ?? null,
      desc: desc ?? null,
      extraJson: Object.keys(extra).length ? safeJson(extra) : null,
    };
  });

  if (dryRun) {
    console.log('[import] DRY RUN - would write:');
    console.log('[import] mapState:', mapStateCreate);
    console.log('[import] mapBuildings:', buildingCreates.length);
    console.log('[import] mapPlayers:', playerCreates.length);
    return;
  }

  await prisma.$transaction(async (tx) => {
    if (existing && force) {
      // Clean old rows first to avoid unique conflicts; safe because user explicitly asked for overwrite.
      await tx.mapBuilding.deleteMany({ where: { mapStateId: existing.id } });
      await tx.mapPlayer.deleteMany({ where: { mapStateId: existing.id } });
      await tx.mapState.delete({ where: { id: existing.id } });
    }

    const createdState = await tx.mapState.create({ data: mapStateCreate });

    if (buildingCreates.length) {
      await tx.mapBuilding.createMany({
        data: buildingCreates.map((b) => ({ ...b, mapStateId: createdState.id })),
      });
    }

    if (playerCreates.length) {
      await tx.mapPlayer.createMany({
        data: playerCreates.map((p) => ({ ...p, mapStateId: createdState.id })),
      });
    }

    console.log('[import] Imported MapState id=%s', createdState.id);
  });

  console.log('[import] Done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
