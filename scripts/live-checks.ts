/**
 * The checks behind the opt-in live smoke test (scripts/live-smoke.ts), kept free of the
 * environment and the console so tests/unit/live-checks.test.ts can run them offline, against the
 * real handler with a stand-in model.
 * Does: check a deployment's health, its landing page (not a login wall, a title and the noscript
 * feature text), its security headers, and one real plan request: 200, `no-store`, a body that
 * parses against the community response schema and metadata schema, and a latency under 20 s.
 * Every check returns failures as plain sentences; an empty list is a pass.
 * Never does: read `process.env`, print, or put brief text, model text or a key in a message (a
 * body that fails to parse is reported by field path and issue code only).
 */
import { z } from 'zod';
import type { IsoDate } from '../src/domain/dates.js';
import { sampleBrief } from '../src/features/brief/samples.js';
import { suggestionsSchemaFor } from '../src/shared/prompt.js';
import { aiMetaSchema } from '../src/shared/schema.js';

/** A plan call slower than this fails the smoke test (the server's own model timeout is 20 s). */
export const MAX_LATENCY_MS = 20_000;
/** Each request is abandoned after this long, so a hung deployment fails instead of waiting. */
const REQUEST_TIMEOUT_MS = 30_000;

/** The part of `fetch` the smoke test uses; tests pass a stand-in deployment. */
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/** What a run found: every failure, and the PASS line's facts when the plan call parsed. */
export interface SmokeResult {
  readonly failures: readonly string[];
  /** `model …, … ms, tokens …, … ideas`, or `undefined` when the plan call did not parse. */
  readonly summary: string | undefined;
}

const planResponse = z.strictObject({
  suggestions: suggestionsSchemaFor('community'),
  meta: aiMetaSchema,
});
const healthResponse = z.strictObject({ status: z.literal('ok'), ai: z.literal('configured') });
const errorResponse = z.object({ error: z.object({ code: z.string().regex(/^[A-Z_]+$/u) }) });

/** The CSP directive that makes the browser refuse a plain string at a script sink. */
const TRUSTED_TYPES = "require-trusted-types-for 'script'";

/**
 * A response's security headers: a CSP without `unsafe-` that requires Trusted Types for script,
 * nosniff, frame denial and same-origin opener and resource policies.
 */
export function checkHeaders(headers: Headers): string[] {
  const failures: string[] = [];
  const csp = headers.get('content-security-policy');
  if (csp === null) failures.push('Content-Security-Policy is missing');
  else {
    if (csp.includes('unsafe-')) failures.push("Content-Security-Policy contains 'unsafe-'");
    if (!csp.includes(TRUSTED_TYPES)) {
      failures.push(`Content-Security-Policy lacks ${TRUSTED_TYPES}`);
    }
  }
  if (headers.get('x-content-type-options')?.toLowerCase() !== 'nosniff') {
    failures.push('X-Content-Type-Options is not nosniff');
  }
  if (headers.get('x-frame-options')?.toUpperCase() !== 'DENY') {
    failures.push('X-Frame-Options is not DENY');
  }
  if (headers.get('cross-origin-opener-policy') !== 'same-origin') {
    failures.push('Cross-Origin-Opener-Policy is not same-origin');
  }
  if (headers.get('cross-origin-resource-policy') !== 'same-origin') {
    failures.push('Cross-Origin-Resource-Policy is not same-origin');
  }
  return failures;
}

/** `/api/health` must say the app is up and the AI key is configured. */
export function checkHealth(status: number, body: unknown): string[] {
  if (status !== 200) return [`GET /api/health answered ${status}, expected 200`];
  return healthResponse.safeParse(body).success
    ? []
    : ["GET /api/health is not {status: 'ok', ai: 'configured'} (is GEMINI_API_KEY set?)"];
}

/** What Vercel's deployment protection answers with when it blocks a request outright (a 401). */
const SSO_BODY = /vercel\.com\/sso|Authentication Required/iu;

/**
 * The landing page: reached without a login wall (a redirect to Vercel's SSO page, or a 401 whose
 * body asks for authentication), with a title and the noscript feature text.
 */
