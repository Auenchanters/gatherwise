/**
 * Merging Gemini's suggestions: the one place untrusted model output meets the engine.
 * Does: trims and caps every string, clamps or drops every number, drops ids the plan cannot use,
 * logs each change as an `Adjustment` for the "Engine adjustments" panel, then re-assembles the
 * plan with what survived. Every input item is accounted for: kept, dropped with one adjustment,
 * or cut by a list cap that says how many it cut.
 * Never does: trust model numbers; discard the whole response for one bad value; change the
 * budget total; throw on any `AiSuggestions`-shaped input (NaN, ±Infinity, 1e300, huge lists,
 * emoji or right-to-left text included).
 */
import { LIMITS } from '../shared/limits.js';
import type { AiSuggestions, Currency, EventBrief } from '../shared/schema.js';
import type { Idea } from './ideas.js';
import { formatMoney, isMinor, MINOR_PER_MAJOR, toMinor, type Minor } from './money.js';
import { assemblePlan, type AiAddenda, type Plan } from './plan.js';
import { templateFor } from './templates/index.js';
import type { EventTemplate, TaskDef, TaskId } from './templates/types.js';

/** One change the engine made to the model's response, shown to the user as is. */
export interface Adjustment {
  readonly kind: 'clamped' | 'dropped' | 'truncated';
  /** Where in the response, such as `ideas[2].estimatedCost` or `extraTasks[0].after[1]`. */
  readonly target: string;
  /** One short sentence with the values formatted, e.g. "Duration of 'Print flyers' in days clamped from 90 to 60". */
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

/** Extra tasks are named this prefix plus N, counting from 1 in response order (`ai-task-1`). */
const AI_TASK_PREFIX = 'ai-task-';

/** Whether a task came from Gemini rather than the template, so it must carry the AI label. */
export const isAiTask = (id: TaskId): boolean => id.startsWith(AI_TASK_PREFIX);

/** The label every AI-written text carries: chips, calendar entries and copy all say it this way. */
export const AI_LABEL = 'AI · personalized';

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

/** Text trimmed and cut to a cap; `from` and `to` are its length in code points before and after. */
interface Cut {
  readonly text: string;
  readonly from: number;
  readonly to: number;
}

// ponytail: counts code points, not graphemes, so a cut can still split a ZWJ emoji sequence;
// switch to Intl.Segmenter if that shows up.
/** Trims `raw` and cuts it to `max` code points (never inside a surrogate pair), then trims the cut. */
function cut(raw: string, max: number): Cut {
  const chars = Array.from(raw.trim());
  const text = chars.slice(0, max).join('').trimEnd();
  return { text, from: chars.length, to: Array.from(text).length };
}

/**
 * Starts normalizing one response: the context, the lookups every list needs (built once), and
 * the recorder each helper reports its changes to.
 */
function startPass(ctx: MergeContext) {
  const log: Adjustment[] = [];
  const add = (kind: Adjustment['kind'], target: string, detail: string): void => {
    log.push({ kind, target, detail });
  };
  return {
    ctx,
    log,
    /** Category id to label; a category missing here is not in this plan. */
    categories: new Map(ctx.template.categories.map((c) => [c.id, c.label])),
    dropped: (target: string, detail: string): void => {
      add('dropped', target, detail);
    },
    clamped: (target: string, detail: string): void => {
      add('clamped', target, detail);
    },
    /** The cut text, logging the cut when there was one. */
    text(c: Cut, target: string, what: string): string {
      if (c.to < c.from)
        add('truncated', target, `${what} shortened from ${c.from} to ${c.to} characters`);
      return c.text;
    },
    /** The first `max` items, logging how many were cut. */
    list<T>(items: readonly T[], max: number, target: string, noun: string): readonly T[] {
      if (items.length > max)
        add('truncated', target, `Kept the first ${max} of ${items.length} ${noun}`);
      return items.slice(0, max);
    },
    /** A finite day count rounded and clamped; rounding alone is not an adjustment. */
    days(n: number, min: number, max: number, target: string, what: string): number {
      const rounded = Math.round(n) + 0; // `+ 0` turns a rounded -0 into 0
      const days = clamp(rounded, min, max);
      if (days !== rounded) add('clamped', target, `${what} clamped from ${rounded} to ${days}`);
      return days;
    },
  };
}
type Pass = ReturnType<typeof startPass>;

/** An amount in major units as text; one that is not finite or not whole paise is put in words. */
function moneyText(major: number, currency: Currency): string {
  const perMajor = MINOR_PER_MAJOR[currency];
  const scaled = Math.round(major * perMajor);
  return isMinor(scaled) && scaled / perMajor === major
    ? formatMoney(scaled, currency)
    : 'an unusable amount';
}

/**
 * A cost in whole major units from 0 to the whole budget, in minor units. A cost that is not
 * finite becomes 0. Rounding to a whole unit is not an adjustment; moving beyond it is.
 */
function capCost(raw: number, title: string, target: string, p: Pass): Minor {
  const { budget, currency } = p.ctx.brief;
  const rounded = Number.isFinite(raw) ? Math.round(raw) + 0 : undefined;
  const cost = rounded === undefined ? 0 : clamp(rounded, 0, budget);
  if (cost !== rounded) {
    const why = cost === budget ? ' (the whole budget)' : '';
    p.clamped(
      target,
      `Cost of '${title}' clamped from ${moneyText(raw, currency)} to ${moneyText(cost, currency)}${why}`,
    );
  }
  return toMinor(cost, currency);
}

// Each list checks an item's structure (text present, ids known, numbers finite) before cutting or
// clamping anything, so a dropped item logs exactly one adjustment.

function normalizeIdeas(ideas: AiSuggestions['ideas'], p: Pass): Idea[] {
  const out: Idea[] = [];
  for (const [i, raw] of p.list(ideas, ai.ideasMax, 'ideas', 'ideas').entries()) {
    const at = `ideas[${i}]`;
    const title = cut(raw.title, ai.ideaTitleMax);
    const description = cut(raw.description, ai.ideaDescriptionMax);
    if (title.text === '') {
      p.dropped(at, `Dropped idea ${i + 1}: it has no title`);
    } else if (description.text === '') {
      p.dropped(at, `Dropped idea '${title.text}': it has no description`);
    } else if (!p.categories.has(raw.categoryId)) {
      p.dropped(at, `Dropped idea '${title.text}': its budget category is not in this plan`);
    } else {
      const name = p.text(title, `${at}.title`, `Title of idea ${i + 1}`);
      const about = p.text(description, `${at}.description`, `Description of '${name}'`);
      const personalization = p.text(
        cut(raw.personalization, ai.personalizationMax),
        `${at}.personalization`,
        `Personalization of '${name}'`,
      );
      out.push({
        id: `ai-idea-${out.length + 1}`,
        title: name,
        description: about,
        categoryId: raw.categoryId,
        estimatedCost: capCost(raw.estimatedCost, name, `${at}.estimatedCost`, p),
        ...(personalization === '' ? {} : { personalization }),
        source: 'ai',
      });
    }
  }
  return out;
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
  p: Pass,
): TaskId[] {
  const kept: TaskId[] = [];
  const list = p.list(after, ai.afterMax, `${at}.after`, `tasks '${task.title}' follows`);
  for (const [j, id] of list.entries()) {
    const target = `${at}.after[${j}]`;
    const dep = p.ctx.activeTasks.get(id);
    if (dep === undefined) {
      p.dropped(target, `'${task.title}' no longer waits on a task that is not in this plan`);
    } else if (dep.leadDays < task.leadDays + task.durationDays) {
      p.dropped(
        target,
        `'${task.title}' no longer waits on '${dep.title}', which is due after it has to start`,
      );
    } else if (kept.includes(id)) {
      p.dropped(target, `'${task.title}' already waits on '${dep.title}'`);
    } else {
      kept.push(id);
    }
  }
  return kept;
}

function normalizeTasks(tasks: AiSuggestions['extraTasks'], p: Pass): TaskDef[] {
  const out: TaskDef[] = [];
  for (const [i, raw] of p.list(tasks, ai.extraTasksMax, 'extraTasks', 'extra tasks').entries()) {
    const at = `extraTasks[${i}]`;
    const title = cut(raw.title, ai.taskTitleMax);
    if (title.text === '') {
      p.dropped(at, `Dropped extra task ${i + 1}: it has no title`);
    } else if (!p.categories.has(raw.categoryId)) {
      p.dropped(at, `Dropped extra task '${title.text}': its budget category is not in this plan`);
    } else if (!Number.isFinite(raw.durationDays)) {
      p.dropped(at, `Dropped extra task '${title.text}': its duration is not a number of days`);
    } else if (!Number.isFinite(raw.leadDays)) {
      p.dropped(at, `Dropped extra task '${title.text}': its lead time is not a number of days`);
    } else {
      const name = p.text(title, `${at}.title`, `Title of extra task ${i + 1}`);
      const durationDays = p.days(
        raw.durationDays,
        ai.durationMin,
        ai.durationMax,
        `${at}.durationDays`,
        `Duration of '${name}' in days`,
      );
      const leadDays = p.days(
        raw.leadDays,
        ai.leadMin,
        ai.leadMax,
        `${at}.leadDays`,
        `Lead time of '${name}' in days`,
      );
      out.push({
        id: `${AI_TASK_PREFIX}${out.length + 1}`,
        title: name,
        categoryId: raw.categoryId,
        durationDays,
        leadDays,
        dependsOn: keptDependencies(raw.after, { title: name, leadDays, durationDays }, at, p),
      });
    }
  }
  return out;
}

function normalizeQuestions(
  entries: AiSuggestions['vendorQuestions'],
  p: Pass,
): Record<string, readonly string[]> {
  const labels = new Map(p.ctx.template.vendors.map((v) => [v.id, v.label]));
  const out = new Map<string, readonly string[]>();
  const list = p.list(entries, ai.vendorQuestionsMax, 'vendorQuestions', 'vendors');
  for (const [i, { vendorId, questions }] of list.entries()) {
    const at = `vendorQuestions[${i}]`;
    const label = labels.get(vendorId) ?? 'an unknown vendor';
    const asked = questions.slice(0, ai.questionsPerVendorMax);
    if (!p.ctx.vendorIds.has(vendorId)) {
      p.dropped(at, `Dropped questions for ${label}: this plan does not need that vendor`);
    } else if (out.has(vendorId)) {
      p.dropped(at, `Dropped a second set of questions for ${label}`);
    } else if (asked.every((q) => q.trim() === '')) {
      p.dropped(at, `Dropped the questions for ${label}: none had any text`);
    } else {
      const kept: string[] = [];
      const noun = `questions for ${label}`;
      for (const [j, raw] of p
        .list(questions, ai.questionsPerVendorMax, `${at}.questions`, noun)
        .entries()) {
        const target = `${at}.questions[${j}]`;
        const question = cut(raw, ai.questionMax);
        if (question.text === '') p.dropped(target, `Dropped an empty question for ${label}`);
        else kept.push(p.text(question, target, `Question ${j + 1} for ${label}`));
      }
      out.set(vendorId, kept);
    }
  }
  return Object.fromEntries(out);
}

/**
 * Turns a model response into addenda the engine can use, and lists every change made.
 * Strings are trimmed and cut to `LIMITS.ai` by code point; an item whose required text is empty
 * is dropped. Lists keep their first `LIMITS.ai` items. Ids the template or the brief cannot use
 * are dropped. Costs become whole major units from 0 to the brief's budget; durations and lead
 * times are rounded and clamped to whole days.
 * Rounding alone is never logged.
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
  const p = startPass(ctx);
  const addenda: AiAddenda = {
    summary: p.text(cut(s.summary, ai.summaryMax), 'summary', 'Summary'),
    ideas: normalizeIdeas(s.ideas, p),
    extraTasks: normalizeTasks(s.extraTasks, p),
    vendorQuestions: normalizeQuestions(s.vendorQuestions, p),
  };
  return { addenda, adjustments: p.log };
}

/**
 * Normalizes `s` against `plan` and rebuilds the plan with it, keeping today and the planned and
 * current guest counts. The new addenda replace any earlier ones.
 *
 * Ticked tasks: `opts.doneTasks` is used as given, AI task ids included. `ai-task-N` ids follow
 * the response order, so re-merging a stored response with the user's done set keeps their ticks.
 * Without it, the ticked template tasks are read from the plan; old AI ticks are left out so they
 * cannot land on a different task that reuses the id.
 * The budget never changes: the AI has no lever on it, so every idea is checked against the same
 * category amounts the prompt showed.
 */
export function mergeSuggestions(
  plan: Plan,
  s: AiSuggestions,
  opts: { readonly doneTasks?: ReadonlySet<TaskId> } = {},
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
  const doneTasks =
    opts.doneTasks ??
    new Set(
      plan.schedule.tasks
        .filter((t) => t.status === 'done' && activeTasks.has(t.id))
        .map((t) => t.id),
    );
  return {
    plan: assemblePlan({ brief, today, eventDate, plannedGuests, doneTasks, addenda }),
    adjustments,
  };
}
