/**
 * The HTTP contract of the planning API, end to end through `createHandler` with an injected
 * generator: one test per row of the request matrix, plus output sanitizing and log privacy.
 * Never calls the network.
 */
import { ApiError } from '@google/genai';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
  type MockInstance,
} from 'vitest';
import {
  createHandler,
  handlerFromEnv,
  type Env,
  type HandlerOptions,
} from '../../server/handler.js';
import { createMemoryLimits, type Limits } from '../../server/rate-limit.js';
import type { Generate } from '../../server/provider.js';
import { buildPlan } from '../../src/domain/plan.js';
import { buildPrompt } from '../../src/ai/prompt.js';
import { aiMetaSchema, eventBriefSchema, type EventBrief } from '../../src/shared/schema.js';
import { brief, TODAY } from '../support/fixtures.js';

// Only a handler built by `handlerFromEnv` reaches the SDK; every other test injects `generate`.
// The mock keeps that path offline too.
const sdk = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock('@google/genai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@google/genai')>()),
  GoogleGenAI: class {
    models = { generateContent: sdk.generateContent };
  },
}));

const ORIGIN = 'https://gatherwise.example';
const NOW = new Date('2026-10-21T10:00:00Z');

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
  extraTasks: [],
  vendorQuestions: [{ vendorId: 'tent_shamiana', questions: ['Is the tent rain-proof?'] }],
};

const answering = (text = JSON.stringify(SUGGESTIONS)) =>
  vi.fn<Generate>(() => Promise.resolve({ text, inputTokens: 300, outputTokens: 420 }));
const failing = (error: Error) => vi.fn<Generate>(() => Promise.reject(error));

const handlerWith = (options: HandlerOptions = {}) =>
  createHandler({ now: () => NOW, model: 'test-model', ...options });

