/**
 * The plan state machine: every user edit as a pure function from state and action to state.
 * Does: keeps only the plan's inputs (brief, planned guests, ticks, the AI response) and derives the
 * plan from them in one place, `restorePlanState`, which a stored plan is rebuilt through as well.
 * So a guest, budget, date or tick edit recomputes the whole plan locally and never asks the model:
 * the `ai` value passes through untouched. A rejected edit keeps the plan and sets `error`; the next
 * good one clears it. Ticks for ids the plan has lost stay stored and return if the id does.
 * Never does: call the model; read the clock (`today` arrives in the action); mutate state or action.
 * Whether a response is still wanted is decided by its `generation`, never by timing.
 */
import { LIMITS } from '../shared/limits';
import { err, ok, type Result } from '../shared/result';
import type { AiMeta, AiSuggestions, EventBrief } from '../shared/schema';
import type { IsoDate } from './dates';
import { AI_TASK_PREFIX, mergeSuggestions, type Adjustment } from './merge';
import { buildPlan, type Plan } from './plan';
import type { TaskId } from './templates/types';
import type { VendorItem, VendorStatus } from './vendors';

/** What the user has ticked or set. Ids stay here even when the plan no longer has them. */
interface Progress {
  readonly doneTasks: readonly TaskId[];
  /** Only vendors the user has touched; the rest are `to_contact`. */
  readonly vendorStatus: Readonly<Record<string, VendorStatus>>;
  /** Checklist item ids (`vendorId:index`) ticked off. */
  readonly checklistDone: readonly string[];
}

/** Where the one model call for this plan stands. Absent fields are left out, never `undefined`. */
export interface AiState {
  readonly status: 'idle' | 'pending' | 'applied' | 'failed';
  readonly suggestions?: AiSuggestions;
  readonly meta?: AiMeta;
  /** A short client error code, set only while `status` is `failed`. */
  readonly error?: string;
}

/** Why an action was refused. The plan before it is kept. */
export type PlanStateError =
  | { readonly kind: 'invalid_date'; readonly reason: 'invalid' | 'past' | 'too_far' }
  | { readonly kind: 'invalid_guests' }
  | { readonly kind: 'invalid_budget' };

/** A plan with the inputs it came from. `plan` and `adjustments` are derived, never stored. */
export interface ReadyState {
  readonly phase: 'ready';
  readonly brief: EventBrief;
  readonly today: IsoDate;
  /** The guest count the budget was planned for; `brief.guests` is the current count. */
  readonly plannedGuests: number;
  /** Counts briefs submitted; an AI response applies only to the generation that asked for it. */
  readonly generation: number;
  readonly progress: Progress;
  readonly ai: AiState;
  readonly plan: Plan;
  /** What the engine changed in the AI response; empty without one. */
  readonly adjustments: readonly Adjustment[];
  readonly error?: PlanStateError;
}

/** Either no plan yet, or a ready one. */
export type PlanState = { readonly phase: 'empty'; readonly error?: PlanStateError } | ReadyState;

/** Everything the user or the AI call can do to a plan. */
export type PlanAction =
  | { readonly type: 'brief/submitted'; readonly brief: EventBrief; readonly today: IsoDate }
  | { readonly type: 'ai/requested'; readonly generation: number }
  | {
      readonly type: 'ai/applied';
      readonly generation: number;
      readonly suggestions: AiSuggestions;
      readonly meta: AiMeta;
    }
  | { readonly type: 'ai/failed'; readonly generation: number; readonly error: string }
  | { readonly type: 'guests/changed'; readonly guests: number }
  | { readonly type: 'budget/changed'; readonly budget: number }
  | { readonly type: 'date/changed'; readonly date: string }
  | { readonly type: 'today/changed'; readonly today: IsoDate }
  | { readonly type: 'task/toggled'; readonly taskId: TaskId }
  | { readonly type: 'vendor/status'; readonly vendorId: string; readonly status: VendorStatus }
  | { readonly type: 'vendor/check'; readonly itemId: string }
  | { readonly type: 'plan/reset' };

/** The state before any brief is submitted, and after a reset. */
export const initialPlanState: PlanState = { phase: 'empty' };

const NO_PROGRESS: Progress = { doneTasks: [], vendorStatus: {}, checklistDone: [] };

/**
 * The only place a plan is derived. Builds it from the inputs at the planned guest count with the
 * ticks applied, then, if there is an AI response, runs it through `mergeSuggestions` with the same
 * ticks (AI task ids are the same for the same response, so their ticks hold). Both an edit and a
 * stored plan come through here.
 * @returns the state, or why the brief's date cannot be planned as of `today`.
 * @throws RangeError if `plannedGuests` is not a whole number within the brief limits; a caller
 * holding untrusted values must check them first.
 */
export function restorePlanState(
  inputs: Pick<ReadyState, 'brief' | 'today' | 'plannedGuests' | 'generation' | 'progress' | 'ai'>,
): Result<ReadyState, PlanStateError> {
  const { brief, today, plannedGuests, generation, progress, ai } = inputs;
  const doneTasks = new Set(progress.doneTasks);
  const built = buildPlan(brief, today, { plannedGuests, doneTasks });
  if (!built.ok) return err(built.error);
  const merged = ai.suggestions
    ? mergeSuggestions(built.value, ai.suggestions, { doneTasks })
    : undefined;
  return ok({
    phase: 'ready',
    brief,
    today,
    plannedGuests,
    generation,
    progress,
    ai,
    plan: merged ? merged.plan : built.value,
    adjustments: merged ? merged.adjustments : [],
  });
}

