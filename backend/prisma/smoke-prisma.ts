import 'dotenv/config';
import { prisma } from '../src/db/prisma';

async function main() {
  await prisma.$queryRaw`SELECT 1`;
  console.log('prisma: ok');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
