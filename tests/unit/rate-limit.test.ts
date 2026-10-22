/**
 * The quotas: the per-client window, the instance-wide cap and the daily budget in memory; the
 * shared Upstash store (counts, windows, the daily budget, and the fallback to memory on an error,
 * a bad reply or a timeout); the concurrency gate; and the hashed client identity.
 * Never calls the network: the store's `fetch` is injected.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { createInferenceGate } from '../../server/capacity.js';
import {
  clientId,
  createMemoryLimits,
  createSharedLimits,
  DEFAULT_DAILY_LIMIT,
  type Limits,
} from '../../server/rate-limit.js';

const post = (headers: Record<string, string> = {}) =>
  new Request('https://gatherwise.example/api/plan', { method: 'POST', headers });

/** 2026-10-21 at 10:00 UTC, 14 hours before UTC midnight. */
const NOW = Date.UTC(2026, 9, 21, 10);
const UNTIL_MIDNIGHT = 14 * 3600;

let warn: MockInstance<typeof console.warn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('createMemoryLimits', () => {
  it('allows ten requests per client per minute, then restores capacity when the window ends', async () => {
    const limits = createMemoryLimits();
    for (let i = 0; i < 10; i += 1) await limits.request('client', 1_000 + i);
    await expect(limits.request('client', 30_000)).rejects.toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
    });
    await expect(limits.request('other-client', 30_000)).resolves.toBeUndefined();
    await expect(limits.request('client', 61_000)).resolves.toBeUndefined();
  });

  it('caps the whole instance at sixty requests per minute across clients', async () => {
    const limits = createMemoryLimits();
    for (let i = 0; i < 60; i += 1) await limits.request(`client-${i}`, 0);
    await expect(limits.request('fresh-client', 1)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    await expect(limits.request('fresh-client', 60_000)).resolves.toBeUndefined();
  });

  it('allows the daily budget of model calls, then says when the UTC day ends', async () => {
    const limits = createMemoryLimits(3);
    for (let i = 0; i < 3; i += 1) await limits.aiCall(NOW + i);
    const spent = limits.aiCall(NOW);
    await expect(spent).rejects.toMatchObject({ status: 503, code: 'AI_BUSY' });
    await expect(spent).rejects.toHaveProperty('detail.retryAfter', UNTIL_MIDNIGHT);
    // A new UTC day starts a new budget.
    await expect(limits.aiCall(NOW + UNTIL_MIDNIGHT * 1000)).resolves.toBeUndefined();
  });

  it(`defaults to ${DEFAULT_DAILY_LIMIT} calls a day`, async () => {
    const limits = createMemoryLimits();
    for (let i = 0; i < DEFAULT_DAILY_LIMIT; i += 1) await limits.aiCall(NOW);
    await expect(limits.aiCall(NOW)).rejects.toMatchObject({ code: 'AI_BUSY' });
  });
});

