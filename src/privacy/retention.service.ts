import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_RETENTION_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_MESSAGE_RETENTION_DAYS = 90;
const DEFAULT_PENDING_REQUEST_RETENTION_DAYS = 30;
const DEFAULT_ROUTE_RETENTION_DAYS = 30;
const DEFAULT_PRESENCE_RETENTION_DAYS = 7;

function parsePositiveInteger(value: string | undefined, fallback: number) {
  const parsedValue = Number(value?.trim());

  return Number.isInteger(parsedValue) && parsedValue > 0
    ? parsedValue
    : fallback;
}

function subtractDays(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

@Injectable()
export class RetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RetentionService.name);
  private interval: NodeJS.Timeout | null = null;
  private readonly retentionIntervalMs = parsePositiveInteger(
    process.env.RETENTION_RUN_INTERVAL_MS,
    DEFAULT_RETENTION_INTERVAL_MS,
  );
  private readonly messageRetentionDays = parsePositiveInteger(
    process.env.MESSAGE_RETENTION_DAYS,
    DEFAULT_MESSAGE_RETENTION_DAYS,
  );
  private readonly pendingRequestRetentionDays = parsePositiveInteger(
    process.env.PENDING_FRIEND_REQUEST_RETENTION_DAYS,
    DEFAULT_PENDING_REQUEST_RETENTION_DAYS,
  );
  private readonly routeRetentionDays = parsePositiveInteger(
    process.env.ROUTE_RETENTION_DAYS,
    DEFAULT_ROUTE_RETENTION_DAYS,
  );
  private readonly presenceRetentionDays = parsePositiveInteger(
    process.env.PRESENCE_RETENTION_DAYS,
    DEFAULT_PRESENCE_RETENTION_DAYS,
  );

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.runRetentionPass();
    this.interval = setInterval(() => {
      void this.runRetentionPass();
    }, this.retentionIntervalMs);
    this.interval.unref?.();
  }

  onModuleDestroy() {
    if (this.interval) {
      clearInterval(this.interval);
    }
  }

  private async runRetentionPass() {
    try {
      await Promise.all([
        this.prisma.message.deleteMany({
          where: {
            createdAt: {
              lt: subtractDays(this.messageRetentionDays),
            },
          },
        }),
        this.prisma.friendRequest.deleteMany({
          where: {
            status: 'PENDING',
            createdAt: {
              lt: subtractDays(this.pendingRequestRetentionDays),
            },
          },
        }),
        this.prisma.route.deleteMany({
          where: {
            ended: true,
            endedAt: {
              lt: subtractDays(this.routeRetentionDays),
            },
          },
        }),
        this.prisma.users.updateMany({
          where: {
            lastSeenAt: {
              lt: subtractDays(this.presenceRetentionDays),
            },
          },
          data: {
            lastKnownLat: null,
            lastKnownLng: null,
            lastSeenAt: null,
          },
        }),
      ]);
    } catch (error) {
      this.logger.error(
        `Retention pass failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }
}
