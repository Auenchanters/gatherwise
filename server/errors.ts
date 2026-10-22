/**
 * The API's one error catalog: every public failure has a fixed status, code and message.
 * Does: turn a failure into the `{ error: { code, message } }` envelope, with `fields` for a bad
 * brief, `Allow` for a wrong method and `Retry-After` when waiting helps (60 seconds unless the
 * error says how long, as a spent daily budget does).
 * Never does: put a provider message, stack trace, request path or user input in a response;
 * messages come only from this table.
 */

interface ErrorSpec {
  readonly status: number;
  readonly message: string;
  /** Waiting can help, so the response carries `Retry-After` (60 seconds unless detailed). */
  readonly retry?: true;
}

const CATALOG = {
  NOT_FOUND: { status: 404, message: 'This endpoint does not exist.' },
  METHOD_NOT_ALLOWED: { status: 405, message: 'This endpoint does not accept that method.' },
  JSON_REQUIRED: { status: 415, message: 'Send the request as application/json.' },
  ORIGIN_REJECTED: { status: 403, message: 'Requests must come from the Gatherwise app.' },
  BODY_TOO_LARGE: { status: 413, message: 'The event details are too large to send.' },
  INVALID_JSON: { status: 400, message: 'The request must contain valid JSON.' },
  INVALID_BRIEF: {
    status: 400,
    message: 'Some event details are missing or out of range. Check the highlighted fields.',
  },
  INVALID_ADJUSTMENT: {
    status: 400,
    message: 'The change could not be read. Keep it to 200 characters and try again.',
  },
  RATE_LIMITED: {
    status: 429,
    message: 'Too many plans in a short time. Wait a minute and try again.',
    retry: true,
  },
  CAPACITY_LIMITED: {
    status: 429,
    message: 'The planner is busy right now. Wait a minute and try again.',
    retry: true,
  },
  AI_NOT_CONFIGURED: {
    status: 503,
    message: 'AI suggestions are not set up yet. Your plan works without them.',
  },
  AI_BUSY: {
    status: 503,
    message: 'The AI service is busy. Your plan still works; try again after the Retry-After wait.',
    retry: true,
  },
  AI_TIMEOUT: {
    status: 504,
    message: 'The AI took too long to answer. Your plan still works; try again shortly.',
  },
  AI_UNAVAILABLE: {
    status: 502,
    message: 'The AI service is unavailable. Your plan still works; try again shortly.',
  },
  INVALID_RESPONSE: {
    status: 502,
    message: 'The AI sent back an answer we could not use. Your plan still works; try again.',
  },
  REQUEST_CANCELLED: { status: 499, message: 'The request was cancelled.' },
  INTERNAL_ERROR: { status: 500, message: 'Something went wrong on our side. Please try again.' },
} as const satisfies Record<string, ErrorSpec>;

/** A machine-readable error code; the client switches on these, never on messages. */
export type ErrorCode = keyof typeof CATALOG;

/** Extra, non-sensitive detail some errors carry. */
interface ErrorDetail {
  /** Brief fields that failed validation, as dotted paths such as `guests` or `income.sponsors`. */
  readonly fields?: readonly string[];
  /** The method the route accepts, sent as the `Allow` header with a 405. */
  readonly allow?: string;
  /** Seconds to wait, sent as `Retry-After` in place of the default 60. */
  readonly retryAfter?: number;
}

/** An expected failure with a catalogued status and message. */
export class AppError extends Error {
  /** The HTTP status from the catalog. */
  readonly status: number;
  /** Whether the response should carry `Retry-After`. */
  readonly retry: boolean;

  constructor(
    readonly code: ErrorCode,
    readonly detail: ErrorDetail = {},
  ) {
    const spec: ErrorSpec = CATALOG[code];
    super(spec.message);
    this.name = 'AppError';
    this.status = spec.status;
    this.retry = spec.retry ?? false;
  }
}

/** The JSON error response for `error`, with `no-store` and any `Allow` or `Retry-After` header. */
export function errorResponse(error: AppError): Response {
  const { code, message, status, retry, detail } = error;
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  if (detail.allow) headers.set('Allow', detail.allow);
  if (retry) headers.set('Retry-After', String(detail.retryAfter ?? 60));
  const fields = detail.fields ? { fields: detail.fields } : {};
  return Response.json({ error: { code, message, ...fields } }, { status, headers });
}
