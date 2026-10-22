/**
 * The zod contracts shared by browser and server: the user's EventBrief (strict, validated at the
 * trust boundary), the per-template AiSuggestions Gemini returns (strict on shape and ids only) and
 * the AiMeta that travels beside them.
 * Never trusts model numbers: the LIMITS.ai bounds (limits.ts) are hints in the JSON Schema and
 * are enforced by the engine.
 */
import { z } from 'zod';
import { LIMITS } from './limits.js';
import { ACCESSIBILITY_OPTIONS, CURRENCIES, DIETARY_OPTIONS, SUBTYPES, VENUES } from './options.js';

// The option lists live in import-free options.ts so the first page can render the form without
// zod; they are re-exported here so contract users keep one import site.
export {
  ACCESSIBILITY_OPTIONS,
  CURRENCIES,
  DIETARY_OPTIONS,
  EVENT_KINDS,
  SUBTYPES,
  VENUES,
  type Currency,
} from './options.js';

const brief = LIMITS.brief;
const wholeNumber = (min: number, max: number) => z.int().min(min).max(max);
/** A list of known options, at most `listMax` long, with no repeats. */
const optionList = <T extends z.ZodType<string>>(option: T) =>
  z
    .array(option)
    .max(brief.listMax)
    .refine((items) => new Set(items).size === items.length, 'must not contain duplicates');

// Income is community-only. Money is capped at budgetMax and head counts at guestsMax so the
// domain's integer math cannot overflow.
const money = wholeNumber(0, brief.budgetMax);
const headCount = wholeNumber(0, brief.guestsMax);
const incomeSchema = z.strictObject({
  ticketPrice: money,
  expectedPaidAttendance: headCount,
  sponsors: money,
  donations: money,
  stallCount: headCount,
  stallFee: money,
});

// `date` is checked for FORMAT only; calendar validity and today..today+730 need an injected `today`.
const briefFields = {
  name: z.string().trim().min(1).max(brief.nameMax),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  startTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u),
  durationHours: wholeNumber(brief.durationHoursMin, brief.durationHoursMax),
  city: z.string().trim().max(brief.cityMax),
  venue: z.enum(VENUES),
  guests: wholeNumber(brief.guestsMin, brief.guestsMax),
  budget: wholeNumber(brief.budgetMin, brief.budgetMax),
  currency: z.enum(CURRENCIES),
  dietary: optionList(z.enum(DIETARY_OPTIONS)),
  accessibility: optionList(z.enum(ACCESSIBILITY_OPTIONS)),
  amplifiedSound: z.boolean(),
  servesFood: z.boolean(),
  servesAlcohol: z.boolean(),
  volunteersAvailable: wholeNumber(0, brief.volunteersMax),
  vibe: z.string().trim().max(brief.vibeMax),
  notes: z.string().trim().max(brief.notesMax),
};

/** The user's event description. Strict everywhere; `income` exists only on community events. */
export const eventBriefSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...briefFields,
    kind: z.literal('community'),
    subtype: z.enum(SUBTYPES.community),
    income: incomeSchema.optional(),
  }),
  z.strictObject({
    ...briefFields,
    kind: z.literal('wedding'),
    subtype: z.enum(SUBTYPES.wedding),
  }),
  z.strictObject({
    ...briefFields,
    kind: z.literal('birthday'),
    subtype: z.enum(SUBTYPES.birthday),
  }),
]);
/** A validated event brief. */
export type EventBrief = z.infer<typeof eventBriefSchema>;

/** The template ids Gemini may reference; each list must be non-empty so it can form a `z.enum`. */
export interface TemplateIds {
  readonly categories: readonly [string, ...string[]];
  readonly tasks: readonly [string, ...string[]];
  readonly vendors: readonly [string, ...string[]];
}

// Strict on shape and ids, lenient on quantities: absurd numbers must reach the engine so it can
// clamp and log them rather than reject a paid response. The bounds travel as `.describe()` hints.
const buildAiSchema = (ids: TemplateIds) => {
  const ai = LIMITS.ai;
  const categoryId = z.enum(ids.categories);
  return z.strictObject({
    summary: z.string().describe(`Plan summary, at most ${ai.summaryMax} characters.`),
    ideas: z
      .array(
        z.strictObject({
          title: z.string().describe(`At most ${ai.ideaTitleMax} characters.`),
          description: z.string().describe(`At most ${ai.ideaDescriptionMax} characters.`),
          categoryId,
          estimatedCost: z.number().describe('Whole major currency units, 0 or more.'),
          personalization: z
            .string()
            .describe(
              `Names the brief fields this idea answers to, at most ${ai.personalizationMax} characters.`,
            ),
        }),
      )
      .describe(`At most ${ai.ideasMax} ideas.`),
    weightHints: z
      .array(
        z.strictObject({
          categoryId,
          factor: z
            .number()
            .describe(`Budget weight factor between ${ai.factorMin} and ${ai.factorMax}.`),
        }),
      )
      .describe(`At most ${ai.weightHintsMax} hints.`),
    extraTasks: z
      .array(
        z.strictObject({
          title: z.string().describe(`At most ${ai.taskTitleMax} characters.`),
          categoryId,
          durationDays: z
            .number()
            .describe(`Duration in days, ${ai.durationMin} to ${ai.durationMax}.`),
          leadDays: z
            .number()
            .describe(
              `Days before the event (negative means after), ${ai.leadMin} to ${ai.leadMax}.`,
            ),
          after: z
            .array(z.enum(ids.tasks))
            .describe(`At most ${ai.afterMax} task ids this follows.`),
        }),
      )
      .describe(`At most ${ai.extraTasksMax} tasks.`),
    vendorQuestions: z
      .array(
        z.strictObject({
          vendorId: z.enum(ids.vendors),
          questions: z
            .array(z.string().describe(`At most ${ai.questionMax} characters each.`))
            .describe(`At most ${ai.questionsPerVendorMax} questions.`),
        }),
      )
      .describe(`At most ${ai.vendorQuestionsMax} vendors.`),
  });
};
/** Gemini's structured response, with ids as plain strings (the schema narrows them per template). */
export type AiSuggestions = z.infer<ReturnType<typeof buildAiSchema>>;

/** Builds the response schema for one template, so the model cannot reference unknown ids. */
export const aiSuggestionsSchema = (ids: TemplateIds): z.ZodType<AiSuggestions> =>
  buildAiSchema(ids);

/** What the server reports about one model call, shown in the "AI at work" panel and kept with the plan. */
export const aiMetaSchema = z.strictObject({
  model: z.string().min(1).max(80),
  latencyMs: z.int().min(0),
  inputTokens: z.int().min(0),
  outputTokens: z.int().min(0),
  requestId: z.uuid(),
});
/** Metadata for one model call. */
export type AiMeta = z.infer<typeof aiMetaSchema>;
