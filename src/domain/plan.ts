/**
 * Plan assembly: runs every engine module for a brief and returns the whole plan in one value.
 * Does: checks the event date, builds the budget (planned for `plannedGuests`, then rescaled to the
 * brief's guest count), break-even, the timeline with any AI extra tasks, the vendors, the
 * volunteer shifts and the ideas with their budget fit. Every edit is a fresh call, so nothing
 * can drift out of step.
 * Never does: read the clock, call the model, or accept AI output that has not been through
 * `normalizeSuggestions` (merge.ts); `AiAddenda` is that function's output.
 */
import { err, ok, type Result } from '../shared/result.js';
import type { EventBrief } from '../shared/schema.js';
import { breakEven, type BreakEven } from './break-even.js';
import {
  buildBudget,
  checkGuestCount,
  rescaleGuests,
  type Budget,
  type WeightHint,
} from './budget.js';
import type { IsoDate } from './dates.js';
import { ideaFit, standardIdeas, type Idea, type IdeaFit } from './ideas.js';
import { eventDateOf, schedule, type Schedule, type ScheduleError } from './schedule.js';
import { templateFor } from './templates/index.js';
import type { TaskDef, TaskId } from './templates/types.js';
import { requiredVendors, type VendorItem } from './vendors.js';
import { planShifts, type ShiftPlan } from './volunteers.js';

/** Gemini's suggestions after the engine has clamped, cut and checked them. */
export interface AiAddenda {
  readonly summary: string;
  readonly ideas: readonly Idea[];
  /** Distinct template categories, factors within `LIMITS.ai.factorMin..factorMax`. */
  readonly weightHints: readonly WeightHint[];
  /** Ids `ai-task-N`; whole-number days; they follow only active template tasks. */
  readonly extraTasks: readonly TaskDef[];
  /** Questions for each vendor the plan needs, by vendor id. */
  readonly vendorQuestions: Readonly<Record<string, readonly string[]>>;
}

/**
 * An idea as the plan shows it, with its fit against the plan's own budget. Private until a
 * consumer needs it; reach it through `Plan["ideas"]`.
 */
type PlanIdea = Idea & { readonly fit: IdeaFit };

/** Everything `assemblePlan` needs; `eventDate` must come from `eventDateOf(brief, today)`. */
export interface PlanInput {
  readonly brief: EventBrief;
  readonly today: IsoDate;
  readonly eventDate: IsoDate;
  /** The guest count the budget was planned for; the brief holds the current count. */
  readonly plannedGuests: number;
  /** Task ids the user has ticked off. */
  readonly doneTasks: ReadonlySet<TaskId>;
  readonly addenda?: AiAddenda;
}

/** A complete event plan. Every figure in it was computed by the engine. */
export interface Plan {
  readonly brief: EventBrief;
  readonly today: IsoDate;
  readonly eventDate: IsoDate;
  readonly plannedGuests: number;
  readonly budget: Budget;
  readonly breakEven: BreakEven;
  readonly schedule: Schedule;
  readonly vendors: readonly VendorItem[];
  readonly shifts: ShiftPlan;
  /** The AI ideas when there are any, otherwise the standard ones. */
  readonly ideas: readonly PlanIdea[];
  /** Present only once AI suggestions have been merged. */
  readonly addenda?: AiAddenda;
}

/** Why no plan could be built: the event date is not a real date, is past, or is too far ahead. */
export type PlanError = Extract<ScheduleError, { kind: 'invalid_date' }>;

/**
 * Builds the plan from inputs that are already valid. Weight hints apply when the budget is
 * planned, before any rescale, and the budget is rescaled at most once.
 * @throws Error starting `invariant:` if the timeline cannot be built. Templates are acyclic and
 * normalized AI tasks only follow template tasks, so that is a bug, not a user error.
 * @throws RangeError if `plannedGuests` is not a whole number within the brief limits.
 */
export function assemblePlan(input: PlanInput): Plan {
  const { brief, today, eventDate, plannedGuests, doneTasks, addenda } = input;
  // plannedGuests comes from stored state, not the brief schema, so it is checked here.
  checkGuestCount(plannedGuests, 'Planned guest count');
  const template = templateFor(brief.kind);
  const hints = addenda?.weightHints ?? [];
  const budget =
    plannedGuests === brief.guests
      ? buildBudget(brief, template, hints)
      : rescaleGuests(
          buildBudget({ ...brief, guests: plannedGuests }, template, hints),
          brief.guests,
        );
  const timeline = schedule(
    [...template.tasks, ...(addenda?.extraTasks ?? [])],
    brief,
    today,
    doneTasks,
  );
  // A cycle cannot happen (see above) and the caller validated the date, so this is a bug.
  if (!timeline.ok) throw new Error(`invariant: no timeline (${JSON.stringify(timeline.error)})`);
  const ideas =
    addenda && addenda.ideas.length > 0 ? addenda.ideas : standardIdeas(template, brief, budget);
  return {
    brief,
    today,
    eventDate,
    plannedGuests,
    budget,
    breakEven: breakEven(budget, brief.kind === 'community' ? brief.income : undefined),
    schedule: timeline.value,
    vendors: requiredVendors(brief, template, eventDate),
    shifts: planShifts(brief),
    ideas: ideas.map((idea): PlanIdea => ({ ...idea, fit: ideaFit(idea, budget) })),
    ...(addenda ? { addenda } : {}),
  };
}

/**
 * Builds the plan for `brief` as of `today`. `plannedGuests` defaults to the brief's guest count
 * and `doneTasks` to none.
 * @returns the plan, or `{kind: 'invalid_date', reason}` when the event date is not a real date,
 * is before `today`, or is more than `LIMITS.brief.horizonDays` after it.
 * @throws RangeError if `plannedGuests` is not a whole number within the brief limits.
 */
export function buildPlan(
  brief: EventBrief,
  today: IsoDate,
  opts: {
    readonly addenda?: AiAddenda;
    readonly plannedGuests?: number;
    readonly doneTasks?: ReadonlySet<TaskId>;
  } = {},
): Result<Plan, PlanError> {
  const eventDate = eventDateOf(brief, today);
  if (!eventDate.ok) return err({ kind: 'invalid_date', reason: eventDate.error });
  const { addenda, plannedGuests = brief.guests, doneTasks = new Set<TaskId>() } = opts;
  return ok(
    assemblePlan({
      brief,
      today,
      eventDate: eventDate.value,
      plannedGuests,
      doneTasks,
      ...(addenda ? { addenda } : {}),
    }),
  );
}
