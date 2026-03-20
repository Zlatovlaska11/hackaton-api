import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const connectionString = process.env.DATABASE_URL!;
const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool as any);
const prisma = new PrismaClient({ adapter });

async function main() {
  const john = await prisma.user.upsert({
    where: { username: 'john' },
    update: {},
    create: {
      username: 'john',
      password: 'changeme',
    },
  });

  const maria = await prisma.user.upsert({
    where: { username: 'maria' },
    update: {},
    create: {
      username: 'maria',
      password: 'guesswho',
    },
  });

  console.log({ john, maria });
}

main()
  .then(async () => {
    await prisma.$disconnect();
    await pool.end();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    await pool.end();
    process.exit(1);
  });