describe('createSharedLimits', () => {
  /** A store that answers each pipeline with `count` for the INCR. */
  const storeAnswering = (count: () => number) =>
    vi.fn<typeof fetch>(() => Promise.resolve(Response.json([{ result: count() }, { result: 1 }])));
  /** In-memory limits whose calls the test can see. */
  const spyFallback = (): Limits & {
    request: MockInstance<Limits['request']>;
    aiCall: MockInstance<Limits['aiCall']>;
  } => {
    const memory = createMemoryLimits(1);
    return {
      request: vi.fn<Limits['request']>((client, now) => memory.request(client, now)),
      aiCall: vi.fn<Limits['aiCall']>((now) => memory.aiCall(now)),
    };
  };
  const shared = (fetchImpl: typeof fetch, fallback: Limits = spyFallback()) =>
    createSharedLimits({
      url: 'https://kv.example/',
      token: 'store-token',
      dailyLimit: 300,
      fetchImpl,
      fallback,
      timeoutMs: 20,
    });
  /** The pipeline a store call sent: its URL, auth header and commands. */
  const sent = (fetchImpl: MockInstance<typeof fetch>, call = 0) => {
    const [url, init] = fetchImpl.mock.calls[call] ?? [];
    const commands: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    return { url, auth: new Headers(init?.headers).get('authorization'), commands };
  };

  it('counts each client per minute in the store, keyed by its hash and the window', async () => {
    const store = storeAnswering(() => 1);
    const id = clientId(post({ 'x-vercel-forwarded-for': '203.0.113.7' }));
    await shared(store).request(id, NOW);
    expect(sent(store)).toEqual({
      url: 'https://kv.example/pipeline',
      auth: 'Bearer store-token',
      commands: [
        ['INCR', `gatherwise:rate:${id}:${Math.floor(NOW / 60_000)}`],
        ['EXPIRE', `gatherwise:rate:${id}:${Math.floor(NOW / 60_000)}`, 120],
      ],
    });
    expect(JSON.stringify(store.mock.calls)).not.toContain('203.0.113.7');
    // The next minute is a new key, so a new window.
    await shared(store).request(id, NOW + 60_000);
    expect(sent(store, 1).commands).toEqual([
      ['INCR', `gatherwise:rate:${id}:${Math.floor(NOW / 60_000) + 1}`],
      expect.anything(),
    ]);
  });

  it('allows the tenth request in a window and refuses the eleventh', async () => {
    await expect(shared(storeAnswering(() => 10)).request('c', NOW)).resolves.toBeUndefined();
    await expect(shared(storeAnswering(() => 11)).request('c', NOW)).rejects.toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
    });
  });

  it('counts model calls per UTC day and refuses past the daily limit until midnight', async () => {
    const store = storeAnswering(() => 300);
    await expect(shared(store).aiCall(NOW)).resolves.toBeUndefined();
    expect(sent(store).commands).toEqual([
      ['INCR', 'gatherwise:ai-calls:2026-10-21'],
      ['EXPIRE', 'gatherwise:ai-calls:2026-10-21', 172_800],
    ]);
    const spent = shared(storeAnswering(() => 301)).aiCall(NOW);
    await expect(spent).rejects.toMatchObject({ status: 503, code: 'AI_BUSY' });
    await expect(spent).rejects.toHaveProperty('detail.retryAfter', UNTIL_MIDNIGHT);
  });

  it.each<[string, () => Promise<Response>]>([
    ['an HTTP error', () => Promise.resolve(new Response('down', { status: 500 }))],
    ['a network failure', () => Promise.reject(new TypeError('fetch failed'))],
    ['an error reply', () => Promise.resolve(Response.json([{ error: 'ERR wrong type' }]))],
    ['a reply that is not JSON', () => Promise.resolve(new Response('<html>'))],
  ])('falls back to memory on %s, logs it, and never fails the request', async (_name, reply) => {
    const fallback = spyFallback();
    const limits = shared(vi.fn<typeof fetch>(reply), fallback);
    await expect(limits.request('c', NOW)).resolves.toBeUndefined();
    await expect(limits.aiCall(NOW)).resolves.toBeUndefined();
    expect(fallback.request).toHaveBeenCalledWith('c', NOW);
    expect(fallback.aiCall).toHaveBeenCalledWith(NOW);
    // The fallback still enforces its own limits.
    await expect(limits.aiCall(NOW)).rejects.toMatchObject({ code: 'AI_BUSY' });
    expect(warn).toHaveBeenCalledTimes(3);
    expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toEqual({
      event: 'limiter_fallback',
      reason: 'error',
    });
    expect(String(warn.mock.calls[0]?.[0])).not.toContain('store-token');
  });

  it('falls back to memory when the store is slower than its timeout', async () => {
    const hanging = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation timed out.', 'TimeoutError'));
          });
        }),
    );
    const fallback = spyFallback();
    await expect(shared(hanging, fallback).request('c', NOW)).resolves.toBeUndefined();
    expect(fallback.request).toHaveBeenCalledOnce();
    expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toEqual({
      event: 'limiter_fallback',
      reason: 'timeout',
    });
  });

  it('defaults to a fresh in-memory fallback and the global fetch', async () => {
    const store = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json([{ result: 1 }, { result: 1 }]));
    const limits = createSharedLimits({ url: 'https://kv.example', token: 't' });
    await limits.request('c', NOW);
    expect(store).toHaveBeenCalledOnce();
    store.mockRejectedValue(new TypeError('fetch failed'));
    await expect(limits.aiCall(NOW)).resolves.toBeUndefined();
  });
});

describe('clientId', () => {
  it('hashes the first forwarded address and never returns the raw IP', () => {
    const id = clientId(post({ 'x-vercel-forwarded-for': '203.0.113.7, 10.0.0.1' }));
    expect(id).toMatch(/^[0-9a-f]{64}$/u);
    expect(id).not.toContain('203.0.113.7');
    expect(clientId(post({ 'x-vercel-forwarded-for': ' 203.0.113.7 ' }))).toBe(id);
    expect(clientId(post({ 'x-vercel-forwarded-for': '198.51.100.2' }))).not.toBe(id);
  });

  it('falls back to one local identity when no forwarded address is present', () => {
    expect(clientId(post())).toBe('local');
    expect(clientId(post({ 'x-vercel-forwarded-for': '' }))).toBe('local');
  });
});

describe('createInferenceGate', () => {
  it('admits three concurrent calls, rejects the fourth and frees a slot on failure', async () => {
    const gate = createInferenceGate();
    const releases: (() => void)[] = [];
    const held = Array.from({ length: 3 }, () =>
      gate(() => new Promise<void>((resolve) => releases.push(resolve))),
    );
    await expect(gate(() => Promise.resolve('fourth'))).rejects.toMatchObject({
      status: 429,
      code: 'CAPACITY_LIMITED',
    });
    await expect(gate(() => Promise.reject(new Error('boom')))).rejects.toMatchObject({
      code: 'CAPACITY_LIMITED',
    });
    for (const release of releases) release();
    await Promise.all(held);
    // Three failures in a row: if any leaked its slot, the gate would now be full.
    for (let i = 0; i < 3; i += 1) {
      await expect(gate(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    }
    await expect(gate(() => Promise.resolve('after'))).resolves.toBe('after');
  });
});
