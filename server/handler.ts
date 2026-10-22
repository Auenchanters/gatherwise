/**
 * The planning API's one Fetch handler, shared by the Vercel functions and the local dev server.
 * Does: route `POST /api/plan` and `GET /api/health`; run the request gate (method, content type,
 * origin, rate limit, size, JSON, schema, date); build the engine plan; make exactly one model
 * call inside the concurrency gate; answer with sanitized suggestions and call metadata; write
 * one log line per request.
 * Never does: retry a model call, return a provider message, log brief or model text, or cache.
 */
import { randomUUID } from 'node:crypto';
import { ApiError } from '@google/genai';
import type { EventKind } from '../src/domain/templates/types.js';
import { buildPrompt, type Prompt } from '../src/shared/prompt.js';
import { aiMetaSchema } from '../src/shared/schema.js';
import { parseSuggestions } from './answer.js';
import { createInferenceGate } from './capacity.js';
import { AppError, errorResponse, type ErrorCode } from './errors.js';
import { logRequest } from './log.js';
import { createGeminiGenerator, type Generate, type Generation } from './provider.js';
import { clientId, createRateLimiter, type RateLimiter } from './rate-limit.js';
import { planFor, readBrief, validateTransport } from './request.js';

const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
/** Each route and the one method it accepts. */
const ROUTES = { '/api/plan': 'POST', '/api/health': 'GET' } as const;
const isRoute = (path: string): path is keyof typeof ROUTES => Object.hasOwn(ROUTES, path);
const NO_STORE = { 'Cache-Control': 'no-store' };

/** Dependencies, injectable so tests run offline and deterministically. */
export interface HandlerOptions {
  /** The model call. Without it, plan requests get `AI_NOT_CONFIGURED`. */
  readonly generate?: Generate;
  /** The model id reported in `meta.model`. */
  readonly model?: string;
  /** `APP_ORIGIN`, accepted in addition to the request's own origin. */
  readonly origin?: string;
  /** The clock for the date window and the rate limit. */
  readonly now?: () => Date;
  readonly rateLimit?: RateLimiter;
}

/** Facts about a request gathered for its log line as handling proceeds. */
interface Trace {
  eventKind?: EventKind;
  event?: 'truncated';
  dropped?: number;
  inputTokens?: number;
  outputTokens?: number;
  /** Set for an unexpected fault, so a 500 is traceable without logging what was thrown. */
  kind?: 'internal';
}

/** Quota exhaustion: the SDK throws its `ApiError` with the HTTP status, 429 for a spent quota. */
const isBusy = (error: unknown): boolean => error instanceof ApiError && error.status === 429;

/** The SDK's own timeout aborts its fetch, which rejects with an AbortError. */
const isTimeout = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');

/**
 * The public code for a failed model call, chosen by the error's shape. Inspecting a hostile value
 * (a throwing getter or Proxy trap) must not escape as a 500, so that falls back to unavailable.
 */
function modelFailure(error: unknown): ErrorCode {
  try {
    if (isBusy(error)) return 'AI_BUSY';
    if (isTimeout(error)) return 'AI_TIMEOUT';
  } catch {
    // Fall through: an error we cannot even inspect is just an unavailable provider.
  }
  return 'AI_UNAVAILABLE';
}

/** Runs the model call, turning any failure into a catalogued public error. */
async function callModel(
  generate: Generate,
  prompt: Prompt,
  signal: AbortSignal,
): Promise<Generation> {
  try {
    return await generate(prompt, signal);
  } catch (error) {
    throw new AppError(modelFailure(error));
  }
}

/** The public error for anything thrown while handling `request`; a client abort wins. */
function toAppError(error: unknown, request: Request): AppError {
  if (request.signal.aborted) return new AppError('REQUEST_CANCELLED');
  return error instanceof AppError ? error : new AppError('INTERNAL_ERROR');
}

