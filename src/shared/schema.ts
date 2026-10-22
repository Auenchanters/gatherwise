/**
 * The zod contracts shared by browser and server: the user's EventBrief (strict, validated at the
 * trust boundary), the per-template AiSuggestions Gemini returns (strict on shape and ids only) and
 * the AiMeta that travels beside them.
 * Never trusts model numbers: the LIMITS.ai bounds (limits.ts) go to Gemini in its JSON Schema,
 * and the engine enforces them whatever comes back.
 */
import { z } from 'zod';
import { LIMITS } from './limits.js';
import {
  ACCESSIBILITY_OPTIONS,
  CURRENCIES,
  DIETARY_OPTIONS,
  LANGUAGES,
  SUBTYPES,
  VENUES,
} from './options.js';

// The option lists live in import-free options.ts so the first page can render the form without
// zod; they are re-exported here so contract users keep one import site.
export {
  ACCESSIBILITY_OPTIONS,
  CURRENCIES,
  DIETARY_OPTIONS,
  EVENT_KINDS,
  LANGUAGES,
  SUBTYPES,
  VENUES,
  type Currency,
} from './options.js';

// Every module that builds or parses a schema imports this one first. Jitless keeps zod from
// probing for `eval` with `Function('')`, which Trusted Types reports as a blocked script sink.
z.config({ jitless: true });

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
  // Briefs saved or sent before the language existed are English, which they were written in.
  language: z.enum(LANGUAGES).default('English'),
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

/**
 * Gemini's answer for one template: strict on shape and ids (every id field is an enum of that
 * template's ids). `bounded` is for the copy Gemini is given: it adds the string and number caps
 * from `LIMITS.ai` as `maxLength`, `minimum` and `maximum`. List caps stay descriptions only: with
 * `maxItems` on three or more lists, Gemini refused the whole request (400 INVALID_ARGUMENT, checked
 * live on 2026-10-22), so the server caps lists instead (sanitize.ts). The copy that parses answers
 * has no caps at all, so an absurd value reaches the engine to be clamped and listed instead of
 * costing the whole paid answer.
 */
const buildAiSchema = (ids: TemplateIds, bounded: boolean) => {
  const ai = LIMITS.ai;
  const text = (max: number, hint: string) =>
    (bounded ? z.string().max(max) : z.string()).describe(hint);
  const count = (min: number, max: number, hint: string) =>
    (bounded ? z.number().min(min).max(max) : z.number()).describe(hint);
  const list = <T extends z.ZodType>(item: T, hint: string) => z.array(item).describe(hint);
  const categoryId = z.enum(ids.categories);
  return z.strictObject({
    summary: text(ai.summaryMax, `Plan summary, at most ${ai.summaryMax} characters.`),
    ideas: list(
      z.strictObject({
        title: text(ai.ideaTitleMax, `At most ${ai.ideaTitleMax} characters.`),
        description: text(ai.ideaDescriptionMax, `At most ${ai.ideaDescriptionMax} characters.`),
        categoryId,
        estimatedCost: count(
          0,
          LIMITS.brief.budgetMax,
          'Whole major currency units, 0 or more, within the category amount.',
        ),
        personalization: text(
          ai.personalizationMax,
          `Names the brief fields this idea answers to, at most ${ai.personalizationMax} characters.`,
        ),
      }),
      `At most ${ai.ideasMax} ideas.`,
    ),
    extraTasks: list(
      z.strictObject({
        title: text(ai.taskTitleMax, `At most ${ai.taskTitleMax} characters.`),
        categoryId,
        durationDays: count(
          ai.durationMin,
          ai.durationMax,
          `Duration in whole days, ${ai.durationMin} to ${ai.durationMax}.`,
        ),
        leadDays: count(
          ai.leadMin,
          ai.leadMax,
          `Whole days before the event (negative means after), ${ai.leadMin} to ${ai.leadMax}.`,
        ),
        after: list(z.enum(ids.tasks), `At most ${ai.afterMax} task ids this follows.`),
      }),
      `At most ${ai.extraTasksMax} tasks.`,
    ),
    vendorQuestions: list(
      z.strictObject({
        vendorId: z.enum(ids.vendors),
        questions: list(
          text(ai.questionMax, `At most ${ai.questionMax} characters each.`),
          `At most ${ai.questionsPerVendorMax} questions.`,
        ),
      }),
      `At most ${ai.vendorQuestionsMax} vendors.`,
    ),
  });
};
/** The zod schema of one template's answer; its `shape` gives each section's own schema. */
export type AiSuggestionsSchema = ReturnType<typeof buildAiSchema>;
/** Gemini's structured response, with ids as plain strings (the schema narrows them per template). */
export type AiSuggestions = z.infer<AiSuggestionsSchema>;

/** The schema answers are parsed with: strict shape and ids, no caps on quantities. */
export const aiSuggestionsSchema = (ids: TemplateIds): AiSuggestionsSchema =>
  buildAiSchema(ids, false);

/** The schema Gemini is given, as JSON Schema: the parse schema plus the string and number caps. */
export const aiResponseJsonSchema = (ids: TemplateIds): z.core.JSONSchema.BaseSchema =>
  z.toJSONSchema(buildAiSchema(ids, true));

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
