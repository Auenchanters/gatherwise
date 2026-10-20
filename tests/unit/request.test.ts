/**
 * The request gate, step by step: transport (content type, origin, declared size), the streamed
 * body (size, JSON, strict schema) and the server-side date window.
 */
import { describe, expect, it } from 'vitest';
import { MAX_BODY_BYTES, planFor, readBrief, validateTransport } from '../../server/request.js';
import { LIMITS } from '../../src/shared/limits.js';
import { brief } from '../support/fixtures.js';

const URL_ = 'https://gatherwise.example/api/plan';
const post = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  new Request(URL_, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });

async function failure(work: () => unknown): Promise<unknown> {
  try {
    await work();
  } catch (error) {
    return error;
  }
  return undefined;
}

/** A body stream with no Content-Length, delivered in `chunks` pieces of `size` bytes. */
function streamed(chunks: number, size: number): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream({
    pull(controller) {
      if (sent === chunks) {
        controller.close();
        return;
      }
      sent += 1;
      controller.enqueue(new Uint8Array(size).fill(0x20));
    },
  });
}

/** A POST init for a streamed body; Node requires `duplex`, which the DOM typings lack. */
function streamInit(body: ReadableStream<Uint8Array>): RequestInit {
  const init = { method: 'POST', body, duplex: 'half' };
  return init;
}

describe('validateTransport', () => {
  it('accepts JSON (any case, with a charset) from this origin or with no Origin at all', () => {
    expect(() => validateTransport(post('{}'), undefined)).not.toThrow();
    const sameOrigin = { origin: 'https://gatherwise.example', 'sec-fetch-site': 'same-origin' };
    expect(() => validateTransport(post('{}', sameOrigin), undefined)).not.toThrow();
    const charset = { 'content-type': 'Application/JSON; charset=utf-8' };
    expect(() => validateTransport(post('{}', charset), undefined)).not.toThrow();
  });

  it('rejects other content types with 415', async () => {
    for (const type of ['text/plain', 'application/jsonp', 'multipart/form-data']) {
      expect(
        await failure(() => validateTransport(post('{}', { 'content-type': type }), undefined)),
      ).toMatchObject({ status: 415, code: 'JSON_REQUIRED' });
    }
    const none = new Request(URL_, { method: 'POST' });
    expect(await failure(() => validateTransport(none, undefined))).toMatchObject({ status: 415 });
  });

  it('rejects a foreign Origin and any cross-site fetch with 403', async () => {
    for (const headers of [
      { origin: 'https://evil.example' },
      { 'sec-fetch-site': 'cross-site' },
      { origin: 'https://gatherwise.example', 'sec-fetch-site': 'cross-site' },
    ]) {
      expect(await failure(() => validateTransport(post('{}', headers), undefined))).toMatchObject({
        status: 403,
        code: 'ORIGIN_REJECTED',
      });
    }
  });

  it('uses APP_ORIGIN, when set, instead of the request URL', async () => {
    const app = 'https://gatherwise.vercel.app';
    expect(() => validateTransport(post('{}', { origin: app }), app)).not.toThrow();
    const own = post('{}', { origin: 'https://gatherwise.example' });
    expect(await failure(() => validateTransport(own, app))).toMatchObject({ status: 403 });
  });

  it('rejects a declared Content-Length over the cap before reading anything', async () => {
    const big = post('{}', { 'content-length': String(MAX_BODY_BYTES + 1) });
    expect(await failure(() => validateTransport(big, undefined))).toMatchObject({
      status: 413,
      code: 'BODY_TOO_LARGE',
    });
  });
});

