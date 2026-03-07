import { prisma } from '../src/db/prisma';
import fs from 'fs';
import path from 'path';

type SeedRec = {
  aoeProfileId: string;
  aoeProfileUrl: string;
  nickname: string;
};

function readJson(filePath: string): unknown {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

async function main() {
  const fileArg = process.argv.find((a) => a.startsWith('--file='));
  const file = fileArg ? fileArg.slice('--file='.length) : '';
  if (!file) {
    console.error('Usage: ts-node scripts/seed-aoe-players.ts --file=prisma/seed-aoe-players.json');
    process.exit(2);
  }

  const abs = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
  const data = readJson(abs);
  if (!Array.isArray(data)) {
    throw new Error('Seed file must be a JSON array');
  }

  let created = 0;
  let skipped = 0;

  for (const item of data) {
    const rec = item as Partial<SeedRec>;
    const aoeProfileId = String(rec.aoeProfileId ?? '').trim();
    const aoeProfileUrl = String(rec.aoeProfileUrl ?? '').trim();
    const nickname = String(rec.nickname ?? '').trim();

    if (!aoeProfileId || !aoeProfileUrl || !nickname) {
      console.warn('[seed] skip invalid record', item);
      skipped++;
      continue;
    }

    try {
      await prisma.aoePlayer.create({
        data: {
          aoeProfileId,
          aoeProfileUrl,
          nickname,
        },
      });
      created++;
    } catch (e: any) {
      // Unique constraint violation: already exists -> skip
      skipped++;
    }
  }

  console.log(JSON.stringify({ ok: true, created, skipped }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
