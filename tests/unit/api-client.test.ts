/**
 * The browser's planning client: the cache, the AI-call counter, request shape and error mapping.
 * Does: drives `createPlanClient` through an injected fake `fetch`, so every claim in the model-call
 * budget is a count of real `fetch` calls: one per new brief, none for a repeat, one per explicit
 * refresh, and failures and aborts never stored.
 * Never calls the network or the real clock (the timeout tests use a few milliseconds).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPlanClient,
  type ClientError,
  type PlanClient,
  type SuggestResponse,
} from '../../src/features/client/api-client.js';
import type { Result } from '../../src/shared/result.js';
import type { EventBrief } from '../../src/shared/schema.js';
import { brief } from '../support/fixtures.js';

const SUGGESTIONS = {
  summary: 'A bright, family-friendly mela.',
  ideas: [
    {
      title: 'Lantern walk',
      description: 'Paper lanterns along the path.',
      categoryId: 'decor',
      estimatedCost: 5000,
      personalization: 'vibe: family friendly',
    },
  ],
  weightHints: [{ categoryId: 'decor', factor: 1.2 }],
  extraTasks: [],
  vendorQuestions: [{ vendorId: 'tent_shamiana', questions: ['Is the tent rain-proof?'] }],
};
const META = {
  model: 'test-model',
  latencyMs: 812,
  inputTokens: 300,
  outputTokens: 420,
  requestId: '0b0c1f2e-7d4a-4c1e-9a55-3f0f6a3c2d10',
};
const GOOD = { suggestions: SUGGESTIONS, meta: META };

/** A fresh `Response` per call (a body can be read once), so one fake can answer many times. */
const json = (body: unknown, init?: ResponseInit): Promise<Response> =>
  Promise.resolve(Response.json(body, init));
const raw = (body: string, init?: ResponseInit): Promise<Response> =>
  Promise.resolve(new Response(body, init));
const failure = (code: string, status: number, headers?: Record<string, string>) =>
  json({ error: { code, message: 'x' } }, { status, ...(headers ? { headers } : {}) });

/** A `fetch` that answers every call with `answer()`. */
const serving = (answer: () => Promise<Response> = () => json(GOOD)) =>
  vi.fn<typeof fetch>(() => answer());

/** A `fetch` that never answers but rejects, like the real one, when its signal aborts. */
const hanging = () =>
  vi.fn<typeof fetch>(
    (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        const aborted = () => {
          reject(new DOMException('aborted', 'AbortError'));
        };
        if (init?.signal?.aborted === true) aborted();
        else init?.signal?.addEventListener('abort', aborted, { once: true });
      }),
  );

const client = (fetchImpl: typeof fetch, options: { cacheSize?: number } = {}): PlanClient =>
  createPlanClient({ fetchImpl, ...options });

const community = (guests = 250) => brief('community', { guests });
const never = new AbortController().signal;

/** The code of a failed result, with the value of a successful one flagged loudly. */
function failed(result: Result<SuggestResponse, ClientError>): ClientError {
  if (result.ok) throw new Error('expected a failure');
  return result.error;
}
function succeeded(result: Result<SuggestResponse, ClientError>): SuggestResponse {
  if (!result.ok) throw new Error(`expected success, got ${result.error.code}`);
  return result.value;
}

const nativeAny = Object.getOwnPropertyDescriptor(AbortSignal, 'any');
/** Simulates a browser older than Chrome 116 / Safari 17.4, where `AbortSignal.any` is missing. */
const withoutAbortSignalAny = () =>
  Object.defineProperty(AbortSignal, 'any', {
    value: undefined,
    configurable: true,
    writable: true,
  });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (nativeAny) Object.defineProperty(AbortSignal, 'any', nativeAny);
});