function post(
  body: unknown = { brief: brief('community') },
  headers: Record<string, string> = {},
  init: RequestInit = {},
): Request {
  return new Request(`${ORIGIN}/api/plan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...init,
  });
}

/** The parsed `{ error: { code, message } }` envelope of a failed response. */
async function errorOf(response: Response): Promise<{ code: string; message: string }> {
  const body: unknown = await response.json();
  if (
    typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    typeof body.error === 'object' &&
    body.error !== null &&
    'code' in body.error &&
    'message' in body.error &&
    typeof body.error.code === 'string' &&
    typeof body.error.message === 'string'
  )
    return { code: body.error.code, message: body.error.message };
  throw new Error(`not an error envelope: ${JSON.stringify(body)}`);
}

let info: MockInstance<typeof console.info>;
let error: MockInstance<typeof console.error>;
let warn: MockInstance<typeof console.warn>;
beforeEach(() => {
  info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
  error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Limits that admit everything and record each check. */
const recording = (): { limits: Limits; request: Mock<Limits['request']> } => {
  const request = vi.fn<Limits['request']>(() => Promise.resolve());
  return { limits: { request, aiCall: () => Promise.resolve() }, request };
};

describe('request matrix', () => {
  it('405 with Allow: POST for a GET on the plan route, before anything else', async () => {
    const generate = answering();
    const response = await handlerWith({ generate })(new Request(`${ORIGIN}/api/plan`));
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    expect((await errorOf(response)).code).toBe('METHOD_NOT_ALLOWED');
    expect(generate).not.toHaveBeenCalled();
  });

  it('405 with Allow: GET for a POST to health', async () => {
    const response = await handlerWith()(new Request(`${ORIGIN}/api/health`, { method: 'POST' }));
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET');
  });

  it('415 for a text/plain body', async () => {
    const response = await handlerWith({ generate: answering() })(
      post(undefined, { 'content-type': 'text/plain' }),
    );
    expect(response.status).toBe(415);
    expect((await errorOf(response)).code).toBe('JSON_REQUIRED');
  });

  it('413 for a declared Content-Length over 64 KB', async () => {
    const response = await handlerWith({ generate: answering() })(
      post(undefined, { 'content-length': '70000' }),
    );
    expect(response.status).toBe(413);
    expect((await errorOf(response)).code).toBe('BODY_TOO_LARGE');
  });

  it('413 for a 70 KB streamed body with no Content-Length', async () => {
    const generate = answering();
    const big = new TextEncoder().encode(
      JSON.stringify({ brief: { ...brief('community'), notes: 'n'.repeat(70_000) } }),
    );
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(big);
        controller.close();
      },
    });
    // Node requires `duplex` for a streamed body; the DOM typings lack it.
    const init = { body, duplex: 'half' };
    const request = post(undefined, {}, init);
    expect(request.headers.get('content-length')).toBeNull();
    const response = await handlerWith({ generate })(request);
    expect(response.status).toBe(413);
    expect(generate).not.toHaveBeenCalled();
  });

  it('403 for a foreign Origin', async () => {
    const generate = answering();
    const response = await handlerWith({ generate })(
      post(undefined, { origin: 'https://evil.example' }),
    );
    expect(response.status).toBe(403);
    expect((await errorOf(response)).code).toBe('ORIGIN_REJECTED');
    expect(generate).not.toHaveBeenCalled();
  });

  it('403 for sec-fetch-site: cross-site', async () => {
    const response = await handlerWith({ generate: answering() })(
      post(undefined, { 'sec-fetch-site': 'cross-site' }),
    );
    expect(response.status).toBe(403);
  });

  it('with APP_ORIGIN set, accepts it and the own origin of the deployment, and nothing else', async () => {
    const app = 'https://gatherwise.vercel.app';
    const handler = handlerWith({ generate: answering(), origin: app });
    expect((await handler(post(undefined, { origin: app }))).status).toBe(200);
    // A preview deployment calls its own URL, which is not APP_ORIGIN.
    expect((await handler(post())).status).toBe(200);
    expect((await handler(post(undefined, { origin: 'https://evil.example' }))).status).toBe(403);
  });

  it('403 for a request with no Origin header', async () => {
    const generate = answering();
    // Built by hand: `post()` always sets an Origin.
    const request = new Request(`${ORIGIN}/api/plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ brief: brief('community') }),
    });
    const response = await handlerWith({ generate })(request);
    expect(response.status).toBe(403);
    expect((await errorOf(response)).code).toBe('ORIGIN_REJECTED');
    expect(generate).not.toHaveBeenCalled();
  });

  it('403 for an empty Origin header', async () => {
    const generate = answering();
    const response = await handlerWith({ generate })(post(undefined, { origin: '' }));
    expect(response.status).toBe(403);
    expect(generate).not.toHaveBeenCalled();
  });

  it('400 INVALID_JSON for a malformed body', async () => {
    const response = await handlerWith({ generate: answering() })(post('{"brief":'));
    expect(response.status).toBe(400);
    expect((await errorOf(response)).code).toBe('INVALID_JSON');
  });

  it('400 INVALID_BRIEF naming guests for guests: 0, with a generic message', async () => {
    const response = await handlerWith({ generate: answering() })(
      post({ brief: brief('community', { guests: 0 }) }),
    );
    expect(response.status).toBe(400);
    const body: unknown = await response.json();
    expect(body).toMatchObject({ error: { code: 'INVALID_BRIEF', fields: ['guests'] } });
    expect(JSON.stringify(body)).not.toMatch(/too_small|>=|number/u);
  });

  it('400 INVALID_BRIEF naming date for a date outside the window', async () => {
    for (const date of ['2026-10-19', '2028-10-23', '2026-02-30']) {
      const response = await handlerWith({ generate: answering() })(
        post({ brief: brief('community', { date }) }),
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: 'INVALID_BRIEF', fields: ['date'] },
      });
    }
  });

  it('429 RATE_LIMITED with Retry-After after ten requests in a minute', async () => {
    const handler = handlerWith({ generate: answering() });
    for (let i = 0; i < 10; i += 1) expect((await handler(post())).status).toBe(200);
    const limited = await handler(post());
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
    expect((await errorOf(limited)).code).toBe('RATE_LIMITED');
  });

  it('keys the rate limit on a hash of the forwarded address, never the raw IP', async () => {
    const { limits, request } = recording();
    await handlerWith({ generate: answering(), limits })(
      post(undefined, { 'x-vercel-forwarded-for': '203.0.113.7, 10.0.0.1' }),
    );
    expect(request).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f]{64}$/u), NOW.getTime());
    expect(JSON.stringify(request.mock.calls)).not.toContain('203.0.113.7');
  });

  it('503 AI_BUSY once the daily budget is spent, with Retry-After until UTC midnight', async () => {
    const generate = answering();
    const handler = handlerWith({ generate, limits: createMemoryLimits(2) });
    expect((await handler(post())).status).toBe(200);
    expect((await handler(post())).status).toBe(200);
    const spent = await handler(post());
    expect(spent.status).toBe(503);
    // NOW is 10:00 UTC, so midnight is 14 hours away.
    expect(spent.headers.get('retry-after')).toBe(String(14 * 3600));
    expect((await errorOf(spent)).code).toBe('AI_BUSY');
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('spends nothing from the daily budget on a request that never reaches the model', async () => {
    const limits = createMemoryLimits(1);
    const handler = handlerWith({ generate: answering(), limits });
    expect((await handler(post({ brief: brief('community', { guests: 0 }) }))).status).toBe(400);
    expect((await handlerWith({ limits })(post())).status).toBe(503);
    expect((await handler(post())).status).toBe(200);
  });

  it('429 CAPACITY_LIMITED with Retry-After on the fourth concurrent request', async () => {
    const releases: (() => void)[] = [];
    const generate = vi.fn<Generate>(
      () =>
        new Promise((resolve) =>
          releases.push(() => {
            resolve({ text: JSON.stringify(SUGGESTIONS), inputTokens: 1, outputTokens: 1 });
          }),
        ),
    );
    const handler = handlerWith({ generate });
    const held = Array.from({ length: 3 }, () => handler(post()));
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(3));
    const fourth = await handler(post());
    expect(fourth.status).toBe(429);
    expect(fourth.headers.get('retry-after')).toBe('60');
    expect((await errorOf(fourth)).code).toBe('CAPACITY_LIMITED');
    for (const release of releases) release();
    expect((await Promise.all(held)).map((r) => r.status)).toEqual([200, 200, 200]);
    expect(generate).toHaveBeenCalledTimes(3);
  });

  it('503 AI_NOT_CONFIGURED without a generator', async () => {
    const response = await handlerWith()(post());
    expect(response.status).toBe(503);
    expect((await errorOf(response)).code).toBe('AI_NOT_CONFIGURED');
  });

  it('502 AI_UNAVAILABLE with a generic message when the generator throws', async () => {
    const response = await handlerWith({
      generate: failing(new Error('upstream 500: internal stack at gemini.js:12 key=abc')),
    })(post());
    expect(response.status).toBe(502);
    const { code, message } = await errorOf(response);
    expect(code).toBe('AI_UNAVAILABLE');
    expect(message).not.toMatch(/upstream|stack|key=/u);
  });

  it('503 AI_BUSY with Retry-After when the SDK reports a spent quota (ApiError 429)', async () => {
    const quota = new ApiError({
      message: '{"error":{"status":"RESOURCE_EXHAUSTED"}}',
      status: 429,
    });
    const response = await handlerWith({ generate: failing(quota) })(post());
    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('60');
    expect((await errorOf(response)).code).toBe('AI_BUSY');
  });

  it.each([
    ['an ApiError with another status', new ApiError({ message: 'upstream', status: 500 })],
    [
      'a plain error that only looks like a 429',
      Object.assign(new Error('quota'), { status: 429 }),
    ],
  ])('502 AI_UNAVAILABLE for %s', async (_name, failure) => {
    const response = await handlerWith({ generate: failing(failure) })(post());
    expect(response.status).toBe(502);
    expect((await errorOf(response)).code).toBe('AI_UNAVAILABLE');
  });

  it('502 AI_UNAVAILABLE, not 500, when inspecting the error itself throws', async () => {
    const hostile = new Proxy(new Error('trap'), {
      has() {
        throw new Error('has trap');
      },
      get() {
        throw new Error('get trap');
      },
    });
    const response = await handlerWith({ generate: failing(hostile) })(post());
    expect(response.status).toBe(502);
    expect((await errorOf(response)).code).toBe('AI_UNAVAILABLE');
  });

  it('frees its slot after every failure: three failures in a row, then a success', async () => {
    const generate = vi
      .fn<Generate>()
      .mockRejectedValueOnce(new Error('one'))
      .mockRejectedValueOnce(new Error('two'))
      .mockRejectedValueOnce(new Error('three'))
      .mockResolvedValue({ text: JSON.stringify(SUGGESTIONS), inputTokens: 1, outputTokens: 1 });
    const handler = handlerWith({ generate });
    for (let i = 0; i < 3; i += 1) expect((await handler(post())).status).toBe(502);
    expect((await handler(post())).status).toBe(200);
  });

  it.each(['AbortError', 'TimeoutError'])(
    '504 AI_TIMEOUT when the SDK times out with %s',
    async (name) => {
      const response = await handlerWith({
        generate: failing(new DOMException('The operation was aborted.', name)),
      })(post());
      expect(response.status).toBe(504);
      expect((await errorOf(response)).code).toBe('AI_TIMEOUT');
    },
  );

  it('499 without calling the generator when the client aborted before', async () => {
    const generate = answering();
    const response = await handlerWith({ generate })(
      post(undefined, {}, { signal: AbortSignal.abort() }),
    );
    expect(response.status).toBe(499);
    expect((await errorOf(response)).code).toBe('REQUEST_CANCELLED');
    expect(generate).not.toHaveBeenCalled();
  });

  it('499 when the client aborts while the model is working, passing the signal through', async () => {
    const controller = new AbortController();
    const generate = vi.fn<Generate>(
      (_prompt, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );
    const pending = handlerWith({ generate })(post(undefined, {}, { signal: controller.signal }));
    await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce());
    controller.abort();
    expect((await pending).status).toBe(499);
  });

  it('502 INVALID_RESPONSE when the model returns text that is not JSON', async () => {
    const response = await handlerWith({ generate: answering('Sure! Here are ideas:') })(post());
    expect(response.status).toBe(502);
    expect((await errorOf(response)).code).toBe('INVALID_RESPONSE');
  });

  it('200 without the one item that names an unknown category, and the drop is logged', async () => {
    const [idea] = SUGGESTIONS.ideas;
    const bad = { ...SUGGESTIONS, ideas: [{ ...idea, categoryId: 'yacht' }, idea] };
    const response = await handlerWith({ generate: answering(JSON.stringify(bad)) })(post());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ suggestions: SUGGESTIONS });
    expect(JSON.parse(String(info.mock.calls[0]?.[0]))).toMatchObject({ status: 200, dropped: 1 });
  });

  it('502 INVALID_RESPONSE when nothing in the answer is usable', async () => {
    const empty = { summary: '', ideas: [{ categoryId: 'yacht' }], extraTasks: [] };
    const response = await handlerWith({ generate: answering(JSON.stringify(empty)) })(post());
    expect(response.status).toBe(502);
    expect((await errorOf(response)).code).toBe('INVALID_RESPONSE');
  });

  it('502 INVALID_RESPONSE, logged as truncated, when the model stopped at its output cap', async () => {
    const cut = JSON.stringify(SUGGESTIONS).slice(0, 80);
    const generate = vi.fn<Generate>(() =>
      Promise.resolve({ text: cut, inputTokens: 900, outputTokens: 4096, truncated: true }),
    );
    const response = await handlerWith({ generate })(post());
    expect(response.status).toBe(502);
    expect((await errorOf(response)).code).toBe('INVALID_RESPONSE');
    expect(JSON.parse(String(error.mock.calls[0]?.[0]))).toMatchObject({
      status: 502,
      code: 'INVALID_RESPONSE',
      event: 'truncated',
      outputTokens: 4096,
    });
  });

  it('still uses a truncated answer that parses, and logs that it was truncated', async () => {
    const generate = vi.fn<Generate>(() =>
      Promise.resolve({
        text: JSON.stringify(SUGGESTIONS),
        inputTokens: 1,
        outputTokens: 1,
        truncated: true,
      }),
    );
    expect((await handlerWith({ generate })(post())).status).toBe(200);
    expect(JSON.parse(String(info.mock.calls[0]?.[0]))).toMatchObject({ event: 'truncated' });
  });

  it('200 with suggestions, validated meta and no-store for a valid request', async () => {
    const generate = answering();
    const response = await handlerWith({ generate })(post());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body: unknown = await response.json();
    expect(body).toMatchObject({ suggestions: SUGGESTIONS });
    const meta = aiMetaSchema.parse(
      typeof body === 'object' && body !== null && 'meta' in body ? body.meta : undefined,
    );
    expect(meta).toMatchObject({ model: 'test-model', inputTokens: 300, outputTokens: 420 });
    expect(generate).toHaveBeenCalledOnce();
    const [prompt, signal] = generate.mock.calls[0] ?? [];
    expect(prompt?.user).toContain('Maple Court Diwali Mela');
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it.each(['community', 'wedding', 'birthday'] as const)(
    'sends the generator exactly the shared prompt for a %s brief, byte for byte',
    async (kind) => {
      // The UI rebuilds the prompt locally from the same pure function and shows it as "sent";
      // this pins that what it shows is what the server really sent.
      const generate = answering();
      await handlerWith({ generate })(post({ brief: brief(kind) }));
      const plan = buildPlan(eventBriefSchema.parse(brief(kind)), TODAY);
      if (!plan.ok) throw new Error('fixture brief must plan');
      const [sent] = generate.mock.calls[0] ?? [];
      expect(sent).toStrictEqual(buildPrompt(plan.value));
      expect(JSON.stringify(sent)).toBe(JSON.stringify(buildPrompt(plan.value)));
    },
  );

  it('sends the generator exactly the shared prompt for an adjustment, byte for byte', async () => {
    const generate = answering();
    const adjust = { change: 'Make it cheaper', previous: SUGGESTIONS };
    const response = await handlerWith({ generate })(post({ brief: brief('community'), adjust }));
    expect(response.status).toBe(200);
    const plan = buildPlan(eventBriefSchema.parse(brief('community')), TODAY);
    if (!plan.ok) throw new Error('fixture brief must plan');
    const [sent] = generate.mock.calls[0] ?? [];
    expect(JSON.stringify(sent)).toBe(JSON.stringify(buildPrompt(plan.value, adjust)));
    expect(sent?.user).toContain('"change":"Make it cheaper"');
  });

  it('400 INVALID_ADJUSTMENT, before any model call, for a change over 200 characters', async () => {
    const generate = answering();
    const adjust = { change: 'x'.repeat(201) };
    const response = await handlerWith({ generate })(post({ brief: brief('community'), adjust }));
    expect(response.status).toBe(400);
    expect((await errorOf(response)).code).toBe('INVALID_ADJUSTMENT');
    expect(generate).not.toHaveBeenCalled();
  });

  it('502 INVALID_RESPONSE if the metadata would break its own contract', async () => {
    for (const model of ['', 'm'.repeat(81)]) {
      const response = await handlerWith({ generate: answering(), model })(post());
      expect(response.status).toBe(502);
      expect((await errorOf(response)).code).toBe('INVALID_RESPONSE');
    }
    const negative = vi.fn<Generate>(() =>
      Promise.resolve({ text: JSON.stringify(SUGGESTIONS), inputTokens: -1, outputTokens: 1 }),
    );
    expect((await handlerWith({ generate: negative })(post())).status).toBe(502);
  });

  it('404 with a static message that never echoes the path', async () => {
    const response = await handlerWith()(new Request(`${ORIGIN}/api/secret-<b>path</b>`));
    expect(response.status).toBe(404);
    expect(await response.clone().text()).not.toMatch(/secret|path/u);
    expect(await errorOf(response)).toEqual({
      code: 'NOT_FOUND',
      message: 'This endpoint does not exist.',
    });
  });

  it('reports health in both states, with no-store and nothing else', async () => {
    const off = await handlerWith()(new Request(`${ORIGIN}/api/health`));
    expect(off.status).toBe(200);
    expect(off.headers.get('cache-control')).toBe('no-store');
    expect(await off.json()).toEqual({ status: 'ok', ai: 'not_configured' });
    const on = await handlerWith({ generate: answering() })(new Request(`${ORIGIN}/api/health`));
    expect(await on.json()).toEqual({ status: 'ok', ai: 'configured' });
  });

  it('500 INTERNAL_ERROR with a generic message for an unexpected bug', async () => {
    const limits: Limits = {
      request: () => {
        throw new Error('private operational detail');
      },
      aiCall: () => Promise.resolve(),
    };
    const response = await handlerWith({ generate: answering(), limits })(post());
    expect(response.status).toBe(500);
    const { code, message } = await errorOf(response);
    expect(code).toBe('INTERNAL_ERROR');
    expect(message).not.toContain('private');
    // Traceable in the logs as an internal fault, still without the thrown message.
    expect(error).toHaveBeenCalledOnce();
    const line = String(error.mock.calls[0]?.[0]);
    expect(line).not.toContain('private');
    expect(JSON.parse(line)).toMatchObject({
      status: 500,
      code: 'INTERNAL_ERROR',
      kind: 'internal',
    });
  });
});

