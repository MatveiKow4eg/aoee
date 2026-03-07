import 'dotenv/config';
import { prisma } from '../src/db/prisma';

async function main() {
  const slug = 'default';

  const existing = await prisma.mapState.findUnique({ where: { slug } });
  if (existing) {
    console.log(`[seed] MapState '${slug}' already exists:`, existing.id);
    return;
  }

  const created = await prisma.mapState.create({
    data: {
      slug,
      version: 1,
      worldW: 3000,
      worldH: 1800,
      mapTextureVersion: 1,
      metaJson: {},
    },
  });

  console.log(`[seed] Created MapState '${slug}':`, created.id);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