describe('readBrief', () => {
  it('returns the parsed, trimmed brief', async () => {
    const b = brief('wedding', { name: '  Asha and Rohan  ' });
    await expect(readBrief(post(JSON.stringify({ brief: b })))).resolves.toEqual({
      ...b,
      name: 'Asha and Rohan',
    });
  });

  it('counts streamed bytes, so a body with no Content-Length cannot exceed the cap', async () => {
    expect(MAX_BODY_BYTES).toBe(16_384);
    const over = new Request(URL_, streamInit(streamed(17, 1024)));
    expect(over.headers.get('content-length')).toBeNull();
    expect(await failure(() => readBrief(over))).toMatchObject({
      status: 413,
      code: 'BODY_TOO_LARGE',
    });
    // Exactly at the cap is read in full (and then fails as JSON, not as size).
    const atCap = new Request(URL_, streamInit(streamed(16, 1024)));
    expect(await failure(() => readBrief(atCap))).toMatchObject({ code: 'INVALID_JSON' });
  });

  it.each([
    ['broken JSON', '{"brief":'],
    ['an empty body', ''],
  ])('rejects %s as INVALID_JSON', async (_name, body) => {
    expect(await failure(() => readBrief(post(body)))).toMatchObject({
      status: 400,
      code: 'INVALID_JSON',
    });
  });

  it('rejects a missing body as INVALID_JSON', async () => {
    const empty = new Request(URL_, { method: 'POST' });
    expect(await failure(() => readBrief(empty))).toMatchObject({ code: 'INVALID_JSON' });
  });

  it.each([
    ['a zero guest count', { brief: brief('community', { guests: 0 }) }, ['guests']],
    [
      'several bad fields',
      { brief: { ...brief('birthday', { guests: 0, name: '' }), currency: 'XYZ' } },
      ['name', 'guests', 'currency'],
    ],
    ['an unknown kind', { brief: { ...brief('community'), kind: 'funeral' } }, ['kind']],
    ['an unknown key in the brief', { brief: { ...brief('community'), admin: true } }, ['brief']],
    ['an unknown top-level key', { brief: brief('community'), debug: true }, ['brief']],
    ['no brief at all', {}, ['brief']],
    ['a non-object', [1, 2], ['brief']],
  ])('rejects %s as INVALID_BRIEF with the field paths', async (_name, body, fields) => {
    expect(await failure(() => readBrief(post(JSON.stringify(body))))).toMatchObject({
      status: 400,
      code: 'INVALID_BRIEF',
      detail: { fields },
    });
  });

  it('names at most ten fields', async () => {
    const nulls = Object.fromEntries(Object.keys(brief('community')).map((key) => [key, null]));
    const wrong = { ...nulls, kind: 'community' };
    const error = await failure(() => readBrief(post(JSON.stringify({ brief: wrong }))));
    expect(error).toMatchObject({ code: 'INVALID_BRIEF' });
    expect(error).toHaveProperty('detail.fields.length', 10);
  });
});

describe('planFor', () => {
  const now = new Date('2026-10-21T23:30:00Z');
  const at = (date: string) => brief('community', { date });

  it.each([
    ['yesterday in UTC (a client west of UTC)', '2026-10-20'],
    ['today', '2026-10-21'],
    ['the last day of the horizon', '2028-10-20'],
    ['one day past the horizon (a client east of UTC)', '2028-10-21'],
  ])('plans an event dated %s', (_name, date) => {
    const plan = planFor(at(date), now);
    expect(plan.eventDate).toBe(date);
    expect(plan.schedule.tasks.length).toBeGreaterThan(0);
  });

  it.each([
    ['two days ago', '2026-10-19'],
    ['two days past the horizon', '2028-10-22'],
    ['an impossible date', '2026-02-30'],
  ])('rejects an event dated %s as INVALID_BRIEF naming date', async (_name, date) => {
    expect(await failure(() => planFor(at(date), now))).toMatchObject({
      status: 400,
      code: 'INVALID_BRIEF',
      detail: { fields: ['date'] },
    });
  });

  it('uses the UTC calendar day, whatever the server zone', () => {
    expect(LIMITS.brief.horizonDays).toBe(730);
    // 23:30 UTC is still the 21st in UTC but already the 22nd in IST and 19:30 on the 21st in New York.
    expect(planFor(at('2026-10-21'), now).today).toBe('2026-10-21');
  });
});
