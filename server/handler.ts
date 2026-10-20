/**
 * The planning API's one Fetch handler, shared by the Vercel functions and the local dev server.
 * Does: route `POST /api/plan` and `GET /api/health`; run the request gate (method, content type,
 * origin, rate limit, size, JSON, schema, date); build the engine plan; make exactly one model
 * call inside the concurrency gate; answer with sanitized suggestions and call metadata; write
 * one log line per request.
 * Never does: retry a model call, return a provider message, log brief or model text, or cache.
 */
import { randomUUID } from 'node:crypto';
import type { EventKind } from '../src/domain/templates/types.js';
import type { AiMeta } from '../src/shared/schema.js';
import { createInferenceGate, type InferenceGate } from './capacity.js';
import { AppError, errorResponse, type ErrorCode } from './errors.js';
import { logRequest } from './log.js';
import { buildPrompt, parseSuggestions, type Prompt } from './prompt.js';
import { createGeminiGenerator, type Generate, type Generation } from './provider.js';
import { clientId, createRateLimiter, type RateLimiter } from './rate-limit.js';
import { planFor, readBrief, validateTransport } from './request.js';

const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
/** Each route and the one method it accepts. */
const ROUTES = new Map([
  ['/api/plan', 'POST'],
  ['/api/health', 'GET'],
]);
const NO_STORE = { 'Cache-Control': 'no-store' };

/** Dependencies, injectable so tests run offline and deterministically. */
export interface HandlerOptions {
  /** The model call. Without it, plan requests get `AI_NOT_CONFIGURED`. */
  readonly generate?: Generate;
  /** The model id reported in `meta.model`. */
  readonly model?: string;
  /** `APP_ORIGIN`; without it only the request's own origin is accepted. */
  readonly origin?: string;
  /** The clock for the date window and the rate limit. */
  readonly now?: () => Date;
  readonly rateLimit?: RateLimiter;
  readonly capacity?: InferenceGate;
}

/** Facts about a request gathered for its log line as handling proceeds. */
interface Trace {
  kind?: EventKind;
  inputTokens?: number;
  outputTokens?: number;
}

const isObject = (value: unknown): value is object => typeof value === 'object' && value !== null;

/** Quota exhaustion: an SDK `ApiError` with status 429, or a RESOURCE_EXHAUSTED body. */
const isBusy = (error: unknown): boolean =>
  isObject(error) &&
  (('status' in error && error.status === 429) ||
    ('message' in error &&
      typeof error.message === 'string' &&
      error.message.includes('RESOURCE_EXHAUSTED')));

/** The SDK's own timeout aborts its fetch, which rejects with an AbortError. */
const isTimeout = (error: unknown): boolean =>
  isObject(error) &&
  'name' in error &&
  (error.name === 'AbortError' || error.name === 'TimeoutError');

/** Runs the model call, turning any failure into a public code judged by the error's shape. */
async function callModel(
  generate: Generate,
  prompt: Prompt,
  signal: AbortSignal,
): Promise<Generation> {
  try {
    return await generate(prompt, signal);
  } catch (error) {
    let code: ErrorCode = 'AI_UNAVAILABLE';
    if (isBusy(error)) code = 'AI_BUSY';
    else if (isTimeout(error)) code = 'AI_TIMEOUT';
    throw new AppError(code);
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
  const withCapacity = options.capacity ?? createInferenceGate();

  async function planRoute(request: Request, requestId: string, trace: Trace): Promise<Response> {
    validateTransport(request, origin);
    rateLimit(clientId(request), now().getTime());
    const brief = await readBrief(request);
    trace.kind = brief.kind;
    const plan = planFor(brief, now());
    if (!generate) throw new AppError('AI_NOT_CONFIGURED');
    request.signal.throwIfAborted();
    const prompt = buildPrompt(plan);
    const started = performance.now();
    const generation = await withCapacity(() => callModel(generate, prompt, request.signal));
    const latencyMs = Math.round(performance.now() - started);
    const { inputTokens, outputTokens } = generation;
    Object.assign(trace, { inputTokens, outputTokens });
    const suggestions = parseSuggestions(generation.text, brief.kind);
    const meta: AiMeta = { model, latencyMs, inputTokens, outputTokens, requestId };
    return Response.json({ suggestions, meta }, { headers: NO_STORE });
  }

  async function route(
    request: Request,
    path: string,
    requestId: string,
    trace: Trace,
  ): Promise<Response> {
    request.signal.throwIfAborted();
    const method = ROUTES.get(path);
    if (!method) throw new AppError('NOT_FOUND');
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
      response = errorResponse(failure);
    }
    logRequest({
      requestId,
      route: ROUTES.has(path) ? path : 'unknown',
      status: response.status,
      ...(code ? { code } : {}),
      latencyMs: Math.round(performance.now() - started),
      ...trace,
    });
    return response;
  };
}

const env = process.env;
const key = env.GEMINI_API_KEY;
const configuredModel = env.GEMINI_MODEL ?? DEFAULT_MODEL;
/** The production handler, configured from the environment once per warm instance. */
export const handleRequest = createHandler({
  model: configuredModel,
  ...(key ? { generate: createGeminiGenerator(key, configuredModel) } : {}),
  ...(env.APP_ORIGIN ? { origin: env.APP_ORIGIN } : {}),
});
