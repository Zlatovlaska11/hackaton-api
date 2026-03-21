import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const DEFAULT_PG_CONNECTION_TIMEOUT_MS = 10_000;
const DEFAULT_PG_QUERY_TIMEOUT_MS = 20_000;
const DEFAULT_PRISMA_TRANSACTION_MAX_WAIT_MS = 10_000;
const DEFAULT_PRISMA_TRANSACTION_TIMEOUT_MS = 20_000;

function parseTimeoutMs(
  value: string | undefined,
  fallback: number,
): number {
  const normalizedValue = value?.trim();

  if (!normalizedValue) {
    return fallback;
  }

  const parsedValue = Number(normalizedValue);

  return Number.isFinite(parsedValue) && parsedValue > 0
    ? Math.round(parsedValue)
    : fallback;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private pool: Pool;

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    const pool = new Pool({
      connectionString,
      connectionTimeoutMillis: parseTimeoutMs(
        process.env.PG_CONNECTION_TIMEOUT_MS,
        DEFAULT_PG_CONNECTION_TIMEOUT_MS,
      ),
      query_timeout: parseTimeoutMs(
        process.env.PG_QUERY_TIMEOUT_MS,
        DEFAULT_PG_QUERY_TIMEOUT_MS,
      ),
    });
    const adapter = new PrismaPg(pool as any);
    super({
      adapter,
      transactionOptions: {
        maxWait: parseTimeoutMs(
          process.env.PRISMA_TRANSACTION_MAX_WAIT_MS,
          DEFAULT_PRISMA_TRANSACTION_MAX_WAIT_MS,
        ),
        timeout: parseTimeoutMs(
          process.env.PRISMA_TRANSACTION_TIMEOUT_MS,
          DEFAULT_PRISMA_TRANSACTION_TIMEOUT_MS,
        ),
      },
    });
    this.pool = pool;
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
    await this.pool.end();
  }
}