const isWhole = (n: number, min: number, max: number): boolean =>
  Number.isInteger(n) && n >= min && n <= max;

/** The state with `error` set and nothing else changed. */
const refuse = (state: PlanState, error: PlanStateError): PlanState => ({ ...state, error });

/** Re-derives `state` with some inputs replaced; if that cannot be planned, refuses with why. */
function change(
  state: ReadyState,
  patch: Partial<Pick<ReadyState, 'brief' | 'today' | 'plannedGuests' | 'progress' | 'ai'>>,
): PlanState {
  const next = restorePlanState({ ...state, ...patch });
  return next.ok ? next.value : refuse(state, next.error);
}

/** `items` with `item` added, or taken out if it was there. */
const toggled = (items: readonly string[], item: string): readonly string[] =>
  items.includes(item) ? items.filter((i) => i !== item) : [...items, item];

/** The result an AI state holds, so a pending or failed refresh does not lose the last good one. */
const keepResult = ({ suggestions, meta }: AiState): Pick<AiState, 'suggestions' | 'meta'> => ({
  ...(suggestions ? { suggestions } : {}),
  ...(meta ? { meta } : {}),
});

/** Starts over with `brief`. A date that cannot be planned keeps whatever state there was. */
function submit(state: PlanState, brief: EventBrief, today: IsoDate): PlanState {
  const next = restorePlanState({
    brief,
    today,
    plannedGuests: brief.guests,
    generation: state.phase === 'ready' ? state.generation + 1 : 1,
    progress: NO_PROGRESS,
    ai: { status: 'idle' },
  });
  return next.ok ? next.value : refuse(state, next.error);
}

/**
 * Applies one action. Pure: the same state and action give the same result, and neither is changed.
 *
 * Every edit re-derives the plan locally and leaves `ai` as it was, so only `ai/*` actions concern
 * the model (the zero-call guarantee). Guests change `brief.guests` but not `plannedGuests`, so the
 * budget rescales; a new budget re-plans at the current guest count. Actions that need a plan do
 * nothing on an empty state, `ai/*` actions do nothing when their `generation` is not the current
 * one, and a task, vendor or checklist id the plan does not have is ignored (progress stays bounded).
 * A new response replaces the old, so ticks on `ai-task-N` ids are cleared: the same id could be
 * a different task now.
 */
export function planReducer(state: PlanState, action: PlanAction): PlanState {
  if (action.type === 'plan/reset') return initialPlanState;
  if (action.type === 'brief/submitted') return submit(state, action.brief, action.today);
  if (state.phase === 'empty') return state;

  const { brief, plan, progress, ai } = state;
  switch (action.type) {
    case 'ai/requested':
      if (action.generation !== state.generation) return state;
      return change(state, { ai: { status: 'pending', ...keepResult(ai) } });
    case 'ai/applied':
      if (action.generation !== state.generation) return state;
      return change(state, {
        ai: { status: 'applied', suggestions: action.suggestions, meta: action.meta },
        progress: {
          ...progress,
          doneTasks: progress.doneTasks.filter((id) => !id.startsWith(AI_TASK_PREFIX)),
        },
      });
    case 'ai/failed':
      if (action.generation !== state.generation) return state;
      return change(state, { ai: { status: 'failed', ...keepResult(ai), error: action.error } });
    case 'guests/changed':
      return isWhole(action.guests, LIMITS.brief.guestsMin, LIMITS.brief.guestsMax)
        ? change(state, { brief: { ...brief, guests: action.guests } })
        : refuse(state, { kind: 'invalid_guests' });
    case 'budget/changed':
      return isWhole(action.budget, LIMITS.brief.budgetMin, LIMITS.brief.budgetMax)
        ? change(state, {
            brief: { ...brief, budget: action.budget },
            plannedGuests: brief.guests,
          })
        : refuse(state, { kind: 'invalid_budget' });
    case 'date/changed':
      return change(state, { brief: { ...brief, date: action.date } });
    case 'today/changed':
      return change(state, { today: action.today });
    case 'task/toggled':
      return plan.schedule.tasks.some((t) => t.id === action.taskId)
        ? change(state, {
            progress: { ...progress, doneTasks: toggled(progress.doneTasks, action.taskId) },
          })
        : state;
    case 'vendor/status':
      return plan.vendors.some((v) => v.id === action.vendorId)
        ? change(state, {
            progress: {
              ...progress,
              vendorStatus: { ...progress.vendorStatus, [action.vendorId]: action.status },
            },
          })
        : state;
    case 'vendor/check':
      return plan.vendors.some((v) => v.checklist.some((c) => c.id === action.itemId))
        ? change(state, {
            progress: {
              ...progress,
              checklistDone: toggled(progress.checklistDone, action.itemId),
            },
          })
        : state;
  }
}

/**
 * The plan's vendors as the user sees them: the status they set instead of `to_contact`, and each
 * checklist item ticked as they left it. Empty before there is a plan.
 */
export function vendorView(state: PlanState): readonly VendorItem[] {
  if (state.phase === 'empty') return [];
  const { vendorStatus, checklistDone } = state.progress;
  const ticked = new Set(checklistDone);
  return state.plan.vendors.map((vendor) => ({
    ...vendor,
    status: vendorStatus[vendor.id] ?? vendor.status,
    checklist: vendor.checklist.map((item) => ({ ...item, done: ticked.has(item.id) })),
  }));
}
