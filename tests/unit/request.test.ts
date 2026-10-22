/**
 * The request gate, step by step: transport (content type, origin, declared size), the streamed
 * body (size, JSON, strict schema, the "Adjust with AI" part) and the server-side date window.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_BODY_BYTES,
  planFor,
  readPlanRequest,
  validateTransport,
} from '../../server/request.js';
import { templateFor, templateIds } from '../../src/domain/templates/index.js';
import { LIMITS } from '../../src/shared/limits.js';
import {
  ACCESSIBILITY_OPTIONS,
  DIETARY_OPTIONS,
  type AiSuggestions,
} from '../../src/shared/schema.js';
import { aiSuggestions, brief } from '../support/fixtures.js';

const URL_ = 'https://gatherwise.example/api/plan';
const OWN = { origin: 'https://gatherwise.example' };
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
  it('accepts JSON (any case, with a charset) from this origin', () => {
    expect(() => validateTransport(post('{}', OWN), undefined)).not.toThrow();
    const sameOrigin = { ...OWN, 'sec-fetch-site': 'same-origin' };
    expect(() => validateTransport(post('{}', sameOrigin), undefined)).not.toThrow();
    const charset = { ...OWN, 'content-type': 'Application/JSON; charset=utf-8' };
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

  it('rejects an absent, foreign, empty or opaque Origin and any cross-site fetch with 403', async () => {
    for (const headers of [
      {},
      { origin: 'https://evil.example' },
      { origin: '' },
      { origin: 'null' },
      { 'sec-fetch-site': 'cross-site' },
      { origin: 'https://gatherwise.example', 'sec-fetch-site': 'cross-site' },
    ]) {
      expect(await failure(() => validateTransport(post('{}', headers), undefined))).toMatchObject({
        status: 403,
        code: 'ORIGIN_REJECTED',
      });
    }
  });

  it('accepts APP_ORIGIN as well as the own origin of the request URL, and nothing else', async () => {
    const app = 'https://gatherwise.vercel.app';
    expect(() => validateTransport(post('{}', { origin: app }), app)).not.toThrow();
    const own = post('{}', { origin: 'https://gatherwise.example' });
    expect(() => validateTransport(own, app)).not.toThrow();
    for (const origin of ['https://evil.example', '']) {
      expect(await failure(() => validateTransport(post('{}', { origin }), app))).toMatchObject({
        status: 403,
      });
    }
  });

  it('rejects a declared Content-Length over the cap before reading anything', async () => {
    const big = post('{}', { ...OWN, 'content-length': String(MAX_BODY_BYTES + 1) });
    expect(await failure(() => validateTransport(big, undefined))).toMatchObject({
      status: 413,
      code: 'BODY_TOO_LARGE',
    });
  });
});

describe('readPlanRequest', () => {
  it('returns the parsed, trimmed brief', async () => {
    const b = brief('wedding', { name: '  Asha and Rohan  ' });
    await expect(readPlanRequest(post(JSON.stringify({ brief: b })))).resolves.toEqual({
      brief: { ...b, name: 'Asha and Rohan' },
    });
  });

  it('counts streamed bytes, so a body with no Content-Length cannot exceed the cap', async () => {
    expect(MAX_BODY_BYTES).toBe(65_536);
    const over = new Request(URL_, streamInit(streamed(65, 1024)));
    expect(over.headers.get('content-length')).toBeNull();
    expect(await failure(() => readPlanRequest(over))).toMatchObject({
      status: 413,
      code: 'BODY_TOO_LARGE',
    });
    // Exactly at the cap is read in full (and then fails as JSON, not as size).
    const atCap = new Request(URL_, streamInit(streamed(64, 1024)));
    expect(await failure(() => readPlanRequest(atCap))).toMatchObject({ code: 'INVALID_JSON' });
  });

  it.each([
    ['broken JSON', '{"brief":'],
    ['an empty body', ''],
  ])('rejects %s as INVALID_JSON', async (_name, body) => {
    expect(await failure(() => readPlanRequest(post(body)))).toMatchObject({
      status: 400,
      code: 'INVALID_JSON',
    });
  });

  it('rejects a missing body as INVALID_JSON', async () => {
    const empty = new Request(URL_, { method: 'POST' });
    expect(await failure(() => readPlanRequest(empty))).toMatchObject({ code: 'INVALID_JSON' });
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
    expect(await failure(() => readPlanRequest(post(JSON.stringify(body))))).toMatchObject({
      status: 400,
      code: 'INVALID_BRIEF',
      detail: { fields },
    });
  });

  it('names at most ten fields', async () => {
    const nulls = Object.fromEntries(Object.keys(brief('community')).map((key) => [key, null]));
    const wrong = { ...nulls, kind: 'community' };
    const error = await failure(() => readPlanRequest(post(JSON.stringify({ brief: wrong }))));
    expect(error).toMatchObject({ code: 'INVALID_BRIEF' });
    expect(error).toHaveProperty('detail.fields.length', 10);
  });
});

describe('readPlanRequest: Adjust with AI', () => {
  const body = (adjust: unknown) => post(JSON.stringify({ brief: brief('community'), adjust }));

  it('returns the change and the earlier answer it revises; the answer is optional', async () => {
    const adjust = { change: 'Make it cheaper', previous: aiSuggestions };
    await expect(readPlanRequest(body(adjust))).resolves.toEqual({
      brief: brief('community'),
      adjust,
    });
    await expect(readPlanRequest(body({ change: '' }))).resolves.toMatchObject({
      adjust: { change: '' },
    });
  });

  it('takes a change at the cap counted in code points, four-byte ones included', async () => {
    const change = '🎉'.repeat(LIMITS.ai.changeMax);
    await expect(readPlanRequest(body({ change }))).resolves.toMatchObject({ adjust: { change } });
  });

  it.each([
    ['a change one code point too long', { change: 'x'.repeat(LIMITS.ai.changeMax + 1) }],
    ['no change', { previous: aiSuggestions }],
    ['a change that is not text', { change: 5 }],
    ['an earlier answer from another template', { change: '', previous: weddingAnswer() }],
    ['an earlier answer of the wrong shape', { change: '', previous: { summary: 'x' } }],
    ['an unknown key', { change: '', admin: true }],
    ['a list instead of an object', ['cheaper']],
    ['null', null],
  ])('rejects %s as INVALID_ADJUSTMENT, naming nothing', async (_name, adjust) => {
    const error = await failure(() => readPlanRequest(body(adjust)));
    expect(error).toMatchObject({ status: 400, code: 'INVALID_ADJUSTMENT', detail: {} });
  });

  it('reports a bad brief first, whatever the adjustment holds', async () => {
    const both = { brief: brief('community', { guests: 0 }), adjust: { change: 7 } };
    expect(await failure(() => readPlanRequest(post(JSON.stringify(both))))).toMatchObject({
      code: 'INVALID_BRIEF',
      detail: { fields: ['guests'] },
    });
  });

  it('fits the largest possible brief, change and earlier answer within the body cap', async () => {
    const ai = LIMITS.ai;
    // Brief text is capped in UTF-16 units, where a three-byte character is the densest; the
    // answer and the change are capped in code points, where a four-byte emoji is.
    const dense = (n: number) => 'आ'.repeat(n);
    const wide = (n: number) => '🎉'.repeat(n);
    const ids = templateIds(templateFor('community'));
    const longest = (list: readonly string[]) =>
      list.reduce((a, b) => (b.length > a.length ? b : a));
    const many = <T>(n: number, item: T): T[] => Array.from({ length: n }, () => item);
    // A double whose JSON text is about as long as one in range can be.
    const longNumber = 1.234567890123456e-7;
    const previous: AiSuggestions = {
      summary: wide(ai.summaryMax),
      ideas: many(ai.ideasMax, {
        title: wide(ai.ideaTitleMax),
        description: wide(ai.ideaDescriptionMax),
        categoryId: longest(ids.categories),
        estimatedCost: longNumber,
        personalization: wide(ai.personalizationMax),
      }),
      extraTasks: many(ai.extraTasksMax, {
        title: wide(ai.taskTitleMax),
        categoryId: longest(ids.categories),
        durationDays: longNumber,
        leadDays: longNumber,
        after: many(ai.afterMax, longest(ids.tasks)),
      }),
      vendorQuestions: many(ai.vendorQuestionsMax, {
        vendorId: longest(ids.vendors),
        questions: many(ai.questionsPerVendorMax, wide(ai.questionMax)),
      }),
    };
    const caps = LIMITS.brief;
    const fullBrief = brief('community', {
      name: dense(caps.nameMax),
      city: dense(caps.cityMax),
      vibe: dense(caps.vibeMax),
      notes: dense(caps.notesMax),
      guests: caps.guestsMax,
      budget: caps.budgetMax,
      volunteersAvailable: caps.volunteersMax,
      dietary: [...DIETARY_OPTIONS],
      accessibility: [...ACCESSIBILITY_OPTIONS],
      language: 'Bengali',
      income: {
        ticketPrice: caps.budgetMax,
        expectedPaidAttendance: caps.guestsMax,
        sponsors: caps.budgetMax,
        donations: caps.budgetMax,
        stallCount: caps.guestsMax,
        stallFee: caps.budgetMax,
      },
    });
    const largest = JSON.stringify({
      brief: fullBrief,
      adjust: { change: wide(ai.changeMax), previous },
    });
    const bytes = new TextEncoder().encode(largest).length;
    expect(bytes).toBeGreaterThan(40_000);
    expect(bytes).toBeLessThanOrEqual(MAX_BODY_BYTES);
    await expect(readPlanRequest(post(largest))).resolves.toMatchObject({
      adjust: { previous: { summary: previous.summary } },
    });
  });
});

/** A valid answer for the wedding template, whose category ids the community template lacks. */
function weddingAnswer(): AiSuggestions {
  return {
    summary: 'A warm wedding.',
    ideas: [
      {
        title: 'Shehnai at the gate',
        description: 'Live music as guests arrive.',
        categoryId: 'catering',
        estimatedCost: 20_000,
        personalization: 'traditional',
      },
    ],
    extraTasks: [],
    vendorQuestions: [],
  };
}

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
