/**
 * Per-instance quotas: the per-client window, the instance-wide cap, the concurrency gate and
 * the hashed client identity.
 */
import { describe, expect, it } from 'vitest';
import { createInferenceGate } from '../../server/capacity.js';
import { clientId, createRateLimiter } from '../../server/rate-limit.js';

const post = (headers: Record<string, string> = {}) =>
  new Request('https://gatherwise.example/api/plan', { method: 'POST', headers });

const code = (fn: () => void): unknown => {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
};

describe('createRateLimiter', () => {
  it('allows ten requests per client per minute, then restores capacity when the window ends', () => {
    const limit = createRateLimiter();
    for (let i = 0; i < 10; i += 1) limit('client', 1_000 + i);
    expect(code(() => limit('client', 30_000))).toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
    });
    expect(() => limit('other-client', 30_000)).not.toThrow();
    expect(() => limit('client', 61_000)).not.toThrow();
  });

  it('caps the whole instance at sixty requests per minute across clients', () => {
    const limit = createRateLimiter();
    for (let i = 0; i < 60; i += 1) limit(`client-${i}`, 0);
    expect(code(() => limit('fresh-client', 1))).toMatchObject({ code: 'RATE_LIMITED' });
    expect(() => limit('fresh-client', 60_000)).not.toThrow();
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
