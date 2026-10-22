/**
 * One structured log line per API request, and one for each limiter fallback.
 * Does: write a JSON line of ids, numbers and fixed labels: `console.info` normally,
 * `console.error` for a 5xx, `console.warn` when the rate limits fall back to memory.
 * Never does: log brief text, model text, provider messages, request paths or IP addresses; the
 * line's type only has room for the fields below.
 */
import type { EventKind } from '../src/domain/templates/types.js';
import type { ErrorCode } from './errors.js';

/** Everything a request log line may hold. */
export interface RequestLog {
  readonly requestId: string;
  /** A known route, or `unknown`; never the raw path. */
  readonly route: '/api/plan' | '/api/health' | 'unknown';
  readonly status: number;
  readonly code?: ErrorCode;
  /** `internal` marks an unexpected fault (a bug), so it can be traced without its message. */
  readonly kind?: 'internal';
  /** Something worth noticing: `truncated` when the model hit its output cap. */
  readonly event?: 'truncated';
  /** The event kind of the brief, once it has parsed. */
  readonly eventKind?: EventKind;
  readonly latencyMs: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  /** Items of the model's answer left out because they failed the schema; absent when none. */
  readonly dropped?: number;
}

/** Writes one request's log line. */
export function logRequest(line: RequestLog): void {
  const text = JSON.stringify(line);
  if (line.status >= 500) console.error(text);
  else console.info(text);
}

/**
 * An infrastructure event, not tied to one request: the rate limits fell back to this instance's
 * memory because no shared store is configured, or because it failed or timed out.
 */
export interface EventLog {
  readonly event: 'limiter_fallback';
  readonly reason: 'not_configured' | 'error' | 'timeout';
}

/** Writes one event's log line, as a warning. */
export function logEvent(line: EventLog): void {
  console.warn(JSON.stringify(line));
}
