/**
 * The reader for the model's answer; the prompt itself is built in src/shared/prompt.ts.
 * Does: parse the response as JSON, validate it against the template schema and sanitize every
 * string in it.
 * Never does: repair or retry a bad answer (one call per plan).
 */
import type { EventKind } from '../src/domain/templates/types.js';
import { suggestionsSchemaFor } from '../src/shared/prompt.js';
import type { AiSuggestions } from '../src/shared/schema.js';
import { AppError } from './errors.js';
import { sanitizeSuggestions } from './sanitize.js';

/**
 * Reads the model's answer for an event kind: JSON, then the template schema, then sanitized.
 * @throws AppError `INVALID_RESPONSE` for anything that is not schema-valid JSON.
 */
export function parseSuggestions(text: string, kind: EventKind): AiSuggestions {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new AppError('INVALID_RESPONSE');
  }
  const parsed = suggestionsSchemaFor(kind).safeParse(raw);
  if (!parsed.success) throw new AppError('INVALID_RESPONSE');
  return sanitizeSuggestions(parsed.data);
}
