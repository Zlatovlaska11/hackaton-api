import { SetMetadata } from '@nestjs/common';

export type RateLimitOptions = {
  key?: 'ip' | 'user';
  limit: number;
  windowMs: number;
};

export const RATE_LIMIT_METADATA_KEY = 'rateLimit';

export const RateLimit = (options: RateLimitOptions) =>
  SetMetadata(RATE_LIMIT_METADATA_KEY, options);
