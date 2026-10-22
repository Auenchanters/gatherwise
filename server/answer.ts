/**
 * The reader for the model's answer; the prompt itself is built in src/shared/prompt.ts.
 * Does: parse the response as JSON, then each section on its own and each item within a list on
 * its own, against the template schema; keep everything valid, count what had to be left out, and
 * sanitize every string. One off-template id or one malformed item costs that item, not the paid
 * answer.
 * Never does: repair or retry a bad answer (one call per plan), or keep an answer with nothing in
 * it the plan could use.
 */
import { z } from 'zod';
import type { EventKind } from '../src/domain/templates/types.js';
import { suggestionsSchemaFor } from '../src/shared/prompt.js';
import type { AiSuggestions } from '../src/shared/schema.js';
import { AppError } from './errors.js';
import { sanitizeSuggestions } from '../src/shared/sanitize-suggestions.js';

/** An answer as read: what was kept, sanitized, and how many items were left out. */
export interface ReadAnswer {
  readonly suggestions: AiSuggestions;
  /** Items (or whole sections of the wrong type) that failed the schema and were left out. */
  readonly dropped: number;
}

/** The four sections, each still unchecked; any other top-level key is ignored. */
const unchecked = z.unknown().optional();
const sections = z.object({
  summary: unchecked,
  ideas: unchecked,
  extraTasks: unchecked,
  vendorQuestions: unchecked,
});
const anyList = z.array(z.unknown());

/** The items of `value` that pass `item`, and how many did not. A missing list is an empty one. */
function salvage<T>(value: unknown, item: z.ZodType<T>): { kept: T[]; dropped: number } {
  if (value === undefined) return { kept: [], dropped: 0 };
  const list = anyList.safeParse(value);
  if (!list.success) return { kept: [], dropped: 1 };
  const kept = list.data.flatMap((entry) => {
    const parsed = item.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
  return { kept, dropped: list.data.length - kept.length };
}

/**
 * Reads the model's answer for an event kind: JSON, then each section and item against the
 * template schema, then sanitized.
 * @throws AppError `INVALID_RESPONSE` when the text is not a JSON object, or when nothing usable is
 * left (no summary text and no item in any list).
 */
export function parseSuggestions(text: string, kind: EventKind): ReadAnswer {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new AppError('INVALID_RESPONSE');
  }
  const answer = sections.safeParse(raw);
  if (!answer.success) throw new AppError('INVALID_RESPONSE');
  const { shape } = suggestionsSchemaFor(kind);
  const summary = shape.summary.safeParse(answer.data.summary);
  const ideas = salvage(answer.data.ideas, shape.ideas.element);
  const extraTasks = salvage(answer.data.extraTasks, shape.extraTasks.element);
  const vendorQuestions = salvage(answer.data.vendorQuestions, shape.vendorQuestions.element);
  const suggestions = sanitizeSuggestions({
    summary: summary.success ? summary.data : '',
    ideas: ideas.kept,
    extraTasks: extraTasks.kept,
    vendorQuestions: vendorQuestions.kept,
  });
  const empty =
    suggestions.summary === '' &&
    suggestions.ideas.length === 0 &&
    suggestions.extraTasks.length === 0 &&
    suggestions.vendorQuestions.length === 0;
  if (empty) throw new AppError('INVALID_RESPONSE');
  const badSummary = summary.success || answer.data.summary === undefined ? 0 : 1;
  return {
    suggestions,
    dropped: badSummary + ideas.dropped + extraTasks.dropped + vendorQuestions.dropped,
  };
}
