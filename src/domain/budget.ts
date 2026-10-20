/**
 * The event budget: a total split into a contingency and one line per template category, and
 * rescaled when the guest count changes. The product's promise, "plans that add up", lives here.
 * Does: builds the lines with exact integer allocation (largest remainder, in paise or cents),
 * applies Gemini's weight hints, flags lines too small to be real, and keeps
 * `sum(lines) + contingency === total + (overBy ?? 0)` true after every call.
 * Never does: trust AI numbers (hints are validated preconditions, clamped upstream by the merge
 * step and rejected here if they slipped through), use floats where an integer will do, cut a line
 * silently to make a total fit, or lose or invent a paisa.
 */
import { LIMITS } from '../shared/limits';
import type { AiSuggestions, Currency, EventBrief } from '../shared/schema';
import { allocate, MINOR_PER_MAJOR, minor, toMinor, type Minor } from './money';
import type { CategoryDef, EventTemplate } from './templates/types';

/** Share of the total held back as contingency, in percent. The spec fixes it at 10. */
export const CONTINGENCY_PERCENT = 10;

/**
 * Sanity floor, in major units per guest, for a line that scales with guests. A line below it is
 * flagged `too_low`. It is a check that the money is not rounding to nothing, not a price estimate.
 */
export const MIN_PER_GUEST_MAJOR = 1;

/** One of Gemini's suggestions to weight a budget category up or down. */
export type WeightHint = AiSuggestions['weightHints'][number];

/** One budget category with the money allocated to it. */
export interface BudgetLine {
  readonly categoryId: string;
  readonly label: string;
  readonly allocated: Minor;
  /** Whether the line follows the guest count when it changes. */
  readonly scales: CategoryDef['scales'];
  /** Set when the amount is under the sanity floor; absent otherwise. */
  readonly warning?: 'too_low';
}

/**
 * A reconciled budget. `sum(lines) + contingency === total + (overBy ?? 0)` always holds.
 * Immutable: every function here returns a new one.
 */
export interface Budget {
  readonly currency: Currency;
  readonly guests: number;
  /** What the organizer said they can spend. Never changed by a rescale. */
  readonly total: Minor;
  /** What the lines leave of the total; 10% to start with, and 0 once the lines have eaten it. */
  readonly contingency: Minor;
  /** In template category order. */
  readonly lines: readonly BudgetLine[];
  /** The total per guest, rounded down. */
  readonly perGuest: Minor;
  /** How far the lines overshoot the total after a rescale. Absent unless positive. */
  readonly overBy?: Minor;
}

type LineDraft = Omit<BudgetLine, 'warning'>;

/** Applies the sanity floor, building a fresh line so a stale warning is never carried over. */
function withWarning(
  { categoryId, label, allocated, scales }: LineDraft,
  guests: number,
  currency: Currency,
): BudgetLine {
  const floor = guests * MIN_PER_GUEST_MAJOR * MINOR_PER_MAJOR[currency];
  const tooLow = scales === 'per_guest' ? allocated < floor : allocated === 0;
  return tooLow
    ? { categoryId, label, allocated, scales, warning: 'too_low' }
    : { categoryId, label, allocated, scales };
}

/** Everything about a budget except its lines. */
type Frame = Pick<Budget, 'currency' | 'guests' | 'total' | 'contingency'>;

/** Adds the warnings, the per-guest figure and, when positive, `overBy` to the drafted lines. */
function assemble(frame: Frame, drafts: readonly LineDraft[], overBy: Minor): Budget {
  const { currency, guests, total } = frame;
  return {
    ...frame,
    lines: drafts.map((draft) => withWarning(draft, guests, currency)),
    perGuest: minor(Math.floor(total / guests)),
    ...(overBy > 0 ? { overBy } : {}),
  };
}

/**
 * Checks Gemini's hints against the template and indexes them by category.
 * @throws RangeError for an unknown category, a factor outside the allowed band or a repeated
 * category. That is a programming error: the merge step clamps and drops hints before this runs.
 */
function factorsByCategory(
  template: EventTemplate,
  hints: readonly WeightHint[],
): ReadonlyMap<string, number> {
  const known = new Set(template.categories.map((category) => category.id));
  const { factorMin, factorMax } = LIMITS.ai;
  const factors = new Map<string, number>();
  for (const { categoryId, factor } of hints) {
    const inBand = factor >= factorMin && factor <= factorMax;
    if (!known.has(categoryId))
      throw new RangeError(`Weight hint for unknown category: ${categoryId}`);
    if (!inBand)
      throw new RangeError(`Weight hint factor outside ${factorMin}..${factorMax}: ${factor}`);
    if (factors.has(categoryId))
      throw new RangeError(`Two weight hints for one category: ${categoryId}`);
    factors.set(categoryId, factor);
  }
  return factors;
}

/**
 * Builds the budget for a brief: 10% contingency off the top, then the rest split across the
 * template's categories by weight. A hint multiplies its category's weight by its factor.
 * @throws RangeError if a hint names a category the template lacks, has a factor outside
 * `LIMITS.ai.factorMin..factorMax`, or repeats a category. Hints are a precondition, not user
 * input: the merge step clamps them first.
 */
export function buildBudget(
  brief: EventBrief,
  template: EventTemplate,
  hints: readonly WeightHint[] = [],
): Budget {
  const factors = factorsByCategory(template, hints);
  const total = toMinor(brief.budget, brief.currency);
  const [contingency = minor(0)] = allocate(total, [
    CONTINGENCY_PERCENT,
    100 - CONTINGENCY_PERCENT,
  ]);
  const shares = allocate(
    minor(total - contingency),
    template.categories.map((category) => category.weight * (factors.get(category.id) ?? 1)),
  );
  const drafts = template.categories.map((category, i): LineDraft => {
    // `allocate` returns one share per weight, so the default only satisfies the indexed access.
    const [allocated = minor(0)] = shares.slice(i);
    return { categoryId: category.id, label: category.label, allocated, scales: category.scales };
  });
  const { currency, guests } = brief;
  return assemble({ currency, guests, total, contingency }, drafts, minor(0));
}

/**
 * Moves a budget to a new guest count. Per-guest lines scale by the ratio, each rounded to the
 * nearest paisa; fixed lines stay. The total never changes, so the contingency becomes whatever
 * the lines leave of it: a rise in cost is absorbed by the contingency first, and anything beyond
 * it is reported as `overBy` (nothing is cut); a fall returns the freed money to the contingency.
 * Warnings and `perGuest` are recomputed. Works from an over-budget budget too.
 * @throws RangeError if `guests` is not a whole number within the brief limits.
 */
export function rescaleGuests(budget: Budget, guests: number): Budget {
  const { guestsMin, guestsMax } = LIMITS.brief;
  if (!Number.isInteger(guests) || guests < guestsMin || guests > guestsMax) {
    throw new RangeError(`Guest count must be a whole number from ${guestsMin} to ${guestsMax}`);
  }
  const drafts = budget.lines.map((line) =>
    line.scales === 'per_guest'
      ? { ...line, allocated: minor(Math.round((line.allocated * guests) / budget.guests)) }
      : line,
  );
  const gap = drafts.reduce((acc, line) => acc + line.allocated, 0) - budget.total;
  const { currency, total } = budget;
  return assemble(
    { currency, guests, total, contingency: minor(Math.max(0, -gap)) },
    drafts,
    minor(Math.max(0, gap)),
  );
}
