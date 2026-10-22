/**
 * Tests for scripts/live-checks.ts, the checks behind the opt-in `npm run test:live`.
 * Does: run the whole smoke against a stand-in deployment built from the real handler (with a
 * fake model), the real index.html and the headers vercel.json sends, so a change to any of them
 * that the live run would catch fails here first; then each check's failure paths, and that a
 * failure message never carries model text.
 * Never does: touch the network or a real model.
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  checkHeaders,
  checkHealth,
  checkPage,
  checkPlan,
  MAX_LATENCY_MS,
  runLiveSmoke,
  type Fetcher,
} from '../../scripts/live-checks.js';
import { createHandler } from '../../server/handler.js';
import type { Generate } from '../../server/provider.js';
import { aiMeta, aiSuggestions, TODAY } from '../support/fixtures.js';

const ORIGIN = 'https://gatherwise.example';
const NOW = new Date('2026-10-21T10:00:00Z');

const html = readFileSync('index.html', 'utf8');
const vercel = z
  .object({
    headers: z.array(
      z.object({
        source: z.string(),
        headers: z.array(z.object({ key: z.string(), value: z.string() })),
      }),
    ),
  })
  .parse(JSON.parse(readFileSync('vercel.json', 'utf8')));

/** The headers Vercel adds to `path`, from vercel.json's rules. */
const platformHeaders = (path: string): [string, string][] =>
  vercel.headers
    .filter(({ source }) => new RegExp(`^${source}$`, 'u').test(path))
    .flatMap(({ headers }) => headers.map(({ key, value }): [string, string] => [key, value]));

/** A stand-in deployment: the real handler for /api, index.html for the page, Vercel's headers. */
function deployment(generate?: Generate): Fetcher {
  const handler = createHandler({
    now: () => NOW,
    model: 'test-model',
    ...(generate ? { generate } : {}),
  });
  return async (url, init) => {
    const { pathname } = new URL(url);
    const response = pathname.startsWith('/api/')
      ? await handler(new Request(url, init))
      : new Response(html, { headers: { 'content-type': 'text/html' } });
    const headers = new Headers(response.headers);
    for (const [key, value] of platformHeaders(pathname)) headers.set(key, value);
    return new Response(response.body, { status: response.status, headers });
  };
}

const answering = (text = JSON.stringify(aiSuggestions)): Generate =>
  vi.fn<Generate>(() => Promise.resolve({ text, inputTokens: 300, outputTokens: 420 }));

