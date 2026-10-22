/**
 * Every numeric cap in the data contracts, in one module with no imports at all.
 * Domain code may import it at runtime (see the allowlist in tests/unit/architecture.test.ts), so it
 * must never import zod or anything else. `brief` caps are enforced by the schema; `ai` bounds are
 * only hints to Gemini and are enforced (clamped and logged) by the engine.
 */

/** Numeric caps for the user's brief and for Gemini's suggestions. */
export const LIMITS = {
  brief: {
    nameMax: 80,
    cityMax: 60,
    vibeMax: 120,
    notesMax: 500,
    guestsMin: 1,
    guestsMax: 5000,
    budgetMin: 1,
    budgetMax: 100_000_000,
    durationHoursMin: 1,
    durationHoursMax: 16,
    volunteersMax: 500,
    horizonDays: 730,
    listMax: 6,
  },
  ai: {
    ideasMax: 8,
    ideaTitleMax: 80,
    ideaDescriptionMax: 300,
    personalizationMax: 160,
    summaryMax: 400,
    extraTasksMax: 5,
    taskTitleMax: 80,
    durationMin: 1,
    durationMax: 60,
    leadMin: -7,
    leadMax: 365,
    afterMax: 3,
    vendorQuestionsMax: 8,
    questionsPerVendorMax: 4,
    questionMax: 140,
    /** "Adjust with AI": the organizer's "what should change", in code points. */
    changeMax: 200,
  },
} as const;
