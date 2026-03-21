import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  RATE_LIMIT_METADATA_KEY,
  RateLimitOptions,
} from './rate-limit.decorator';

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly windows = new Map<string, number[]>();

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const options =
      this.reflector.getAllAndOverride<RateLimitOptions>(
        RATE_LIMIT_METADATA_KEY,
        [context.getHandler(), context.getClass()],
      );

    if (!options || context.getType<'http'>() !== 'http') {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      ip?: string;
      headers?: Record<string, string | string[] | undefined>;
      socket?: { remoteAddress?: string };
      user?: { userId?: number };
    }>();
    const key = this.buildKey(request, options);
    const now = Date.now();
    const cutoff = now - options.windowMs;
    const activeWindow = (this.windows.get(key) ?? []).filter(
      (timestamp) => timestamp > cutoff,
    );

    if (activeWindow.length >= options.limit) {
      throw new HttpException('Rate limit exceeded', HttpStatus.TOO_MANY_REQUESTS);
    }

    activeWindow.push(now);
    this.windows.set(key, activeWindow);
    return true;
  }

  private buildKey(
    request: {
      ip?: string;
      headers?: Record<string, string | string[] | undefined>;
      socket?: { remoteAddress?: string };
      user?: { userId?: number };
    },
    options: RateLimitOptions,
  ) {
    if (options.key === 'user' && request.user?.userId) {
      return `user:${request.user.userId}`;
    }

    const forwardedFor = request.headers?.['x-forwarded-for'];
    const forwardedIp = Array.isArray(forwardedFor)
      ? forwardedFor[0]
      : forwardedFor?.split(',')[0];
    const ip =
      forwardedIp?.trim() ||
      request.ip ||
      request.socket?.remoteAddress ||
      'unknown';

    return `ip:${ip}`;
  }
}
