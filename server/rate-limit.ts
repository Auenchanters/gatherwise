/**
 * Per-instance request quotas: 10 a minute per client and 60 a minute for the whole instance.
 * Does: name each client by a SHA-256 of its first forwarded address, count requests in a fixed
 * one-minute window and drop expired buckets on every call so memory stays bounded.
 * Never does: store or log a raw IP address, or coordinate across instances; each warm instance
 * counts alone, so the real ceiling scales with the number of instances (documented as such).
 */
import { createHash } from 'node:crypto';
import { AppError } from './errors.js';

const WINDOW_MS = 60_000;
const MAX_PER_CLIENT = 10;
const MAX_PER_INSTANCE = 60;

/** Counts one request from `client` at time `now` (ms), or throws `RATE_LIMITED`. */
export type RateLimiter = (client: string, now: number) => void;

/**
 * The quota key for a request: a hex SHA-256 of the first `x-vercel-forwarded-for` address
 * (set by Vercel's edge, not by the client), or `local` when there is none.
 */
export function clientId(request: Request): string {
  const ip = request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim();
  return ip ? createHash('sha256').update(ip).digest('hex') : 'local';
}

/** A fresh limiter with its own counters. */
export function createRateLimiter(): RateLimiter {
  const clients = new Map<string, { count: number; expires: number }>();
  let instance = { count: 0, expires: 0 };
  return (client, now) => {
    for (const [key, bucket] of clients) if (bucket.expires <= now) clients.delete(key);
    if (instance.expires <= now) instance = { count: 0, expires: now + WINDOW_MS };
    const bucket = clients.get(client) ?? { count: 0, expires: now + WINDOW_MS };
    if (bucket.count >= MAX_PER_CLIENT || instance.count >= MAX_PER_INSTANCE)
      throw new AppError('RATE_LIMITED');
    bucket.count += 1;
    instance.count += 1;
    clients.set(client, bucket);
  };
}
