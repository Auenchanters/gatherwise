/**
 * Merging Gemini's suggestions: the one place untrusted model output meets the engine.
 * Does: trims and caps every string, clamps or drops every number, drops ids the plan cannot use,
 * logs each change as an `Adjustment` for the "Engine adjustments" panel, then re-assembles the
 * plan with what survived.
 * Never does: trust model numbers; discard the whole response for one bad value; change the
 * budget total; throw on any `AiSuggestions`-shaped input (NaN, ±Infinity, 1e300, huge lists,
 * emoji or right-to-left text included).
 */
import { LIMITS } from '../shared/limits';
import type { AiSuggestions, Currency, EventBrief } from '../shared/schema';
import type { WeightHint } from './budget';
import type { Idea } from './ideas';
import { formatMoney, isMinor, MINOR_PER_MAJOR, toMinor, type Minor } from './money';
import { assemblePlan, type AiAddenda, type Plan } from './plan';
import { templateFor } from './templates';
import type { EventTemplate, TaskDef, TaskId } from './templates/types';

/** One change the engine made to the model's response, shown to the user as is. */
export interface Adjustment {
  readonly kind: 'clamped' | 'dropped' | 'truncated';
  /** Where in the response, such as `ideas[2].estimatedCost` or `extraTasks[0].after[1]`. */
  readonly target: string;
  /** One short sentence with the values formatted, e.g. "Weight hint for Décor clamped from 9 to 2". */
  readonly detail: string;
}

/** What normalizing needs to know about the plan the suggestions are for. */
export interface MergeContext {
  readonly brief: EventBrief;
  readonly template: EventTemplate;
  /** The template tasks active for this brief, by id; extra tasks may only follow these. */
  readonly activeTasks: ReadonlyMap<TaskId, TaskDef>;
  /** The vendors this brief needs; questions for any other vendor are dropped. */
  readonly vendorIds: ReadonlySet<string>;
}

const ai = LIMITS.ai;
type Log = Adjustment[];

const dropped = (log: Log, target: string, detail: string): void => {
  log.push({ kind: 'dropped', target, detail });
};

// ponytail: counts code points, not graphemes, so a cut can still split a ZWJ emoji sequence;
// switch to Intl.Segmenter if that shows up.
/**
 * Trims `raw`, then cuts it to `max` code points (never inside a surrogate pair) and drops the
 * space left at the cut. Empty means the caller drops the item.
 */
function capText(raw: string, max: number, target: string, what: string, log: Log): string {
  const chars = Array.from(raw.trim());
  if (chars.length <= max) return chars.join('');
  log.push({
    kind: 'truncated',
    target,
    detail: `${what} shortened from ${chars.length} to ${max} characters`,
  });
  return chars.slice(0, max).join('').trimEnd();
}

/** The first `max` items; logs how many were cut. */
function capList<T>(items: readonly T[], max: number, target: string, noun: string, log: Log) {
  if (items.length > max) {
    log.push({
      kind: 'truncated',
      target,
      detail: `Kept the first ${max} of ${items.length} ${noun}`,
    });
  }
  return items.slice(0, max);
}

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

/** A model amount in major units for display; one too big for minor units is shown raw. */
function shownMoney(major: number, currency: Currency): string {
  const scaled = Math.round(major * MINOR_PER_MAJOR[currency]);
  return isMinor(scaled) ? formatMoney(scaled, currency) : String(major);
}

/**
 * A cost in whole major units from 0 to the whole budget, in minor units. Not a finite amount,
 * or negative, becomes 0; rounding to a whole unit is not logged.
 */
function capCost(raw: number, title: string, target: string, brief: EventBrief, log: Log): Minor {
  const { budget, currency } = brief;
  const valid = Number.isFinite(raw) && raw >= 0;
  const whole = valid ? Math.round(raw) : 0;
  const cost = Math.min(whole, budget);
  if (!valid || cost < whole) {
    const why = cost === budget ? ' (the whole budget)' : '';
    log.push({
      kind: 'clamped',
      target,
      detail: `Cost of '${title}' clamped from ${shownMoney(raw, currency)} to ${shownMoney(cost, currency)}${why}`,
    });
  }
  return toMinor(cost, currency);
}