describe('output sanitizing', () => {
  it('strips markup and control characters from model strings before they leave the server', async () => {
    const hostile = {
      ...SUGGESTIONS,
      summary: 'Plan\u0007 <iframe src=//evil.example></iframe>ready',
      ideas: [{ ...SUGGESTIONS.ideas[0], title: '<script>alert(1)</script>Lantern walk' }],
    };
    const response = await handlerWith({ generate: answering(JSON.stringify(hostile)) })(post());
    const text = await response.text();
    expect(text).not.toMatch(/<|>|script>|iframe|\\u0007/u);
    expect(JSON.parse(text)).toMatchObject({
      suggestions: { summary: 'Plan ready', ideas: [{ title: 'alert(1) Lantern walk' }] },
    });
  });
});

describe('request logging', () => {
  const lines = () => [...info.mock.calls, ...error.mock.calls].map(([line]) => String(line));

  it('writes one JSON line per request and never the brief text or the model text', async () => {
    const secret: EventBrief = brief('community', {
      name: 'Zebra Secret Gala',
      notes: 'private-note-xyz',
      vibe: 'velvet-vibe-qrs',
      city: 'Hidden City',
    });
    const okText = JSON.stringify({ ...SUGGESTIONS, summary: 'MODEL-TEXT-MARKER' });
    await handlerWith({ generate: answering(okText) })(post({ brief: secret }));
    await handlerWith({ generate: answering('MODEL-GARBAGE-MARKER') })(post({ brief: secret }));
    await handlerWith({ generate: failing(new Error('PROVIDER-MESSAGE-MARKER')) })(
      post({ brief: secret }),
    );

    expect(info).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledTimes(2);
    for (const line of lines()) {
      expect(line).not.toMatch(/Zebra|private-note|velvet|Hidden City|MARKER/u);
      expect(JSON.parse(line)).toHaveProperty('requestId', expect.any(String));
    }
    const [success, invalid, unavailable] = lines().map((line): unknown => JSON.parse(line));
    expect(success).toMatchObject({
      route: '/api/plan',
      status: 200,
      eventKind: 'community',
      inputTokens: 300,
      outputTokens: 420,
    });
    expect(success).not.toHaveProperty('kind');
    expect(success).not.toHaveProperty('event');
    expect(success).not.toHaveProperty('dropped');
    expect(success).toHaveProperty('latencyMs', expect.any(Number));
    expect(invalid).toMatchObject({ status: 502, code: 'INVALID_RESPONSE', inputTokens: 300 });
    expect(unavailable).toMatchObject({ status: 502, code: 'AI_UNAVAILABLE' });
  });

  it('labels unknown paths without logging them', async () => {
    await handlerWith()(new Request(`${ORIGIN}/api/../../etc/passwd-probe`));
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).not.toContain('passwd');
    expect(JSON.parse(lines()[0] ?? '')).toMatchObject({ route: 'unknown', status: 404 });
  });
});

