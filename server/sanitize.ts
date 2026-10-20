/**
 * Sanitizing of the model's answer before it leaves the server.
 * Does: clean and cap every string in a validated `AiSuggestions` with `sanitizeText`, which lives
 * in src/shared because the prompt builder shares it.
 * Never does: touch ids or numbers (the schema checks ids, the engine clamps numbers).
 */
import { LIMITS } from '../src/shared/limits.js';
import { sanitizeText } from '../src/shared/sanitize-text.js';
import type { AiSuggestions } from '../src/shared/schema.js';

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
