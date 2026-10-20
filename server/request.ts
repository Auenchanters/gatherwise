/**
 * The request gate for `POST /api/plan`, in order: JSON content type, same origin, size (declared,
 * then streamed), JSON syntax, the strict brief schema, then the event date against the server's
 * clock. Every step throws a catalogued `AppError`.
 * Never does: read more than `MAX_BODY_BYTES`, echo input back in an error, or trust the client's
 * idea of today beyond one day either side of UTC.
 */
import { z } from 'zod';
import { addDays, daysBetween, isoDate, parseIsoDate } from '../src/domain/dates.js';
import { buildPlan, type Plan } from '../src/domain/plan.js';
import { LIMITS } from '../src/shared/limits.js';
import { eventBriefSchema, type EventBrief } from '../src/shared/schema.js';
import { AppError } from './errors.js';

/** The most body bytes the API will read: a full brief is about 2 KB. */
export const MAX_BODY_BYTES = 16_384;
const MAX_FIELDS = 10;

const planRequestSchema = z.strictObject({ brief: eventBriefSchema });

/**
 * Steps 2 to 4: rejects a non-JSON content type (415), a foreign `Origin` or a cross-site fetch
 * (403) and a declared `Content-Length` over the cap (413).
 * Allowed origins are the request URL's own origin plus `appOrigin` (`APP_ORIGIN`) when set, so a
 * preview deployment calling itself is accepted. Browsers set `Origin` truthfully, so this stays
 * CSRF-safe. A present but empty or opaque (`null`) `Origin` is rejected; a request with no
 * `Origin` at all (curl, a server) passes this step and still meets every other limit.
 */
export function validateTransport(request: Request, appOrigin: string | undefined): void {
  const type = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (type !== 'application/json') throw new AppError('JSON_REQUIRED');
  const origin = request.headers.get('origin');
  const allowed = [new URL(request.url).origin, appOrigin];
  const foreign = origin !== null && !allowed.includes(origin);
  if (foreign || request.headers.get('sec-fetch-site') === 'cross-site')
    throw new AppError('ORIGIN_REJECTED');
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES)
    throw new AppError('BODY_TOO_LARGE');
}

/** The body as text, counting the bytes actually streamed since `Content-Length` is optional. */
async function readBoundedText(request: Request): Promise<string> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) return text + decoder.decode();
    bytes += chunk.value.byteLength;
    if (bytes > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new AppError('BODY_TOO_LARGE');
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
}

/** A zod issue path as the client's field name: `brief.guests` becomes `guests`. */
const fieldOf = (path: readonly PropertyKey[]): string =>
  path.slice(1).map(String).join('.') || 'brief';

/**
 * Steps 4 to 6: reads at most `MAX_BODY_BYTES` (413), parses JSON (400 `INVALID_JSON`) and
 * validates `{ brief }` strictly (400 `INVALID_BRIEF` with up to 10 field paths).
 */
export async function readBrief(request: Request): Promise<EventBrief> {
  const text = await readBoundedText(request);
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    throw new AppError('INVALID_JSON');
  }
  const parsed = planRequestSchema.safeParse(input);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => fieldOf(issue.path)))];
    throw new AppError('INVALID_BRIEF', { fields: fields.slice(0, MAX_FIELDS) });
  }
  return parsed.data.brief;
}

/**
 * Step 7: builds the engine plan for `brief`, checking its date against today in UTC. The browser
 * picked the date in its own zone, which may be a day ahead of or behind UTC, so the window is
 * widened by one day each side: the plan is built from the day nearest the event within one day
 * of UTC today, and the engine rejects anything still out of range.
 * @throws AppError `INVALID_BRIEF` naming `date` for an impossible date or one outside
 * `[today - 1, today + horizonDays + 1]`.
 */
export function planFor(brief: EventBrief, now: Date): Plan {
  const today = isoDate(now.toISOString().slice(0, 10));
  const event = parseIsoDate(brief.date);
  const ahead = event.ok ? daysBetween(today, event.value) : 0;
  const shift = ahead < 0 ? -1 : Number(ahead > LIMITS.brief.horizonDays);
  const plan = buildPlan(brief, addDays(today, shift));
  if (!plan.ok) throw new AppError('INVALID_BRIEF', { fields: ['date'] });
  return plan.value;
}