const goodHeaders = (): Headers =>
  new Headers({
    'content-security-policy': "default-src 'self'",
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    'cache-control': 'no-store',
  });

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('runLiveSmoke against a stand-in deployment', () => {
  it('passes with the real handler, index.html and vercel.json headers, and says what it saw', async () => {
    const generate = answering();
    const result = await runLiveSmoke(ORIGIN, deployment(generate), TODAY);
    expect(result.failures).toEqual([]);
    expect(result.summary).toMatch(
      /^model test-model, \d+ ms, tokens 300 in \/ 420 out, 2 ideas$/u,
    );
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('sends one same-origin JSON request for the community sample, and nothing else to the model', async () => {
    const deploy = deployment(answering());
    const seen: { url: string; init: RequestInit | undefined }[] = [];
    const spy: Fetcher = (url, init) => {
      seen.push({ url, init });
      return deploy(url, init);
    };
    await runLiveSmoke(`${ORIGIN}/some/path?x=1`, spy, TODAY);
    expect(seen.map(({ url }) => url)).toEqual([
      `${ORIGIN}/api/health`,
      `${ORIGIN}/`,
      `${ORIGIN}/api/plan`,
    ]);
    const post = seen[2]?.init;
    expect(post?.method).toBe('POST');
    expect(post?.headers).toEqual({ 'Content-Type': 'application/json', Origin: ORIGIN });
    const sent: unknown = JSON.parse(typeof post?.body === 'string' ? post.body : '');
    expect(sent).toMatchObject({ brief: { kind: 'community', date: '2027-01-04' } });
  });

  it('fails each check that a half-configured deployment breaks, without hiding the others', async () => {
    const result = await runLiveSmoke(ORIGIN, deployment(), TODAY);
    expect(result.summary).toBeUndefined();
    expect(result.failures).toEqual([
      "GET /api/health is not {status: 'ok', ai: 'configured'} (is GEMINI_API_KEY set?)",
      'POST /api/plan answered 503 (AI_NOT_CONFIGURED), expected 200',
    ]);
  });

  it('reports an answer the model could not make usable by status and code only', async () => {
    const result = await runLiveSmoke(ORIGIN, deployment(answering('not json')), TODAY);
    expect(result.failures).toEqual([
      'POST /api/plan answered 502 (INVALID_RESPONSE), expected 200',
    ]);
  });

  it('turns a network failure into a failure for each request, not a crash', async () => {
    const down: Fetcher = () => Promise.reject(new TypeError('fetch failed'));
    const result = await runLiveSmoke(ORIGIN, down, TODAY);
    expect(result.failures).toEqual([
      'GET /api/health failed: TypeError',
      'GET / failed: TypeError',
      'POST /api/plan failed: TypeError',
    ]);
  });
});

describe('checkHeaders', () => {
  it('accepts a CSP without unsafe-, nosniff, DENY and same-origin isolation', () => {
    expect(checkHeaders(goodHeaders())).toEqual([]);
  });

  it.each([
    ['a missing CSP', 'content-security-policy', null, 'Content-Security-Policy is missing'],
    [
      'unsafe-inline',
      'content-security-policy',
      "script-src 'self' 'unsafe-inline'",
      "Content-Security-Policy contains 'unsafe-'",
    ],
    ['no nosniff', 'x-content-type-options', null, 'X-Content-Type-Options is not nosniff'],
    ['a frameable page', 'x-frame-options', 'SAMEORIGIN', 'X-Frame-Options is not DENY'],
    [
      'no opener isolation',
      'cross-origin-opener-policy',
      null,
      'Cross-Origin-Opener-Policy is not same-origin',
    ],
    [
      'a cross-origin-readable resource',
      'cross-origin-resource-policy',
      'cross-origin',
      'Cross-Origin-Resource-Policy is not same-origin',
    ],
  ])('fails %s', (_name, header, value, failure) => {
    const headers = goodHeaders();
    if (value === null) headers.delete(header);
    else headers.set(header, value);
    expect(checkHeaders(headers)).toEqual([failure]);
  });
});

describe('checkHealth', () => {
  it('accepts exactly ok and configured', () => {
    expect(checkHealth(200, { status: 'ok', ai: 'configured' })).toEqual([]);
  });

  it.each([
    [200, { status: 'ok', ai: 'not_configured' }],
    [200, { status: 'ok', ai: 'configured', extra: 1 }],
    [200, undefined],
  ])('rejects %j %j', (status, body) => {
    expect(checkHealth(status, body)).toHaveLength(1);
  });

  it('rejects a non-200 by its status', () => {
    expect(checkHealth(500, undefined)).toEqual(['GET /api/health answered 500, expected 200']);
  });
});

describe('checkPage', () => {
  it('accepts the real page', () => {
    expect(checkPage(200, `${ORIGIN}/`, html)).toEqual([]);
  });

  it('calls a redirect to Vercel login a login wall', () => {
    const failures = checkPage(200, 'https://vercel.com/sso-api?url=x', '<title>Login</title>');
    expect(failures).toEqual([
      'GET / ended at a Vercel login page (turn off SSO protection for production)',
    ]);
  });

  it('calls a 401 that asks for Vercel authentication a login wall', () => {
    const wall = '<title>Authentication Required</title><a href="https://vercel.com/sso-api">';
    expect(checkPage(401, `${ORIGIN}/`, wall)).toEqual([
      'GET / ended at a Vercel login page (turn off SSO protection for production)',
    ]);
    // A 401 that says nothing of Vercel is just a failed status.
    expect(checkPage(401, `${ORIGIN}/`, '<title>x</title>')).toContain(
      'GET / answered 401, expected 200',
    );
  });

  it('wants a 200, a title and the noscript feature text', () => {
    expect(checkPage(404, `${ORIGIN}/`, '<html></html>')).toEqual([
      'GET / answered 404, expected 200',
      'GET / has no <title>',
      'GET / has no <noscript> feature text',
    ]);
    // The words outside <noscript> do not count: a crawler that reads the page as text needs them
    // there.
    expect(checkPage(200, `${ORIGIN}/`, '<title>x</title><p>Budgets that reconcile</p>')).toEqual([
      'GET / has no <noscript> feature text',
    ]);
  });
});

describe('checkPlan', () => {
  const good = { suggestions: aiSuggestions, meta: aiMeta };

  it('summarizes a good answer without quoting any of its text', () => {
    const { failures, summary } = checkPlan(200, goodHeaders(), good, 1234);
    expect(failures).toEqual([]);
    expect(summary).toBe(
      'model gemini-3.5-flash-lite, 1234 ms, tokens 1075 in / 1018 out, 2 ideas',
    );
  });

  it('fails a slow answer, and one that may be cached', () => {
    const headers = goodHeaders();
    headers.set('cache-control', 'public, max-age=60');
    const { failures } = checkPlan(200, headers, good, MAX_LATENCY_MS);
    expect(failures).toEqual([
      'POST /api/plan is not Cache-Control: no-store',
      'POST /api/plan took 20.0 s, the limit is 20 s',
    ]);
  });

  it('puts the API response through the security header check too', () => {
    const headers = goodHeaders();
    headers.delete('x-frame-options');
    expect(checkPlan(200, headers, good, 10).failures).toEqual([
      'POST /api/plan: X-Frame-Options is not DENY',
    ]);
  });

  it('names a body that breaks the schema by path and code, never by value', () => {
    const body = { suggestions: { ...aiSuggestions, ideas: 'SECRET MODEL TEXT' }, meta: aiMeta };
    const { failures, summary } = checkPlan(200, goodHeaders(), body, 10);
    expect(summary).toBeUndefined();
    expect(failures).toEqual([
      'POST /api/plan body does not match the response schema: suggestions.ideas [invalid_type]',
    ]);
    expect(failures.join()).not.toContain('SECRET');
  });

  it('refuses an id the template does not have, since the model must not invent them', () => {
    const idea = { ...aiSuggestions.ideas[0], categoryId: 'fireworks' };
    const body = { suggestions: { ...aiSuggestions, ideas: [idea] }, meta: aiMeta };
    expect(checkPlan(200, goodHeaders(), body, 10).failures).toEqual([
      'POST /api/plan body does not match the response schema: suggestions.ideas.0.categoryId [invalid_value]',
    ]);
  });

  it('reports an error answer by status and its catalog code only', () => {
    const body = { error: { code: 'RATE_LIMITED', message: 'Too many plans' } };
    expect(checkPlan(429, goodHeaders(), body, 10).failures).toEqual([
      'POST /api/plan answered 429 (RATE_LIMITED), expected 200',
    ]);
    // A code that is not in the catalog's shape is not echoed.
    expect(checkPlan(500, goodHeaders(), { error: { code: 'oops <b>' } }, 10).failures).toEqual([
      'POST /api/plan answered 500, expected 200',
    ]);
  });
});