/** A Fetch handler with its own rate-limit counters and concurrency gate. */
export function createHandler(
  options: HandlerOptions = {},
): (request: Request) => Promise<Response> {
  const { generate, model = DEFAULT_MODEL, origin, now = () => new Date() } = options;
  const rateLimit = options.rateLimit ?? createRateLimiter();
  const withCapacity = createInferenceGate();

  async function planRoute(request: Request, requestId: string, trace: Trace): Promise<Response> {
    validateTransport(request, origin);
    rateLimit(clientId(request), now().getTime());
    const brief = await readBrief(request);
    trace.eventKind = brief.kind;
    const plan = planFor(brief, now());
    if (!generate) throw new AppError('AI_NOT_CONFIGURED');
    request.signal.throwIfAborted();
    const prompt = buildPrompt(plan);
    const started = performance.now();
    const generation = await withCapacity(() => callModel(generate, prompt, request.signal));
    const latencyMs = Math.round(performance.now() - started);
    const { inputTokens, outputTokens } = generation;
    trace.inputTokens = inputTokens;
    trace.outputTokens = outputTokens;
    // A cut-off answer rarely parses; if one does, what it holds is still used.
    if (generation.truncated === true) trace.event = 'truncated';
    const { suggestions, dropped } = parseSuggestions(generation.text, brief.kind);
    if (dropped > 0) trace.dropped = dropped;
    // Checked at runtime too: a bad model id or token count must not reach the client's store.
    const meta = aiMetaSchema.safeParse({ model, latencyMs, inputTokens, outputTokens, requestId });
    if (!meta.success) throw new AppError('INVALID_RESPONSE');
    return Response.json({ suggestions, meta: meta.data }, { headers: NO_STORE });
  }

  async function route(
    request: Request,
    path: string,
    requestId: string,
    trace: Trace,
  ): Promise<Response> {
    request.signal.throwIfAborted();
    if (!isRoute(path)) throw new AppError('NOT_FOUND');
    const method = ROUTES[path];
    if (request.method !== method) throw new AppError('METHOD_NOT_ALLOWED', { allow: method });
    if (path === '/api/plan') return planRoute(request, requestId, trace);
    const ai = generate ? 'configured' : 'not_configured';
    return Response.json({ status: 'ok', ai }, { headers: NO_STORE });
  }

  return async (request) => {
    const requestId = randomUUID();
    const started = performance.now();
    const path = new URL(request.url).pathname;
    const trace: Trace = {};
    let response: Response;
    let code: ErrorCode | undefined;
    try {
      response = await route(request, path, requestId, trace);
    } catch (error) {
      const failure = toAppError(error, request);
      code = failure.code;
      if (code === 'INTERNAL_ERROR') trace.kind = 'internal';
      response = errorResponse(failure);
    }
    logRequest({
      requestId,
      route: isRoute(path) ? path : 'unknown',
      status: response.status,
      ...(code ? { code } : {}),
      latencyMs: Math.round(performance.now() - started),
      ...trace,
    });
    return response;
  };
}

/** The environment variables a handler is configured from, such as `process.env`. */
export type Env = Readonly<Record<string, string | undefined>>;

/**
 * A handler configured from `env`, built once per warm instance by each function entry point:
 * `GEMINI_API_KEY` (no key, no model calls), `GEMINI_MODEL` and `APP_ORIGIN`. A value that is
 * unset or blank (`NAME=`) means "not set".
 */
export function handlerFromEnv(env: Env): (request: Request) => Promise<Response> {
  const setting = (name: string): string | undefined => {
    const value = env[name]?.trim();
    return value === '' ? undefined : value;
  };
  const key = setting('GEMINI_API_KEY');
  const model = setting('GEMINI_MODEL') ?? DEFAULT_MODEL;
  const origin = setting('APP_ORIGIN');
  return createHandler({
    model,
    ...(key ? { generate: createGeminiGenerator(key, model) } : {}),
    ...(origin ? { origin } : {}),
  });
}
