/**
 * Saving the plan to browser storage and restoring it on the next visit.
 * Does: stores the plan's inputs (brief, planned guests, generation, ticks, the AI response) as one
 * versioned JSON value, and restores them by parsing every field strictly and then rebuilding the
 * plan through `restorePlanState`, the same path an edit takes. A bad AI part costs only the AI
 * part: the plan comes back without it. AI numbers that pass the schema are clamped and logged by
 * the merge on the way in, so network and storage share one normalization chokepoint.
 * Never does: trust stored data; store the derived plan; throw because storage is unavailable or its
 * content is wrong (the result says why instead).
 */
import { z } from 'zod';
import type { IsoDate } from '../../domain/dates.js';
import {
  restorePlanState,
  type AiState,
  type PlanState,
  type ReadyState,
} from '../../domain/reducer.js';
import { VENDOR_STATUSES } from '../../domain/vendors.js';
import { LIMITS } from '../../shared/limits.js';
import { suggestionsSchemaFor } from '../../shared/prompt.js';
import { err, type Result } from '../../shared/result.js';
import { aiMetaSchema, eventBriefSchema, type EventBrief } from '../../shared/schema.js';
import { STORAGE_KEY } from './storage-key.js';

// The key lives in an import-free module so the first page can check for a saved plan cheaply.
export { STORAGE_KEY };

/** The longest stored value, in characters, that `loadPlan` will parse. */
export const MAX_STORED_CHARS = 200_000;

/** Why nothing could be restored: nothing saved, unreadable, another version, or past its date. */
type LoadError = 'missing' | 'corrupt' | 'version' | 'stale';

const MAX_IDS = 500;
const MAX_ID_CHARS = 80;
const MAX_VENDORS = 100;
/** Far more briefs than anyone submits, and low enough that `generation + 1` never repeats. */
const MAX_GENERATION = 1_000_000_000;
const { guestsMin, guestsMax } = LIMITS.brief;

const id = z.string().max(MAX_ID_CHARS);
const ids = z.array(id).max(MAX_IDS);

const versionSchema = z.object({ v: z.number() });

const envelopeSchema = z.strictObject({
  v: z.literal(1),
  brief: eventBriefSchema,
  plannedGuests: z.int().min(guestsMin).max(guestsMax),
  generation: z.int().min(0).max(MAX_GENERATION),
  progress: z.strictObject({
    doneTasks: ids,
    vendorStatus: z
      .record(id, z.enum(VENDOR_STATUSES))
      .refine((statuses) => Object.keys(statuses).length <= MAX_VENDORS),
    checklistDone: ids,
  }),
  // Checked on its own, against the brief's template, so a bad one does not discard the plan.
  ai: z.unknown().optional(),
});

/**
 * Answers saved while the AI still sent budget weight hints restore too: that one retired field is
 * dropped, and everything else is checked as strictly as ever.
 */
const withoutWeightHints = (value: unknown): unknown =>
  typeof value === 'object' && value !== null
    ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'weightHints'))
    : value;

/** The AI part of a stored plan: both halves, with ids that exist in this brief's template. */
const aiSchemaFor = (kind: EventBrief['kind']) =>
  z.strictObject({
    suggestions: z.preprocess(withoutWeightHints, suggestionsSchemaFor(kind)),
    meta: aiMetaSchema,
  });

/**
 * Writes the plan's inputs, or removes the stored plan when the state is empty. The derived plan is
 * never written: it is rebuilt on load. A plan too big for `loadPlan` to accept is not written, so
 * the older copy stays.
 * @returns whether the storage now matches `state`; false when storage refused (private mode,
 * quota) or the plan was too big.
 */
export function savePlan(
  store: Pick<Storage, 'setItem' | 'removeItem'>,
  state: PlanState,
): boolean {
  try {
    if (state.phase === 'empty') {
      store.removeItem(STORAGE_KEY);
      return true;
    }
    const { brief, plannedGuests, generation, progress, ai } = state;
    // Built to the envelope's own input type, so the writer and the reader cannot drift apart.
    // JSON leaves out whichever half of the AI result is undefined.
    const envelope = {
      v: 1,
      brief,
      plannedGuests,
      generation,
      progress: {
        doneTasks: [...progress.doneTasks],
        vendorStatus: progress.vendorStatus,
        checklistDone: [...progress.checklistDone],
      },
      ai: { suggestions: ai.suggestions, meta: ai.meta },
    } satisfies z.input<typeof envelopeSchema>;
    const text = JSON.stringify(envelope);
    if (text.length > MAX_STORED_CHARS) return false;
    store.setItem(STORAGE_KEY, text);
    return true;
  } catch {
    return false;
  }
}

/** The stored text, or null when there is none or storage cannot be read. */
function readStored(store: Pick<Storage, 'getItem'>): string | null {
  try {
    return store.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Parsed JSON, or undefined when `text` is not JSON (JSON has no undefined). */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Restores the saved plan as of `today`. Everything stored is untrusted: oversized, unparsable or
 * wrongly shaped values are `corrupt`, another version is `version`, and an event that has passed
 * is `stale`. The AI result is checked separately: if it is bad, the plan comes back with `ai`
 * idle rather than being thrown away; if it is good, it is merged again, so its numbers are clamped
 * and any adjustments are listed as for a fresh response.
 */
export function loadPlan(
  store: Pick<Storage, 'getItem'>,
  today: IsoDate,
): Result<ReadyState, LoadError> {
  const text = readStored(store);
  if (text === null) return err('missing');
  if (text.length > MAX_STORED_CHARS) return err('corrupt');
  const raw = parseJson(text);
  const version = versionSchema.safeParse(raw);
  if (version.success && version.data.v !== 1) return err('version');
  const parsed = envelopeSchema.safeParse(raw);
  if (!parsed.success) return err('corrupt');

  const { brief, plannedGuests, generation, progress } = parsed.data;
  const stored = aiSchemaFor(brief.kind).safeParse(parsed.data.ai);
  const ai: AiState = stored.success ? { status: 'applied', ...stored.data } : { status: 'idle' };
  const restored = restorePlanState({ brief, today, plannedGuests, generation, progress, ai });
  if (restored.ok) return restored;
  const { error } = restored;
  return err(error.kind === 'invalid_date' && error.reason === 'past' ? 'stale' : 'corrupt');
}
