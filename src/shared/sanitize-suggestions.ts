/**
 * Bounding of an AI answer wherever it crosses the model boundary: the server bounds the model's
 * answer before it leaves, and the prompt builder bounds the earlier answer an "Adjust with AI"
 * request sends back, so the browser and the server put the same bytes in that prompt.
 * Does: clean and cap every string with `sanitizeText`, keep the first `LIMITS.ai` items of every
 * list, and clamp every number into its `LIMITS.ai` range (an idea's cost into 0 to the largest
 * budget a brief allows). Applying it twice changes nothing more.
 * Never does: touch ids (the schema checks them) or round numbers; the engine still rounds, clamps
 * a cost to the brief's own budget, and lists each change it makes.
 */
import { LIMITS } from './limits.js';
import { sanitizeText } from './sanitize-text.js';
import type { AiSuggestions } from './schema.js';

const ai = LIMITS.ai;
const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

/** A copy of `s` with every string cleaned and capped, every list cut and every number clamped. */
export function sanitizeSuggestions(s: AiSuggestions): AiSuggestions {
  return {
    summary: sanitizeText(s.summary, ai.summaryMax),
    ideas: s.ideas.slice(0, ai.ideasMax).map((idea) => ({
      ...idea,
      title: sanitizeText(idea.title, ai.ideaTitleMax),
      description: sanitizeText(idea.description, ai.ideaDescriptionMax),
      estimatedCost: clamp(idea.estimatedCost, 0, LIMITS.brief.budgetMax),
      personalization: sanitizeText(idea.personalization, ai.personalizationMax),
    })),
    extraTasks: s.extraTasks.slice(0, ai.extraTasksMax).map((task) => ({
      ...task,
      title: sanitizeText(task.title, ai.taskTitleMax),
      durationDays: clamp(task.durationDays, ai.durationMin, ai.durationMax),
      leadDays: clamp(task.leadDays, ai.leadMin, ai.leadMax),
      after: task.after.slice(0, ai.afterMax),
    })),
    vendorQuestions: s.vendorQuestions.slice(0, ai.vendorQuestionsMax).map((entry) => ({
      ...entry,
      questions: entry.questions
        .slice(0, ai.questionsPerVendorMax)
        .map((q) => sanitizeText(q, ai.questionMax)),
    })),
  };
}