describe('the model-call budget', () => {
  it('costs one call for a new brief, none for the same brief again', async () => {
    const fetchImpl = serving();
    const planner = client(fetchImpl);
    expect(planner.calls()).toBe(0);

    const first = succeeded(await planner.suggest(community(), never));
    expect(first).toEqual({ ...GOOD, cached: false });
    expect(planner.calls()).toBe(1);

    const again = succeeded(await planner.suggest(community(), never));
    expect(again).toEqual({ ...GOOD, cached: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(planner.calls()).toBe(1);
  });

  it('flags a reused answer without touching the stored entry or the original result', async () => {
    const planner = client(serving());
    const first = succeeded(await planner.suggest(community(), never));
    const reused = succeeded(await planner.suggest(community(), never));
    expect(first.cached).toBe(false);
    expect(reused.cached).toBe(true);
    // The data is the stored data, not a copy of it; only the flag differs.
    expect(reused.suggestions).toBe(first.suggestions);
    expect(reused.meta).toBe(first.meta);
    expect(succeeded(await planner.suggest(community(), never)).cached).toBe(true);
    // A refresh is a new request: fresh again, and the next reuse is flagged again.
    expect(succeeded(await planner.suggest(community(), never, { refresh: true })).cached).toBe(
      false,
    );
    expect(succeeded(await planner.suggest(community(), never)).cached).toBe(true);
    expect(first.cached).toBe(false);
  });

  it('leaves the old entry intact when a refresh fails', async () => {
    const fetchImpl = serving();
    const planner = client(fetchImpl);
    const first = succeeded(await planner.suggest(community(), never));

    fetchImpl.mockImplementation(() => failure('AI_UNAVAILABLE', 502));
    expect(failed(await planner.suggest(community(), never, { refresh: true })).code).toBe(
      'unavailable',
    );
    fetchImpl.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(failed(await planner.suggest(community(), never, { refresh: true })).code).toBe(
      'network',
    );
    expect(planner.calls()).toBe(3);

    const reused = succeeded(await planner.suggest(community(), never));
    expect(reused).toEqual({ ...first, cached: true });
    expect(planner.calls()).toBe(3);
  });

  it('costs another call when one field changes', async () => {
    const fetchImpl = serving();
    const planner = client(fetchImpl);
    await planner.suggest(community(250), never);
    await planner.suggest(community(251), never);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(planner.calls()).toBe(2);
    await planner.suggest(community(250), never);
    await planner.suggest(community(251), never);
    expect(planner.calls()).toBe(2);
  });

  it('costs exactly one call per explicit refresh, and refreshing replaces the stored value', async () => {
    let version = 0;
    const fetchImpl = serving(() => {
      version += 1;
      return json({ suggestions: { ...SUGGESTIONS, summary: `v${version}` }, meta: META });
    });
    const planner = client(fetchImpl);

    expect(succeeded(await planner.suggest(community(), never)).suggestions.summary).toBe('v1');
    const refreshed = await planner.suggest(community(), never, { refresh: true });
    expect(succeeded(refreshed).suggestions.summary).toBe('v2');
    expect(planner.calls()).toBe(2);

    const afterwards = await planner.suggest(community(), never);
    expect(succeeded(afterwards).suggestions.summary).toBe('v2');
    expect(planner.calls()).toBe(2);
  });

  it('stores the result of a refresh even when nothing was cached, and ignores refresh: false', async () => {
    const fetchImpl = serving();
    const planner = client(fetchImpl);
    await planner.suggest(community(), never, { refresh: true });
    await planner.suggest(community(), never, { refresh: false });
    await planner.suggest(community(), never, {});
    expect(planner.calls()).toBe(1);
  });

  it('counts a failed request as a call, because it really was one', async () => {
    const planner = client(serving(() => failure('AI_UNAVAILABLE', 502)));
    await planner.suggest(community(), never);
    await planner.suggest(community(), never);
    expect(planner.calls()).toBe(2);
  });

  it('counts per client, not globally', async () => {
    const fetchImpl = serving();
    const [a, b] = [client(fetchImpl), client(fetchImpl)];
    await a.suggest(community(), never);
    expect(a.calls()).toBe(1);
    expect(b.calls()).toBe(0);
    await b.suggest(community(), never);
    expect(b.calls()).toBe(1);
  });
});

describe('the cache key', () => {
  it('ignores key order, at the top level and inside nested objects', async () => {
    // The same value with the keys of one object in reverse order.
    const flip = <T extends object>(value: T): T =>
      Object.fromEntries(Object.entries(value).reverse()) as T;
    const income = {
      ticketPrice: 100,
      expectedPaidAttendance: 50,
      sponsors: 1,
      donations: 2,
      stallCount: 3,
      stallFee: 4,
    };
    const a = brief('community', { income });
    const b = flip({ ...a, income: flip(income) });
    expect(JSON.stringify(b)).not.toBe(JSON.stringify(a));
    expect(JSON.stringify(b.income)).not.toBe(JSON.stringify(a.income));

    const fetchImpl = serving();
    const planner = client(fetchImpl);
    await planner.suggest(a, never);
    await planner.suggest(b, never);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('keys on what the wire carries: an undefined key is absent, an undefined array item is null', async () => {
    // Types forbid these shapes; a stray one must still not cost a second request, because
    // JSON.stringify sends the same body for both.
    const base = brief('community');
    const loose = (value: object): EventBrief => value as EventBrief;
    const fetchImpl = serving();
    const planner = client(fetchImpl);

    await planner.suggest(base, never);
    await planner.suggest(loose({ ...base, income: undefined }), never);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await planner.suggest(loose({ ...base, dietary: [null] }), never);
    await planner.suggest(loose({ ...base, dietary: [undefined] }), never);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // Different from an empty list, and from a list with a real value.
    await planner.suggest(loose({ ...base, dietary: [] }), never);
    await planner.suggest(loose({ ...base, dietary: ['vegan'] }), never);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('keeps array order significant', async () => {
    const fetchImpl = serving();
    const planner = client(fetchImpl);
    await planner.suggest(brief('community', { dietary: ['vegan', 'halal'] }), never);
    await planner.suggest(brief('community', { dietary: ['halal', 'vegan'] }), never);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('hashes the compact, key-sorted JSON of the brief with SHA-256', async () => {
    const digest = vi.spyOn(crypto.subtle, 'digest');
    const b = community();
    await client(serving()).suggest(b, never);
    const sorted = Object.fromEntries(Object.entries(b).sort(([x], [y]) => (x < y ? -1 : 1)));
    expect(digest).toHaveBeenCalledOnce();
    const [algorithm, data] = digest.mock.calls[0] ?? [];
    expect(algorithm).toBe('SHA-256');
    expect(new TextDecoder().decode(data)).toBe(JSON.stringify(sorted));
  });

  it('falls back to the canonical text itself where crypto.subtle is unavailable', async () => {
    vi.stubGlobal('crypto', {});
    const fetchImpl = serving();
    const planner = client(fetchImpl);
    await planner.suggest(community(), never);
    await planner.suggest(community(), never);
    await planner.suggest(community(251), never);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('the LRU', () => {
  const fill = async (planner: PlanClient, count: number) => {
    for (let i = 0; i < count; i += 1) await planner.suggest(community(100 + i), never);
  };

  it('holds 8 briefs and evicts the oldest at the 9th', async () => {
    const fetchImpl = serving();
    const planner = client(fetchImpl);
    await fill(planner, 8);
    expect(planner.calls()).toBe(8);
    await fill(planner, 8);
    expect(planner.calls()).toBe(8);

    await planner.suggest(community(999), never);
    expect(planner.calls()).toBe(9);
    // The oldest (guests 100) was evicted and refetches; the second-oldest was evicted by that.
    await planner.suggest(community(100), never);
    expect(planner.calls()).toBe(10);
  });

  it('evicts the least recently USED, not the oldest inserted', async () => {
    const planner = client(serving());
    await fill(planner, 8);
    await planner.suggest(community(100), never); // a hit makes 100 the newest
    await planner.suggest(community(999), never); // evicts 101
    expect(planner.calls()).toBe(9);
    await planner.suggest(community(100), never);
    expect(planner.calls()).toBe(9);
    await planner.suggest(community(101), never);
    expect(planner.calls()).toBe(10);
  });

  it('honours cacheSize', async () => {
    const planner = client(serving(), { cacheSize: 1 });
    await planner.suggest(community(100), never);
    await planner.suggest(community(101), never);
    await planner.suggest(community(100), never);
    expect(planner.calls()).toBe(3);
    await planner.suggest(community(100), never);
    expect(planner.calls()).toBe(3);
  });

  it('a refresh makes its entry the newest', async () => {
    const planner = client(serving());
    await fill(planner, 8);
    await planner.suggest(community(100), never, { refresh: true }); // call 9, 100 is newest
    await planner.suggest(community(999), never); // call 10, evicts 101
    await planner.suggest(community(100), never);
    expect(planner.calls()).toBe(10);
  });
});

describe('the request', () => {
  it('POSTs the brief as JSON to /api/plan and nothing else', async () => {
    const fetchImpl = serving();
    const b = community();
    await client(fetchImpl).suggest(b, never);
    const [input, init] = fetchImpl.mock.calls[0] ?? [];
    expect(input).toBe('/api/plan');
    const { signal, ...rest } = init ?? {};
    expect(rest).toStrictEqual({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brief: b }),
    });
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it('uses a 25 s timeout by default and the given one when set', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    await client(serving()).suggest(community(), never);
    expect(timeout).toHaveBeenLastCalledWith(25_000);
    await createPlanClient({ fetchImpl: serving(), timeoutMs: 1234 }).suggest(community(), never);
    expect(timeout).toHaveBeenLastCalledWith(1234);
  });

  it('falls back to the global fetch', async () => {
    const fetchImpl = serving();
    vi.stubGlobal('fetch', fetchImpl);
    succeeded(await createPlanClient().suggest(community(), never));
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("passes the caller's abort on to the request", async () => {
    const fetchImpl = hanging();
    const controller = new AbortController();
    const pending = client(fetchImpl).suggest(community(), controller.signal);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
    const sent = fetchImpl.mock.calls[0]?.[1]?.signal;
    expect(sent?.aborted).toBe(false);
    controller.abort();
    expect(sent?.aborted).toBe(true);
    await pending;
  });
});

describe('aborts and network failures', () => {
  it('returns network when the caller aborts mid-flight, and stores nothing', async () => {
    const fetchImpl = hanging();
    const planner = client(fetchImpl);
    const controller = new AbortController();
    const pending = planner.suggest(community(), controller.signal);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
    controller.abort();
    expect(failed(await pending)).toStrictEqual({ code: 'network' });

    fetchImpl.mockImplementation(() => json(GOOD));
    succeeded(await planner.suggest(community(), never));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('returns network for a signal that is already aborted, without a request or a count', async () => {
    const fetchImpl = serving();
    const planner = client(fetchImpl);
    const controller = new AbortController();
    controller.abort();
    expect(failed(await planner.suggest(community(), controller.signal))).toStrictEqual({
      code: 'network',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(planner.calls()).toBe(0);
  });

  describe('building the request signal', () => {
    it('resolves a bad timeoutMs as network, without a request, a count or a rejection', async () => {
      for (const timeoutMs of [Number.NaN, -1]) {
        const fetchImpl = serving();
        const planner = createPlanClient({ fetchImpl, timeoutMs });
        expect(failed(await planner.suggest(community(), never))).toStrictEqual({
          code: 'network',
        });
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(planner.calls()).toBe(0);
      }
    });

    it('resolves a throwing AbortSignal.any as network, without a request or a count', async () => {
      vi.spyOn(AbortSignal, 'any').mockImplementation(() => {
        throw new TypeError('boom');
      });
      const fetchImpl = serving();
      const planner = client(fetchImpl);
      expect(failed(await planner.suggest(community(), never))).toStrictEqual({ code: 'network' });
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(planner.calls()).toBe(0);
    });

    it('still works where AbortSignal.any is missing', async () => {
      withoutAbortSignalAny();
      const fetchImpl = serving();
      const planner = client(fetchImpl);
      succeeded(await planner.suggest(community(), never));
      expect(planner.calls()).toBe(1);
      expect(fetchImpl.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
      // Cached as usual.
      expect(succeeded(await planner.suggest(community(), never)).cached).toBe(true);
    });

    it('without AbortSignal.any, the caller aborting aborts the request: network', async () => {
      withoutAbortSignalAny();
      const fetchImpl = hanging();
      const controller = new AbortController();
      const pending = client(fetchImpl).suggest(community(), controller.signal);
      await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
      const sent = fetchImpl.mock.calls[0]?.[1]?.signal;
      expect(sent?.aborted).toBe(false);
      controller.abort();
      expect(sent?.aborted).toBe(true);
      expect(failed(await pending)).toStrictEqual({ code: 'network' });
    });

    it('without AbortSignal.any, our timeout aborts the request: timeout', async () => {
      withoutAbortSignalAny();
      const planner = createPlanClient({ fetchImpl: hanging(), timeoutMs: 15 });
      expect(failed(await planner.suggest(community(), never))).toStrictEqual({ code: 'timeout' });
    });

    it('without AbortSignal.any, a timer that already fired aborts the request at once', async () => {
      withoutAbortSignalAny();
      vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort());
      const planner = client(hanging());
      expect(failed(await planner.suggest(community(), never))).toStrictEqual({ code: 'timeout' });
    });
  });

  it('returns timeout when its own timer fires, and stores nothing', async () => {
    const fetchImpl = hanging();
    const planner = createPlanClient({ fetchImpl, timeoutMs: 15 });
    expect(failed(await planner.suggest(community(), never))).toStrictEqual({ code: 'timeout' });

    fetchImpl.mockImplementation(() => json(GOOD));
    succeeded(await planner.suggest(community(), never));
    expect(planner.calls()).toBe(2);
  });

  it('covers reading the body too: a stalled body is a timeout', async () => {
    const fetchImpl = vi.fn<typeof fetch>((_input, init) => {
      const response = new Response('{}');
      response.text = () =>
        new Promise<string>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        });
      return Promise.resolve(response);
    });
    const planner = createPlanClient({ fetchImpl, timeoutMs: 15 });
    expect(failed(await planner.suggest(community(), never))).toStrictEqual({ code: 'timeout' });
  });

  it('reports the caller as the cause when the caller aborts the body read', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>(() => {
      const response = new Response('{}');
      response.text = () => {
        controller.abort();
        return Promise.reject(new DOMException('aborted', 'AbortError'));
      };
      return Promise.resolve(response);
    });
    expect(failed(await client(fetchImpl).suggest(community(), controller.signal))).toStrictEqual({
      code: 'network',
    });
  });

  it('returns network when fetch rejects for any other reason, and stores nothing', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.reject(new TypeError('Failed to fetch')));
    const planner = client(fetchImpl);
    expect(failed(await planner.suggest(community(), never))).toStrictEqual({ code: 'network' });
    expect(failed(await planner.suggest(community(), never))).toStrictEqual({ code: 'network' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('returns network when fetch throws synchronously', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => {
      throw new TypeError('boom');
    });
    const planner = client(fetchImpl);
    expect(failed(await planner.suggest(community(), never))).toStrictEqual({ code: 'network' });
    expect(planner.calls()).toBe(1);
  });
});

describe('error mapping', () => {
  const cases: readonly [string, () => Promise<Response>, ClientError][] = [
    ['RATE_LIMITED', () => failure('RATE_LIMITED', 429), { code: 'rate_limited' }],
    ['CAPACITY_LIMITED', () => failure('CAPACITY_LIMITED', 429), { code: 'rate_limited' }],
    ['AI_BUSY (a 503)', () => failure('AI_BUSY', 503), { code: 'rate_limited' }],
    ['AI_TIMEOUT', () => failure('AI_TIMEOUT', 504), { code: 'timeout' }],
    ['a 504 with an unknown code', () => failure('SOMETHING', 504), { code: 'timeout' }],
    [
      'a 504 platform page (not JSON)',
      () => raw('<h1>Gateway Timeout</h1>', { status: 504 }),
      { code: 'timeout' },
    ],
    ['AI_NOT_CONFIGURED', () => failure('AI_NOT_CONFIGURED', 503), { code: 'unavailable' }],
    ['AI_UNAVAILABLE', () => failure('AI_UNAVAILABLE', 502), { code: 'unavailable' }],
    ['INTERNAL_ERROR', () => failure('INTERNAL_ERROR', 500), { code: 'unavailable' }],
    ['any other 5xx', () => failure('SOMETHING', 599), { code: 'unavailable' }],
    ['a 5xx page (not JSON)', () => raw('Bad Gateway', { status: 502 }), { code: 'unavailable' }],
    [
      'INVALID_RESPONSE (a 502, not unavailable)',
      () => failure('INVALID_RESPONSE', 502),
      { code: 'invalid' },
    ],
    ['INVALID_BRIEF', () => failure('INVALID_BRIEF', 400), { code: 'invalid' }],
    ['INVALID_JSON', () => failure('INVALID_JSON', 400), { code: 'invalid' }],
    ['REQUEST_CANCELLED', () => failure('REQUEST_CANCELLED', 499), { code: 'invalid' }],
    ['ORIGIN_REJECTED', () => failure('ORIGIN_REJECTED', 403), { code: 'invalid' }],
    ['NOT_FOUND', () => failure('NOT_FOUND', 404), { code: 'invalid' }],
    ['any other 4xx', () => failure('SOMETHING', 418), { code: 'invalid' }],
    ['a 4xx with an unparseable body', () => raw('nope', { status: 400 }), { code: 'invalid' }],
    ['a 4xx with an empty body', () => raw('', { status: 400 }), { code: 'invalid' }],
    [
      'a 429 from the platform (not JSON)',
      () => raw('slow down', { status: 429 }),
      { code: 'rate_limited' },
    ],
    [
      'a code that names an Object property',
      () => failure('constructor', 400),
      { code: 'invalid' },
    ],
    [
      'an error envelope of the wrong shape',
      () => json({ error: 'bad' }, { status: 500 }),
      { code: 'unavailable' },
    ],
    ['a 3xx', () => raw('moved', { status: 302 }), { code: 'invalid' }],
  ];

  it.each(cases)('%s', async (_name, answer, expected) => {
    const fetchImpl = serving(answer);
    const planner = client(fetchImpl);
    expect(failed(await planner.suggest(community(), never))).toStrictEqual(expected);
    // Never cached: the same brief goes back to the network.
    await planner.suggest(community(), never);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['60', 60],
    ['1', 1],
    ['3600', 3600],
    ['120', 120],
    ['abc', undefined],
    ['0', undefined],
    ['99999', undefined],
    ['3601', undefined],
    ['-5', undefined],
    ['1.5', undefined],
    ['1e2', undefined],
    ['', undefined],
    ['Wed, 21 Oct 2026 07:28:00 GMT', undefined],
  ])('reads Retry-After %j as %j', async (header, seconds) => {
    const planner = client(serving(() => failure('RATE_LIMITED', 429, { 'Retry-After': header })));
    const error = failed(await planner.suggest(community(), never));
    expect(error).toStrictEqual(
      seconds === undefined
        ? { code: 'rate_limited' }
        : { code: 'rate_limited', retryAfterSeconds: seconds },
    );
  });

  it('has no retryAfterSeconds when the header is absent, or for errors that are not rate limits', async () => {
    expect(
      failed(await client(serving(() => failure('RATE_LIMITED', 429))).suggest(community(), never)),
    ).toStrictEqual({ code: 'rate_limited' });
    const other = serving(() => failure('AI_UNAVAILABLE', 502, { 'Retry-After': '60' }));
    expect(failed(await client(other).suggest(community(), never))).toStrictEqual({
      code: 'unavailable',
    });
  });
});

describe('the network is untrusted', () => {
  const bad =
    (suggestions: unknown, meta: unknown = META) =>
    () =>
      json({ suggestions, meta });
  const withIdea = (patch: object) => ({
    ...SUGGESTIONS,
    ideas: [{ ...SUGGESTIONS.ideas[0], ...patch }],
  });

  it.each([
    ['an unknown category id', bad(withIdea({ categoryId: 'yacht' }))],
    ['a category from another template', bad(withIdea({ categoryId: 'catering' }))],
    ['an extra key in the suggestions', bad({ ...SUGGESTIONS, apiKey: 'leak' })],
    ['a wrong type in the suggestions', bad(withIdea({ estimatedCost: '5000' }))],
    ['missing suggestions', () => json({ meta: META })],
    ['missing meta', () => json({ suggestions: SUGGESTIONS })],
    ['a bad uuid in meta', bad(SUGGESTIONS, { ...META, requestId: 'not-a-uuid' })],
    ['a negative token count in meta', bad(SUGGESTIONS, { ...META, inputTokens: -1 })],
    ['an extra key in meta', bad(SUGGESTIONS, { ...META, secret: 'x' })],
    ['a body that is not JSON', () => raw('<html>oops</html>')],
    ['an empty body', () => raw('')],
    ['JSON null', () => json(null)],
    ['a JSON array', () => json([GOOD])],
    ['a bare string', () => json('ok')],
  ])('answers invalid, and caches nothing, for %s', async (_name, answer) => {
    const fetchImpl = serving(answer);
    const planner = client(fetchImpl);
    expect(failed(await planner.suggest(community(), never))).toStrictEqual({ code: 'invalid' });
    expect(failed(await planner.suggest(community(), never))).toStrictEqual({ code: 'invalid' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('validates against the template of the brief it asked about', async () => {
    const suggestionsWith = (categoryId: string, vendorId: string) => ({
      ...SUGGESTIONS,
      ideas: [{ ...SUGGESTIONS.ideas[0], categoryId }],
      weightHints: [{ categoryId, factor: 1 }],
      vendorQuestions: [{ vendorId, questions: ['Is it included?'] }],
    });
    const asked = async (b: EventBrief, suggestions: object) =>
      client(serving(bad(suggestions))).suggest(b, never);

    const wedding = suggestionsWith('catering', 'caterer');
    expect(succeeded(await asked(brief('wedding'), wedding)).suggestions).toEqual(wedding);
    const birthday = suggestionsWith('decor_theme', 'cake_bakery');
    expect(succeeded(await asked(brief('birthday'), birthday)).suggestions).toEqual(birthday);
    // Each template's ids are refused under another kind's brief.
    expect(failed(await asked(community(), wedding)).code).toBe('invalid');
    expect(failed(await asked(brief('wedding'), SUGGESTIONS)).code).toBe('invalid');
  });

  it('returns only the validated suggestions and meta, dropping unknown envelope keys', async () => {
    const planner = client(serving(() => json({ ...GOOD, debug: 'secret' })));
    expect(succeeded(await planner.suggest(community(), never))).toStrictEqual({
      ...GOOD,
      cached: false,
    });
  });

  it('does not let a good answer for one brief be served for another', async () => {
    const planner = client(serving());
    await planner.suggest(brief('community'), never);
    await planner.suggest(brief('wedding'), never);
    expect(planner.calls()).toBe(2);
  });
});
