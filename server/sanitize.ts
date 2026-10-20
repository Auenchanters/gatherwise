/**
 * Text sanitizing at the model boundary, for brief text going in and model text coming out.
 * Does: replace HTML tags with a space, drop stray angle brackets, control characters (newline
 * kept), lone surrogates, bidi overrides and Unicode tag characters, collapse whitespace, trim and
 * cap by code points.
 * Never does: touch ids or numbers (the schema checks ids, the engine clamps numbers), or escape
 * for HTML; React renders text, so removal is defence in depth, not the only line.
 */
import { LIMITS } from '../src/shared/limits.js';
import type { AiSuggestions } from '../src/shared/schema.js';

const TAG = /<[a-z/!?][^<>]*>/giu;
const ANGLE = /[<>]/gu;
// Controls other than whitespace (whitespace is collapsed below), lone surrogates, the bidi
// embedding/override/isolate characters that make text read differently from how it runs, and
// the invisible Unicode tag characters U+E0000-E007F used to smuggle hidden ASCII to a model.
const INVISIBLE = /(?![\t\n\v\f\r])[\p{Cc}\p{Cs}\u202A-\u202E\u2066-\u2069\u{E0000}-\u{E007F}]/gu;
const SPACE_RUN = /\s+/gu;

// ponytail: caps by code point, so a cut can split a ZWJ emoji sequence; Intl.Segmenter if it matters.
/**
 * Cleans untrusted text and cuts it to at most `max` code points.
 * Trade-off: removing tag characters also turns subdivision-flag emoji (England, Scotland, Wales)
 * into a plain black flag; blocking hidden instructions is worth those three flags.
 */
export function sanitizeText(s: string, max: number): string {
  const clean = s
    .replace(TAG, ' ')
    .replace(ANGLE, '')
    .replace(INVISIBLE, '')
    .replace(SPACE_RUN, (run) => (run.includes('\n') ? '\n' : ' '))
    .trim();
  return Array.from(clean).slice(0, max).join('').trimEnd();
}

const ai = LIMITS.ai;

/** A copy of `s` with every string sanitized and capped by `LIMITS.ai`; ids and numbers kept. */
export function sanitizeSuggestions(s: AiSuggestions): AiSuggestions {
  return {
    summary: sanitizeText(s.summary, ai.summaryMax),
    ideas: s.ideas.map((idea) => ({
      ...idea,
      title: sanitizeText(idea.title, ai.ideaTitleMax),
      description: sanitizeText(idea.description, ai.ideaDescriptionMax),
      personalization: sanitizeText(idea.personalization, ai.personalizationMax),
    })),
    weightHints: s.weightHints,
    extraTasks: s.extraTasks.map((task) => ({
      ...task,
      title: sanitizeText(task.title, ai.taskTitleMax),
    })),
    vendorQuestions: s.vendorQuestions.map((entry) => ({
      ...entry,
      questions: entry.questions.map((q) => sanitizeText(q, ai.questionMax)),
    })),
  };
}