function normalizeIdeas(ideas: AiSuggestions['ideas'], ctx: MergeContext, log: Log): Idea[] {
  const known = new Set(ctx.template.categories.map((c) => c.id));
  const out: Idea[] = [];
  for (const [i, raw] of capList(ideas, ai.ideasMax, 'ideas', 'ideas', log).entries()) {
    const at = `ideas[${i}]`;
    const title = capText(raw.title, ai.ideaTitleMax, `${at}.title`, `Title of idea ${i + 1}`, log);
    if (title === '') {
      dropped(log, at, `Dropped idea ${i + 1}: it has no title`);
      continue;
    }
    const description = capText(
      raw.description,
      ai.ideaDescriptionMax,
      `${at}.description`,
      `Description of '${title}'`,
      log,
    );
    if (description === '') {
      dropped(log, at, `Dropped idea '${title}': it has no description`);
      continue;
    }
    if (!known.has(raw.categoryId)) {
      dropped(log, at, `Dropped idea '${title}': its budget category is not in this plan`);
      continue;
    }
    const personalization = capText(
      raw.personalization,
      ai.personalizationMax,
      `${at}.personalization`,
      `Personalization of '${title}'`,
      log,
    );
    out.push({
      id: `ai-idea-${out.length + 1}`,
      title,
      description,
      categoryId: raw.categoryId,
      estimatedCost: capCost(raw.estimatedCost, title, `${at}.estimatedCost`, ctx.brief, log),
      ...(personalization === '' ? {} : { personalization }),
      source: 'ai',
    });
  }
  return out;
}

function normalizeHints(
  hints: AiSuggestions['weightHints'],
  ctx: MergeContext,
  log: Log,
): WeightHint[] {
  const labels = new Map(ctx.template.categories.map((c) => [c.id, c.label]));
  const out: WeightHint[] = [];
  const list = capList(hints, ai.weightHintsMax, 'weightHints', 'weight hints', log);
  for (const [i, { categoryId, factor }] of list.entries()) {
    const at = `weightHints[${i}]`;
    const label = labels.get(categoryId);
    if (label === undefined) {
      dropped(log, at, 'Dropped a weight hint for a budget category that is not in this plan');
    } else if (!Number.isFinite(factor)) {
      dropped(log, at, `Dropped the weight hint for ${label}: ${factor} is not a usable factor`);
    } else if (out.some((h) => h.categoryId === categoryId)) {
      dropped(log, at, `Dropped a second weight hint for ${label}`);
    } else {
      const kept = clamp(factor, ai.factorMin, ai.factorMax);
      if (kept !== factor) {
        log.push({
          kind: 'clamped',
          target: `${at}.factor`,
          detail: `Weight hint for ${label} clamped from ${factor} to ${kept}`,
        });
      }
      out.push({ categoryId, factor: kept });
    }
  }
  return out;
}

/** Rounds and clamps a finite day count; `+ 0` turns a rounded `-0` into `0`. */
function capDays(n: number, min: number, max: number, target: string, what: string, log: Log) {
  const days = clamp(Math.round(n), min, max) + 0;
  if (days !== n)
    log.push({ kind: 'clamped', target, detail: `${what} clamped from ${n} to ${days}` });
  return days;
}

/**
 * The dependencies an extra task keeps: active template tasks that are due no later than the extra
 * task must start (`lead(dep) >= lead + duration`), each once. That is the rule every template edge
 * already follows, so an extra task can never pull a template deadline earlier.
 */
function keptDependencies(
  after: readonly string[],
  task: Pick<TaskDef, 'title' | 'leadDays' | 'durationDays'>,
  at: string,
  ctx: MergeContext,
  log: Log,
): TaskId[] {
  const kept: TaskId[] = [];
  const list = capList(after, ai.afterMax, `${at}.after`, `tasks '${task.title}' follows`, log);
  for (const [j, id] of list.entries()) {
    const target = `${at}.after[${j}]`;
    const dep = ctx.activeTasks.get(id);
    if (dep === undefined) {
      dropped(log, target, `'${task.title}' no longer waits on a task that is not in this plan`);
    } else if (dep.leadDays < task.leadDays + task.durationDays) {
      dropped(
        log,
        target,
        `'${task.title}' no longer waits on '${dep.title}', which is due after it has to start`,
      );
    } else if (kept.includes(id)) {
      dropped(log, target, `'${task.title}' already waits on '${dep.title}'`);
    } else {
      kept.push(id);
    }
  }
  return kept;
}

function normalizeTasks(
  tasks: AiSuggestions['extraTasks'],
  ctx: MergeContext,
  log: Log,
): TaskDef[] {
  const known = new Set(ctx.template.categories.map((c) => c.id));
  const out: TaskDef[] = [];
  for (const [i, raw] of capList(
    tasks,
    ai.extraTasksMax,
    'extraTasks',
    'extra tasks',
    log,
  ).entries()) {
    const at = `extraTasks[${i}]`;
    const title = capText(
      raw.title,
      ai.taskTitleMax,
      `${at}.title`,
      `Title of extra task ${i + 1}`,
      log,
    );
    if (title === '') {
      dropped(log, at, `Dropped extra task ${i + 1}: it has no title`);
      continue;
    }
    if (!known.has(raw.categoryId)) {
      dropped(log, at, `Dropped extra task '${title}': its budget category is not in this plan`);
      continue;
    }
    if (!Number.isFinite(raw.durationDays) || !Number.isFinite(raw.leadDays)) {
      const field = Number.isFinite(raw.durationDays) ? 'lead time' : 'duration';
      dropped(log, at, `Dropped extra task '${title}': its ${field} is not a number of days`);
      continue;
    }
    const durationDays = capDays(
      raw.durationDays,
      ai.durationMin,
      ai.durationMax,
      `${at}.durationDays`,
      `Duration of '${title}' in days`,
      log,
    );
    const leadDays = capDays(
      raw.leadDays,
      ai.leadMin,
      ai.leadMax,
      `${at}.leadDays`,
      `Lead time of '${title}' in days`,
      log,
    );
    out.push({
      id: `ai-task-${out.length + 1}`,
      title,
      categoryId: raw.categoryId,
      durationDays,
      leadDays,
      dependsOn: keptDependencies(raw.after, { title, leadDays, durationDays }, at, ctx, log),
    });
  }
  return out;
}

