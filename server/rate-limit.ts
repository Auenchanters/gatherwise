/**
 * Request quotas: 10 plan requests a minute per client, and a daily budget of model calls for the
 * whole deployment (300 by default, `AI_DAILY_LIMIT` to change it).
 * Does: count in a shared Upstash Redis store through its REST `pipeline` endpoint when one is
 * configured (one `INCR` plus `EXPIRE` per check, with a 1-second timeout), so every instance sees
 * the same counts. Without a store, or when it errors, times out or answers in a shape it should
 * not, the check falls back to counters in this instance's memory (also 60 requests a minute for
 * the whole instance) and logs `limiter_fallback`: the store can slow a request by its timeout at
 * most, and never fails one. Clients are named by a SHA-256 of their first forwarded address.
 * Never does: store or log a raw IP address, retry the store, or log its token.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AppError } from './errors.js';
import { logEvent } from './log.js';

const WINDOW_MS = 60_000;
const DAY_MS = 86_400_000;
const MAX_PER_CLIENT = 10;
const MAX_PER_INSTANCE = 60;
/** The daily budget of model calls when `AI_DAILY_LIMIT` is not set. */
export const DEFAULT_DAILY_LIMIT = 300;
const STORE_TIMEOUT_MS = 1000;
const KEY_PREFIX = 'gatherwise:';
/** Keys outlive their window by a margin, then the store drops them. */
const CLIENT_KEY_TTL_S = 120;
const DAY_KEY_TTL_S = 2 * 86_400;

/** The quota checks the handler runs; each throws a catalogued `AppError` when a quota is spent. */
export interface Limits {
  /** Counts one plan request from `client` at `now` (ms); throws `RATE_LIMITED`. */
  readonly request: (client: string, now: number) => Promise<void>;
  /**
   * Counts one model call against the budget of the UTC day of `now`; throws `AI_BUSY` with a
   * `Retry-After` of the seconds until UTC midnight.
   */
  readonly aiCall: (now: number) => Promise<void>;
}

/**
 * The quota key for a request: a hex SHA-256 of the first `x-vercel-forwarded-for` address
 * (set by Vercel's edge, not by the client), or `local` when there is none.
 */
export function clientId(request: Request): string {
  const ip = request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim();
  return ip ? createHash('sha256').update(ip).digest('hex') : 'local';
}

/** The UTC day of `now`, as `YYYY-MM-DD`. */
const utcDay = (now: number): string => new Date(now).toISOString().slice(0, 10);

/** `AI_BUSY` for a spent daily budget, telling the caller to come back at UTC midnight. */
function budgetSpent(now: number): AppError {
  const midnight = (Math.floor(now / DAY_MS) + 1) * DAY_MS;
  return new AppError('AI_BUSY', { retryAfter: Math.ceil((midnight - now) / 1000) });
}

/** Counters in this instance's memory: the fallback, and the only limits without a store. */
export function createMemoryLimits(dailyLimit = DEFAULT_DAILY_LIMIT): Limits {
  const clients = new Map<string, { count: number; expires: number }>();
  let instance = { count: 0, expires: 0 };
  let day = { name: '', count: 0 };
  return {
    request: (client, now) => {
      // Expired buckets are dropped on every call, so memory stays bounded.
      for (const [key, bucket] of clients) if (bucket.expires <= now) clients.delete(key);
      if (instance.expires <= now) instance = { count: 0, expires: now + WINDOW_MS };
      const bucket = clients.get(client) ?? { count: 0, expires: now + WINDOW_MS };
      if (bucket.count >= MAX_PER_CLIENT || instance.count >= MAX_PER_INSTANCE)
        return Promise.reject(new AppError('RATE_LIMITED'));
      bucket.count += 1;
      instance.count += 1;
      clients.set(client, bucket);
      return Promise.resolve();
    },
    aiCall: (now) => {
      const name = utcDay(now);
      if (day.name !== name) day = { name, count: 0 };
      if (day.count >= dailyLimit) return Promise.reject(budgetSpent(now));
      day.count += 1;
      return Promise.resolve();
    },
  };
}

/** Where the shared store is and how to reach it. */
export interface StoreOptions {
  /** The Upstash REST URL, such as `https://example.upstash.io`. */
  readonly url: string;
  readonly token: string;
  readonly dailyLimit?: number;
  /** Used when the store fails; by default a fresh in-memory set with the same daily limit. */
  readonly fallback?: Limits;
  /** The transport; injected by tests. */
  readonly fetchImpl?: typeof fetch;
  /** How long to wait for the store. Default 1000 ms. */
  readonly timeoutMs?: number;
}

/** A pipeline of `INCR` then `EXPIRE` answers with the new count first. */
const pipelineReply = z.tuple([
  z.object({ result: z.int().min(1) }),
  z.object({ result: z.int() }),
]);

/** Counters shared by every instance through an Upstash Redis store, with memory as the fallback. */
export function createSharedLimits(options: StoreOptions): Limits {
  const {
    token,
    dailyLimit = DEFAULT_DAILY_LIMIT,
    fallback = createMemoryLimits(dailyLimit),
    fetchImpl = fetch,
    timeoutMs = STORE_TIMEOUT_MS,
  } = options;
  const endpoint = `${options.url.replace(/\/+$/u, '')}/pipeline`;

  /** Adds one to `key` and returns the new count, or undefined (logged) when the store failed. */
  async function counted(key: string, ttlSeconds: number): Promise<number | undefined> {
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify([
          ['INCR', key],
          ['EXPIRE', key, ttlSeconds],
        ]),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error('store refused');
      const [{ result }] = pipelineReply.parse(await response.json());
      return result;
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      logEvent({ event: 'limiter_fallback', reason: timedOut ? 'timeout' : 'error' });
      return undefined;
    }
  }

  return {
    request: async (client, now) => {
      const window = Math.floor(now / WINDOW_MS);
      const count = await counted(`${KEY_PREFIX}rate:${client}:${window}`, CLIENT_KEY_TTL_S);
      if (count === undefined) return fallback.request(client, now);
      if (count > MAX_PER_CLIENT) throw new AppError('RATE_LIMITED');
    },
    aiCall: async (now) => {
      const count = await counted(`${KEY_PREFIX}ai-calls:${utcDay(now)}`, DAY_KEY_TTL_S);
      if (count === undefined) return fallback.aiCall(now);
      if (count > dailyLimit) throw budgetSpent(now);
    },
  };
}
