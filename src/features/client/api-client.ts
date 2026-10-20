/**
 * The browser's client for `POST /api/plan`, with its cache and its AI-call counter.
 * Does: send one brief; validate everything that comes back against the shared schemas; map every
 * failure to one of five `ClientError` codes; remember the last `cacheSize` successes, keyed by the
 * SHA-256 of the brief's canonical JSON; count real network requests, which the UI shows as
 * "AI calls this session: N".
 * Never does: retry automatically; return unvalidated network data; cache a failure or an abort;
 * count a cache hit as a call; read the clock; log. Creating a plan costs one call, an edit costs
 * none (edits never reach this client), an explicit refresh costs one, an identical brief costs none.
 */
import { z } from 'zod';
import { templateFor, templateIds } from '../../domain/templates/index.js';
import { err, ok, type Result } from '../../shared/result.js';
import {
  aiMetaSchema,
  aiSuggestionsSchema,
  type AiMeta,
  type AiSuggestions,
  type EventBrief,
} from '../../shared/schema.js';

const ENDPOINT = '/api/plan';
/** Longer than the server's 20 s model timeout, so the server's answer normally arrives first. */
const DEFAULT_TIMEOUT_MS = 25_000;
const DEFAULT_CACHE_SIZE = 8;
/** The longest wait the client will repeat to a user; anything beyond is a server fault. */
const MAX_RETRY_AFTER_SECONDS = 3600;

/** A validated answer: the model's suggestions and the facts about the call. Treat as immutable. */
export interface SuggestResponse {
  readonly suggestions: AiSuggestions;
  /** About the call that produced `suggestions`; on a reused answer, about the ORIGINAL call. */
  readonly meta: AiMeta;
  /** `true` when this answer was reused from the cache with no new request; `false` when fresh. */
  readonly cached: boolean;
}

/** Why a request produced no suggestions; the plan itself is unaffected. */
export interface ClientError {
  readonly code: 'network' | 'timeout' | 'rate_limited' | 'unavailable' | 'invalid';
  /** Only for `rate_limited`, only when the server's `Retry-After` was a sane 1 to 3600. */
  readonly retryAfterSeconds?: number;
}

/** Dependencies and limits, all optional. */
export interface PlanClientOptions {
  /** The transport; defaults to the global `fetch`. Injected by tests. */
  readonly fetchImpl?: typeof fetch;
  /** Abort a request still unanswered after this long. Default 25 000. */
  readonly timeoutMs?: number;
  /** How many successes to remember. Default 8. */
  readonly cacheSize?: number;
}

/** What the UI talks to. */
export interface PlanClient {
  /**
   * Asks for suggestions for `brief`. A remembered answer for an identical brief is returned with
   * no request; `refresh: true` skips that lookup, always asks, and replaces the remembered answer.
   * Resolves, never rejects. `signal` is the caller's cancel; the client's own timeout is separate.
   * Callers should not start the same brief twice at once: concurrent requests are not merged.
   */
  suggest(
    brief: EventBrief,
    signal: AbortSignal,
    opts?: { readonly refresh?: boolean },
  ): Promise<Result<SuggestResponse, ClientError>>;
  /** How many network requests this client has issued: the session's real AI-call count. */
  calls(): number;
}

type ClientErrorCode = ClientError['code'];

/**
 * What the server's error `code`s mean here. Checked before the HTTP status, because AI_BUSY is a
 * 503 and INVALID_RESPONSE a 502.
 */
const BY_SERVER_CODE = new Map<string, ClientErrorCode>([
  ['RATE_LIMITED', 'rate_limited'],
  ['CAPACITY_LIMITED', 'rate_limited'],
  ['AI_BUSY', 'rate_limited'],
  ['AI_TIMEOUT', 'timeout'],
  ['AI_NOT_CONFIGURED', 'unavailable'],
  ['AI_UNAVAILABLE', 'unavailable'],
  ['INVALID_RESPONSE', 'invalid'],
  ['INVALID_BRIEF', 'invalid'],
  ['INVALID_JSON', 'invalid'],
]);

const errorEnvelope = z.object({ error: z.object({ code: z.string() }) });

/** The status alone, for replies without one of our codes (a platform error page, say). */
function codeForStatus(status: number): ClientErrorCode {
  if (status === 429) return 'rate_limited';
  if (status === 504) return 'timeout';
  return status >= 500 ? 'unavailable' : 'invalid';
}

/** `Retry-After` as whole seconds, only if it is a plain integer from 1 to 3600. */
function parseRetryAfter(header: string | null): number | undefined {
  if (header === null || !/^\d+$/u.test(header)) return undefined;
  const seconds = Number(header);
  return seconds >= 1 && seconds <= MAX_RETRY_AFTER_SECONDS ? seconds : undefined;
}

/** The client error for a non-200 reply; `body` is whatever parsed, or `undefined`. */
function failureOf(status: number, body: unknown, retryAfter: string | null): ClientError {
  const serverCode = errorEnvelope.safeParse(body).data?.error.code;
  const known = serverCode === undefined ? undefined : BY_SERVER_CODE.get(serverCode);
  const code = known ?? codeForStatus(status);
  const seconds = code === 'rate_limited' ? parseRetryAfter(retryAfter) : undefined;
  return seconds === undefined ? { code } : { code, retryAfterSeconds: seconds };
}