function normalizeQuestions(
  entries: AiSuggestions['vendorQuestions'],
  ctx: MergeContext,
  log: Log,
): Record<string, readonly string[]> {
  const labels = new Map(ctx.template.vendors.map((v) => [v.id, v.label]));
  const out = new Map<string, readonly string[]>();
  const list = capList(entries, ai.vendorQuestionsMax, 'vendorQuestions', 'vendors', log);
  for (const [i, { vendorId, questions }] of list.entries()) {
    const at = `vendorQuestions[${i}]`;
    const label = labels.get(vendorId) ?? 'an unknown vendor';
    if (!ctx.vendorIds.has(vendorId)) {
      dropped(log, at, `Dropped questions for ${label}: this plan does not need that vendor`);
      continue;
    }
    if (out.has(vendorId)) {
      dropped(log, at, `Dropped a second set of questions for ${label}`);
      continue;
    }
    const kept: string[] = [];
    const asked = capList(questions, ai.questionsPerVendorMax, `${at}.questions`, 'questions', log);
    for (const [j, raw] of asked.entries()) {
      const target = `${at}.questions[${j}]`;
      const question = capText(raw, ai.questionMax, target, `Question ${j + 1} for ${label}`, log);
      if (question === '') dropped(log, target, `Dropped an empty question for ${label}`);
      else kept.push(question);
    }
    if (kept.length === 0) dropped(log, at, `Dropped ${label}: no questions were left`);
    else out.set(vendorId, kept);
  }
  return Object.fromEntries(out);
}

/**
 * Turns a model response into addenda the engine can use, and lists every change made.
 * Strings are trimmed and cut to `LIMITS.ai` by code point; an item whose required text is empty
 * is dropped. Lists keep their first `LIMITS.ai` items. Ids the template or the brief cannot use
 * are dropped. Costs become whole major units from 0 to the brief's budget; weight factors are
 * clamped to their band; durations and lead times are rounded and clamped to whole days.
 *
 * No response can create a dependency cycle: extra tasks may only follow active template tasks
 * (the schema allows template ids only) and nothing follows an extra task, so there is no
 * "rejected cycle" adjustment. A kept dependency is also always due before the extra task starts,
 * so the template's own deadlines never move.
 */
export function normalizeSuggestions(
  s: AiSuggestions,
  ctx: MergeContext,
): { addenda: AiAddenda; adjustments: Adjustment[] } {
  const log: Log = [];
  const addenda: AiAddenda = {
    summary: capText(s.summary, ai.summaryMax, 'summary', 'Summary', log),
    ideas: normalizeIdeas(s.ideas, ctx, log),
    weightHints: normalizeHints(s.weightHints, ctx, log),
    extraTasks: normalizeTasks(s.extraTasks, ctx, log),
    vendorQuestions: normalizeQuestions(s.vendorQuestions, ctx, log),
  };
  return { addenda, adjustments: log };
}

/**
 * Normalizes `s` against `plan` and rebuilds the plan with it, keeping today, the planned and
 * current guest counts and the ticked template tasks. The new addenda replace any earlier ones,
 * so a tick on an old AI task is not carried over to a new task that reuses its id.
 * The budget total never changes: hints only re-weight the categories within it.
 */
export function mergeSuggestions(
  plan: Plan,
  s: AiSuggestions,
): { plan: Plan; adjustments: Adjustment[] } {
  const { brief, today, eventDate, plannedGuests } = plan;
  const template = templateFor(brief.kind);
  const scheduled = new Set(plan.schedule.tasks.map((t) => t.id));
  const activeTasks = new Map(
    template.tasks.filter((t) => scheduled.has(t.id)).map((t) => [t.id, t]),
  );
  const { addenda, adjustments } = normalizeSuggestions(s, {
    brief,
    template,
    activeTasks,
    vendorIds: new Set(plan.vendors.map((v) => v.id)),
  });
  const doneTasks = new Set(
    plan.schedule.tasks
      .filter((t) => t.status === 'done' && activeTasks.has(t.id))
      .map((t) => t.id),
  );
  return {
    plan: assemblePlan({ brief, today, eventDate, plannedGuests, doneTasks, addenda }),
    adjustments,
  };
}