describe('default clock', () => {
  it('checks the date window against the real clock when none is injected', async () => {
    const soon = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    const handler = createHandler({ generate: answering() });
    expect((await handler(post({ brief: brief('community', { date: soon }) }))).status).toBe(200);
    expect(
      (await handler(post({ brief: brief('community', { date: '2020-01-01' }) }))).status,
    ).toBe(400);
  });
});

describe('handlerFromEnv', () => {
  const health = async (env: Env): Promise<unknown> => {
    const response = await handlerFromEnv(env)(new Request(`${ORIGIN}/api/health`));
    const body: unknown = await response.json();
    return body;
  };
  const soon = () => new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  /** `meta.model` of a successful plan through a handler built from `env` (SDK mocked above). */
  const reportedModel = async (env: Env, origin = ORIGIN): Promise<unknown> => {
    sdk.generateContent.mockResolvedValue({ text: JSON.stringify(SUGGESTIONS) });
    const response = await handlerFromEnv(env)(
      post({ brief: brief('community', { date: soon() }) }, { origin }),
    );
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    return typeof body === 'object' && body !== null && 'meta' in body
      ? aiMetaSchema.parse(body.meta).model
      : undefined;
  };

  it.each<[string, Env]>([
    ['unset', {}],
    ['blank', { GEMINI_API_KEY: '   ' }],
  ])('is not configured when GEMINI_API_KEY is %s', async (_name, env) => {
    await expect(health(env)).resolves.toEqual({ status: 'ok', ai: 'not_configured' });
  });

  it('counts in memory without a shared store, and says so once when it is built', () => {
    handlerFromEnv({ KV_REST_API_URL: 'https://store.example' });
    expect(warn).toHaveBeenCalledOnce();
    expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toEqual({
      event: 'limiter_fallback',
      reason: 'not_configured',
    });
  });

  it.each<[string, Env]>([
    [
      'the Vercel Marketplace names',
      { KV_REST_API_URL: 'https://kv.example', KV_REST_API_TOKEN: 't1' },
    ],
    [
      'the Upstash names',
      { UPSTASH_REDIS_REST_URL: 'https://kv.example', UPSTASH_REDIS_REST_TOKEN: 't1' },
    ],
  ])('counts in the shared store configured with %s', async (_name, env) => {
    const store = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json([{ result: 1 }, { result: 1 }])),
    );
    vi.stubGlobal('fetch', store);
    const response = await handlerFromEnv(env)(post());
    expect(response.status).toBe(503);
    expect((await errorOf(response)).code).toBe('AI_NOT_CONFIGURED');
    expect(store).toHaveBeenCalledOnce();
    const [url, init] = store.mock.calls[0] ?? [];
    expect(url).toBe('https://kv.example/pipeline');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer t1');
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ['1', 1],
    ['0', 300],
    ['many', 300],
    [' 2 ', 2],
  ])('reads AI_DAILY_LIMIT %j as a budget of %i calls', async (value, budget) => {
    sdk.generateContent.mockResolvedValue({ text: JSON.stringify(SUGGESTIONS) });
    const handler = handlerFromEnv({
      GEMINI_API_KEY: 'test-key-not-a-secret',
      AI_DAILY_LIMIT: value,
    });
    const plan = () => handler(post({ brief: brief('community', { date: soon() }) }));
    const statuses: number[] = [];
    for (let i = 0; i < Math.min(budget, 2) + 1; i += 1) statuses.push((await plan()).status);
    expect(statuses).toEqual(
      budget === 1 ? [200, 503] : budget === 2 ? [200, 200, 503] : [200, 200, 200],
    );
  });

  it('is configured with a key, and honours a model override and APP_ORIGIN', async () => {
    const app = 'https://gatherwise.vercel.app';
    const env: Env = {
      GEMINI_API_KEY: 'test-key-not-a-secret',
      GEMINI_MODEL: 'gemini-test',
      APP_ORIGIN: ` ${app} `,
    };
    await expect(health(env)).resolves.toEqual({ status: 'ok', ai: 'configured' });
    await expect(reportedModel(env, app)).resolves.toBe('gemini-test');
    expect(sdk.generateContent).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gemini-test' }),
    );
  });

  it.each([
    ['unset', undefined],
    ['blank', '   '],
  ])('uses gemini-3.5-flash-lite when GEMINI_MODEL is %s', async (_name, value) => {
    const env: Env = { GEMINI_API_KEY: 'test-key-not-a-secret', GEMINI_MODEL: value };
    await expect(reportedModel(env)).resolves.toBe('gemini-3.5-flash-lite');
    expect(sdk.generateContent).toHaveBeenLastCalledWith(
      expect.objectContaining({ model: 'gemini-3.5-flash-lite' }),
    );
  });
});