/**
 * JSON with object keys sorted recursively and arrays in order, so equal briefs give equal text.
 * Mirrors `JSON.stringify` on what the wire carries: an `undefined` key is skipped and an
 * `undefined` array item is `null`, so two values that send the same body share a cache key.
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(',')}]`;
  }
  if (typeof value !== 'object' || value === null) return JSON.stringify(value);
  const fields = Object.keys(value)
    .sort()
    .flatMap((key) => {
      const field: unknown = Reflect.get(value, key);
      return field === undefined ? [] : [`${JSON.stringify(key)}:${canonicalJson(field)}`];
    });
  return `{${fields.join(',')}}`;
}

/** The lowercase hex SHA-256 of `text` as UTF-8. Rejects where `crypto.subtle` is unavailable. */
async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** `undefined` for text that is not JSON. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * `AbortSignal.any` where the browser has it (Chrome 116, Safari 17.4), otherwise a controller
 * that aborts as soon as either signal does.
 */
function anySignal(signals: AbortSignal[]): AbortSignal {
  if (typeof Reflect.get(AbortSignal, 'any') === 'function') return AbortSignal.any(signals);
  const controller = new AbortController();
  // ponytail: the listener stays on a long-lived caller signal until it aborts; the UI makes one
  // signal per request, so remove it on completion if signals are ever shared.
  for (const signal of signals) {
    if (signal.aborted) controller.abort(signal.reason);
    else {
      signal.addEventListener(
        'abort',
        () => {
          controller.abort(signal.reason);
        },
        { once: true },
      );
    }
  }
  return controller.signal;
}

/** A reply read in full: the status, the `Retry-After` header and the body text. */
interface Reply {
  readonly status: number;
  readonly retryAfter: string | null;
  readonly text: string;
}

/** Turns a reply into validated suggestions or a client error. A 200 is checked, never trusted. */
function interpret(brief: EventBrief, reply: Reply): Result<SuggestResponse, ClientError> {
  const body = parseJson(reply.text);
  if (reply.status !== 200) return err(failureOf(reply.status, body, reply.retryAfter));
  const expected = z.object({
    suggestions: aiSuggestionsSchema(templateIds(templateFor(brief.kind))),
    meta: aiMetaSchema,
  });
  const parsed = expected.safeParse(body);
  return parsed.success ? ok({ ...parsed.data, cached: false }) : err({ code: 'invalid' });
}

/**
 * Builds a client with its own cache and counter, so two clients never share either.
 * @returns A client; `suggest` always resolves with a `Result`.
 */
export function createPlanClient(options: PlanClientOptions = {}): PlanClient {
  const {
    fetchImpl = fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    cacheSize = DEFAULT_CACHE_SIZE,
  } = options;
  // A Map iterates in insertion order, so re-inserting on use keeps the least recently used first.
  const cache = new Map<string, SuggestResponse>();
  let calls = 0;

  /** Stores `value` as the newest entry (replacing any for `key`), then evicts the oldest while over `cacheSize`. */
  function remember(key: string, value: SuggestResponse): void {
    cache.delete(key);
    cache.set(key, value);
    for (const oldest of cache.keys()) {
      if (cache.size <= cacheSize) break;
      cache.delete(oldest);
    }
  }

  /**
   * One request, from the count to the last byte of the body, under the caller's cancel and our
   * timeout. Everything that can fail before the request exists (a bad `timeoutMs`, a missing
   * signal API) is built first, so it resolves as `network` without ticking the counter.
   */
  async function exchange(
    brief: EventBrief,
    signal: AbortSignal,
  ): Promise<Result<Reply, ClientError>> {
    let timeout: AbortSignal | undefined;
    try {
      timeout = AbortSignal.timeout(timeoutMs);
      const init = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief }),
        signal: anySignal([signal, timeout]),
      };
      calls += 1;
      const response = await fetchImpl(ENDPOINT, init);
      return ok({
        status: response.status,
        retryAfter: response.headers.get('Retry-After'),
        text: await response.text(),
      });
    } catch {
      // The caller's own cancel is never reported as a timeout, even if both fired.
      return err({ code: !signal.aborted && timeout?.aborted === true ? 'timeout' : 'network' });
    }
  }

  return {
    async suggest(brief, signal, opts = {}) {
      const text = canonicalJson(brief);
      // Without crypto.subtle (an insecure page) the canonical text itself is just a longer key.
      const key = await sha256Hex(text).catch(() => text);
      const hit = opts.refresh === true ? undefined : cache.get(key);
      if (hit) {
        remember(key, hit);
        return ok({ ...hit, cached: true });
      }
      // After the cache and before the count: a request that was never sent is not a call.
      if (signal.aborted) return err({ code: 'network' });
      const reply = await exchange(brief, signal);
      if (!reply.ok) return reply;
      const result = interpret(brief, reply.value);
      if (result.ok) remember(key, result.value);
      return result;
    },
    calls: () => calls,
  };
}
