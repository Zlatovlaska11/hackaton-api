import 'dotenv/config';
import { Behavior, PrismaClient } from '@prisma/client';
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
    update: {
      petType: 'tree',
      petName: 'Sprout',
    },
    create: {
      username: 'john',
      password: johnPassword,
      petType: 'tree',
      petName: 'Sprout',
    },
  });

  const mariaPassword = await bcrypt.hash('guesswho', 10);
  const maria = await prisma.users.upsert({
    where: { username: 'maria' },
    update: {
      petType: 'water',
      petName: 'Pearl',
    },
    create: {
      username: 'maria',
      password: mariaPassword,
      petType: 'water',
      petName: 'Pearl',
    },
  });

  if (!(await prisma.pokemon.findFirst({ where: { userId: john.userId } }))) {
    await prisma.pokemon.create({
      data: {
        userId: john.userId,
        name: 'Sprout',
        behavior: Behavior.Tree,
      },
    });
  }

  if (!(await prisma.pokemon.findFirst({ where: { userId: maria.userId } }))) {
    await prisma.pokemon.create({
      data: {
        userId: maria.userId,
        name: 'Pearl',
        behavior: Behavior.Water,
      },
    });
  }

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
