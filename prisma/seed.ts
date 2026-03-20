import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import * as bcrypt from 'bcrypt';

const connectionString = process.env.DATABASE_URL!;
const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool as any);
const prisma = new PrismaClient({ adapter });

async function main() {
  for (const code of ['city', 'water', 'tree']) {
    await prisma.petType.upsert({
      where: { code },
      update: {},
      create: { code },
    });
  }

  const johnPassword = await bcrypt.hash('changeme', 10);
  const john = await prisma.users.upsert({
    where: { username: 'john' },
    update: {},
    create: {
      username: 'john',
      password: johnPassword,
    },
  });

  const mariaPassword = await bcrypt.hash('guesswho', 10);
  const maria = await prisma.users.upsert({
    where: { username: 'maria' },
    update: {},
    create: {
      username: 'maria',
      password: mariaPassword,
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