export function checkPage(status: number, finalUrl: string, html: string): string[] {
  const loginWall = /vercel\.com\/sso/iu.test(finalUrl) || (status === 401 && SSO_BODY.test(html));
  if (loginWall) {
    return ['GET / ended at a Vercel login page (turn off SSO protection for production)'];
  }
  const failures: string[] = [];
  if (status !== 200) failures.push(`GET / answered ${status}, expected 200`);
  if (!/<title>[^<]+<\/title>/iu.test(html)) failures.push('GET / has no <title>');
  if (!/<noscript>[\s\S]*Budgets that reconcile[\s\S]*<\/noscript>/iu.test(html)) {
    failures.push('GET / has no <noscript> feature text');
  }
  return failures;
}

/** The plan call: 200, `no-store`, security headers, a parsing body and a latency under the cap. */
export function checkPlan(
  status: number,
  headers: Headers,
  body: unknown,
  latencyMs: number,
): SmokeResult {
  const failures = checkHeaders(headers).map((failure) => `POST /api/plan: ${failure}`);
  if (headers.get('cache-control') !== 'no-store') {
    failures.push('POST /api/plan is not Cache-Control: no-store');
  }
  if (latencyMs >= MAX_LATENCY_MS) {
    failures.push(
      `POST /api/plan took ${(latencyMs / 1000).toFixed(1)} s, the limit is ${MAX_LATENCY_MS / 1000} s`,
    );
  }
  if (status !== 200) {
    const code = errorResponse.safeParse(body).data?.error.code;
    failures.push(
      `POST /api/plan answered ${status}${code === undefined ? '' : ` (${code})`}, expected 200`,
    );
    return { failures, summary: undefined };
  }
  const parsed = planResponse.safeParse(body);
  if (!parsed.success) {
    const where = parsed.error.issues.map((i) => `${i.path.join('.') || 'body'} [${i.code}]`);
    failures.push(`POST /api/plan body does not match the response schema: ${where.join(', ')}`);
    return { failures, summary: undefined };
  }
  const { meta, suggestions } = parsed.data;
  const tokens = `${meta.inputTokens} in / ${meta.outputTokens} out`;
  const ideas = suggestions.ideas.length;
  return {
    failures,
    summary: `model ${meta.model}, ${latencyMs} ms, tokens ${tokens}, ${ideas} ${ideas === 1 ? 'idea' : 'ideas'}`,
  };
}

/** The JSON body of a response, or `undefined` when it is not JSON (a login page, say). */
async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

/** Runs one request's checks; a thrown error (network, timeout) becomes a failure, not a crash. */
async function attempt(label: string, failures: string[], run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    failures.push(`${label} failed: ${error instanceof Error ? error.name : 'unknown error'}`);
  }
}

/**
 * Runs every check against the deployment at `base`: health, the landing page and one plan request
 * for the community sample dated from `today`. That request is the only model call.
 */
export async function runLiveSmoke(
  base: string,
  fetcher: Fetcher,
  today: IsoDate,
): Promise<SmokeResult> {
  const { origin } = new URL(base);
  const failures: string[] = [];
  let summary: string | undefined;
  const signal = (): AbortSignal => AbortSignal.timeout(REQUEST_TIMEOUT_MS);

  await attempt('GET /api/health', failures, async () => {
    const response = await fetcher(`${origin}/api/health`, { signal: signal() });
    failures.push(...checkHealth(response.status, await readJson(response)));
  });

  await attempt('GET /', failures, async () => {
    const response = await fetcher(`${origin}/`, { signal: signal() });
    const html = await response.text();
    failures.push(
      ...checkPage(response.status, response.url || `${origin}/`, html),
      ...checkHeaders(response.headers).map((failure) => `GET /: ${failure}`),
    );
  });

  await attempt('POST /api/plan', failures, async () => {
    const started = performance.now();
    const response = await fetcher(`${origin}/api/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ brief: sampleBrief('community', today) }),
      signal: signal(),
    });
    const body = await readJson(response);
    const latencyMs = Math.round(performance.now() - started);
    const check = checkPlan(response.status, response.headers, body, latencyMs);
    failures.push(...check.failures);
    summary = check.summary;
  });

  return { failures, summary };
}
