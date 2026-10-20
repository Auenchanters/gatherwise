/**
 * Tests for src/domain/reducer.ts, the plan state machine behind every edit.
 *
 * Does: runs every action on deep-frozen state (purity), pins the zero-call guarantee (a guest,
 * budget, date, tick or vendor edit leaves `ai` referentially identical and the plan equal to a
 * fresh build), stale-generation guards, the error-then-recover cycle, kept ticks across edits,
 * the vendor overlay, and a seeded property over arbitrary edit sequences, garbage payloads
 * included.
 * Never does: read the clock (`today` is fixed) or call the model; the reducer cannot.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Budget } from '../../src/domain/budget.js';
import { isoDate } from '../../src/domain/dates.js';
import { mergeSuggestions } from '../../src/domain/merge.js';
import { toMinor } from '../../src/domain/money.js';
import { buildPlan, type Plan } from '../../src/domain/plan.js';
import {
  initialPlanState,
  planReducer,
  restorePlanState,
  vendorView,
  type PlanAction,
  type PlanState,
  type ReadyState,
} from '../../src/domain/reducer.js';
import type { AiMeta, AiSuggestions, EventBrief } from '../../src/shared/schema.js';
import { brief } from '../support/fixtures.js';

const SEED = { seed: 20_261_024, numRuns: 100 };
const today = isoDate('2026-10-21');
const community = brief('community');

const meta: AiMeta = {
  model: 'gemini-3.5-flash-lite',
  latencyMs: 812,
  inputTokens: 640,
  outputTokens: 410,
  requestId: '3f2b8c1e-9d4a-4b6e-8a1c-5d7e9f0a1b2c',
};

const clean: AiSuggestions = {
  summary: 'A warm, walkable Diwali mela for 250 neighbours.',
  ideas: [
    {
      title: 'Diya-lined paths',
      description: 'Line the walkways with clay diyas made by local potters.',
      categoryId: 'decor',
      estimatedCost: 8000,
      personalization: 'Diwali festival, outdoor venue',
    },
  ],
  weightHints: [{ categoryId: 'decor', factor: 1.2 }],
  extraTasks: [
    {
      title: 'Order clay diyas',
      categoryId: 'decor',
      durationDays: 5,
      leadDays: 10,
      after: ['book_venue'],
    },
  ],
  vendorQuestions: [{ vendorId: 'tent_shamiana', questions: ['Can it stay up overnight?'] }],
};

/** The same shape with different content: `ai-task-1` is now a different task. */
const other: AiSuggestions = {
  ...clean,
  extraTasks: [
    {
      title: 'Book a rangoli artist',
      categoryId: 'decor',
      durationDays: 3,
      leadDays: 8,
      after: ['book_venue'],
    },
  ],
};

const absurd: AiSuggestions = {
  ...clean,
  ideas: [
    {
      title: 'Fireworks',
      description: 'A ticketed fireworks finale.',
      categoryId: 'decor',
      estimatedCost: 1e12,
      personalization: '',
    },
  ],
  extraTasks: Array.from({ length: 50 }, (_, i) => ({
    title: `Task ${i}`,
    categoryId: 'decor',
    durationDays: -4,
    leadDays: 9999,
    after: ['not_a_task'],
  })),
};

function ready(state: PlanState): ReadyState {
  if (state.phase !== 'ready') throw new Error(`expected a ready state, got ${state.phase}`);
  return state;
}
const run = (state: PlanState, ...actions: readonly PlanAction[]): PlanState =>
  actions.reduce<PlanState>(planReducer, state);

const submitted = (b: EventBrief = community): ReadyState =>
  ready(planReducer(initialPlanState, { type: 'brief/submitted', brief: b, today }));
const applied = (suggestions: AiSuggestions = clean): ReadyState =>
  ready(run(submitted(), { type: 'ai/applied', generation: 1, suggestions, meta }));

/** An applied state with a tick, a vendor status and a checklist tick, like a user mid-plan. */
const inProgress = (): ReadyState =>
  ready(
    run(
      applied(),
      { type: 'task/toggled', taskId: 'define_goals' },
      { type: 'task/toggled', taskId: 'ai-task-1' },
      { type: 'vendor/status', vendorId: 'tent_shamiana', status: 'quoted' },
      { type: 'vendor/check', itemId: 'tent_shamiana:0' },
    ),
  );

function planOf(b: EventBrief, opts?: Parameters<typeof buildPlan>[2]): Plan {
  const result = buildPlan(b, today, opts);
  if (!result.ok) throw new Error(`expected a plan, got ${JSON.stringify(result.error)}`);
  return result.value;
}
const line = (b: Budget, id: string) => b.lines.find((l) => l.categoryId === id);
const linesSum = (b: Budget): number => b.lines.reduce((acc, l) => acc + l.allocated, 0);
const reconciles = (b: Budget): boolean =>
  linesSum(b) + b.contingency === b.total + (b.overBy ?? 0);
const statusOf = (state: ReadyState, id: string) =>
  state.plan.schedule.tasks.find((t) => t.id === id)?.status;

/** Freezes an object graph so any write in the code under test throws. */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

const everyAction: readonly PlanAction[] = [
  { type: 'brief/submitted', brief: brief('wedding'), today },
  { type: 'ai/requested', generation: 1 },
  { type: 'ai/applied', generation: 1, suggestions: other, meta },
  { type: 'ai/failed', generation: 1, error: 'timeout' },
  { type: 'guests/changed', guests: 400 },
  { type: 'budget/changed', budget: 90_000 },
  { type: 'date/changed', date: '2026-12-20' },
  { type: 'today/changed', today: isoDate('2026-10-22') },
  { type: 'task/toggled', taskId: 'define_goals' },
  { type: 'task/toggled', taskId: 'ai-task-1' },
  { type: 'vendor/status', vendorId: 'tent_shamiana', status: 'booked' },
  { type: 'vendor/check', itemId: 'tent_shamiana:0' },
  { type: 'plan/reset' },
  // Rejected ones must not touch the state either.
  { type: 'guests/changed', guests: 0 },
  { type: 'date/changed', date: 'garbage' },
  { type: 'ai/applied', generation: 99, suggestions: clean, meta },
];

describe('purity', () => {
  it.each(everyAction)('$type works on deep-frozen state and leaves it untouched', (action) => {
    for (const state of [inProgress(), initialPlanState]) {
      const frozen = deepFreeze(structuredClone(state));
      const frozenAction = deepFreeze(structuredClone(action));
      const snapshot = JSON.stringify([frozen, frozenAction]);
      expect(() => planReducer(frozen, frozenAction)).not.toThrow();
      expect(JSON.stringify([frozen, frozenAction])).toBe(snapshot);
    }
  });

  it('gives the same answer for the same input', () => {
    const state = inProgress();
    const action: PlanAction = { type: 'guests/changed', guests: 320 };
    expect(planReducer(state, action)).toEqual(planReducer(state, action));
  });
});

describe('brief/submitted', () => {
  it('starts a fresh plan: the brief guest count is the planned one, generation 1, nothing ticked', () => {
    const state = submitted();
    expect(state).toMatchObject({
      phase: 'ready',
      brief: community,
      today,
      plannedGuests: 250,
      generation: 1,
      progress: { doneTasks: [], vendorStatus: {}, checklistDone: [] },
      ai: { status: 'idle' },
      adjustments: [],
    });
    expect(state).not.toHaveProperty('error');
    expect(state.plan).toEqual(planOf(community));
  });

  it('clears the AI result, the ticks and any guest change, and bumps the generation', () => {
    const before = ready(planReducer(inProgress(), { type: 'guests/changed', guests: 400 }));
    const wedding = brief('wedding');
    const next = ready(planReducer(before, { type: 'brief/submitted', brief: wedding, today }));
    expect(next.generation).toBe(before.generation + 1);
    expect(next.ai).toEqual({ status: 'idle' });
    expect(next.progress).toEqual({ doneTasks: [], vendorStatus: {}, checklistDone: [] });
    expect(next.plannedGuests).toBe(wedding.guests);
    expect(next.plan).toEqual(planOf(wedding));
    expect(next.adjustments).toEqual([]);
  });

  it('keeps the previous plan and reports the date when the new brief is not plannable', () => {
    const before = applied();
    const next = ready(
      planReducer(before, {
        type: 'brief/submitted',
        brief: brief('community', { date: '2026-10-01' }),
        today,
      }),
    );
    expect(next.error).toEqual({ kind: 'invalid_date', reason: 'past' });
    expect(next.plan).toBe(before.plan);
    expect(next.generation).toBe(before.generation);
  });

  it('stays empty, with the error, when there was no plan to keep', () => {
    expect(
      planReducer(initialPlanState, {
        type: 'brief/submitted',
        brief: brief('birthday', { date: '2026-02-30' }),
        today,
      }),
    ).toEqual({
      phase: 'empty',
      generation: 0,
      error: { kind: 'invalid_date', reason: 'invalid' },
    });
  });
});

describe('the AI lifecycle', () => {
  it('goes pending on request', () => {
    const next = ready(planReducer(submitted(), { type: 'ai/requested', generation: 1 }));
    expect(next.ai).toEqual({ status: 'pending' });
    expect(next.plan).toEqual(submitted().plan);
  });

  it('stores the suggestions and meta on apply and re-derives with adjustments', () => {
    const before = submitted();
    const next = ready(
      planReducer(before, { type: 'ai/applied', generation: 1, suggestions: absurd, meta }),
    );
    expect(next.ai.status).toBe('applied');
    expect(next.ai.suggestions).toBe(absurd);
    expect(next.ai.meta).toBe(meta);
    expect(next.adjustments.length).toBeGreaterThan(0);
    expect(next.adjustments.map((a) => a.kind)).toEqual(
      expect.arrayContaining(['clamped', 'truncated', 'dropped']),
    );
    expect(next.plan.addenda).toBeDefined();
    expect(next.plan.budget.total).toBe(before.plan.budget.total);
    expect(reconciles(next.plan.budget)).toBe(true);
  });

  it('shows the AI ideas once applied', () => {
    const ideas = applied().plan.ideas;
    expect(ideas.map((i) => i.source)).toEqual(['ai']);
  });

  it('marks failure and keeps the plan, with the standard ideas', () => {
    const before = submitted();
    const next = ready(planReducer(before, { type: 'ai/failed', generation: 1, error: 'timeout' }));
    expect(next.ai).toEqual({ status: 'failed', error: 'timeout' });
    expect(next.plan).toEqual(before.plan);
    expect(next.plan.ideas.every((i) => i.source === 'template')).toBe(true);
    expect(next.adjustments).toEqual([]);
  });

  it('keeps an earlier result when a refresh fails or is pending', () => {
    const before = applied();
    const failed = ready(planReducer(before, { type: 'ai/failed', generation: 1, error: 'busy' }));
    expect(failed.ai).toEqual({
      status: 'failed',
      suggestions: clean,
      meta,
      error: 'busy',
    });
    expect(failed.plan).toEqual(before.plan);
    const pending = ready(planReducer(before, { type: 'ai/requested', generation: 1 }));
    expect(pending.ai).toEqual({ status: 'pending', suggestions: clean, meta });
    expect(pending.plan).toEqual(before.plan);
  });

  it.each<PlanAction>([
    { type: 'ai/requested', generation: 0 },
    { type: 'ai/applied', generation: 2, suggestions: clean, meta },
    { type: 'ai/failed', generation: 7, error: 'late' },
  ])('ignores a stale or foreign $type', (action) => {
    const state = submitted();
    expect(planReducer(state, action)).toBe(state);
  });

  it('ignores a response that arrives after a newer brief was submitted', () => {
    const requested = ready(planReducer(submitted(), { type: 'ai/requested', generation: 1 }));
    const resubmitted = ready(
      planReducer(requested, { type: 'brief/submitted', brief: brief('birthday'), today }),
    );
    expect(resubmitted.generation).toBe(2);
    const late = planReducer(resubmitted, {
      type: 'ai/applied',
      generation: 1,
      suggestions: clean,
      meta,
    });
    expect(late).toBe(resubmitted);
    expect(ready(late).ai).toEqual({ status: 'idle' });
  });

  it('forgets ai-task ticks when a new response replaces the old, so they cannot land on another task', () => {
    const ticked = inProgress();
    expect(statusOf(ticked, 'ai-task-1')).toBe('done');
    const next = ready(
      planReducer(ticked, { type: 'ai/applied', generation: 1, suggestions: other, meta }),
    );
    expect(next.progress.doneTasks).toEqual(['define_goals']);
    expect(statusOf(next, 'ai-task-1')).not.toBe('done');
    expect(statusOf(next, 'define_goals')).toBe('done');
  });
});

describe('guests/changed: the zero-call edit', () => {
  const before = inProgress();

  it('leaves the AI result referentially identical and the generation alone', () => {
    const next = ready(planReducer(before, { type: 'guests/changed', guests: 400 }));
    expect(next.ai).toBe(before.ai);
    expect(next.generation).toBe(before.generation);
    expect(next.progress).toEqual(before.progress);
    expect(next.plannedGuests).toBe(250);
    expect(next.brief.guests).toBe(400);
  });

  it('rescales the per-guest lines and leaves the fixed ones, the total and the reconciliation', () => {
    const next = ready(planReducer(before, { type: 'guests/changed', guests: 400 })).plan.budget;
    const old = before.plan.budget;
    const food = line(next, 'food_beverage')?.allocated ?? 0;
    expect(food).toBeGreaterThan(line(old, 'food_beverage')?.allocated ?? Infinity);
    expect(food).toBe(Math.round(((line(old, 'food_beverage')?.allocated ?? 0) * 400) / 250));
    expect(line(next, 'venue_permits')?.allocated).toBe(line(old, 'venue_permits')?.allocated);
    expect(next.total).toBe(old.total);
    expect(next.guests).toBe(400);
    expect(reconciles(next)).toBe(true);
  });

  it('follows R29: a rise eats the contingency first, then shows overBy; a fall frees it', () => {
    const up = ready(planReducer(before, { type: 'guests/changed', guests: 400 })).plan.budget;
    expect(up.contingency).toBeLessThan(before.plan.budget.contingency);
    const crowd = ready(planReducer(before, { type: 'guests/changed', guests: 5000 })).plan.budget;
    expect(crowd.contingency).toBe(0);
    expect(crowd.overBy).toBeGreaterThan(0);
    const down = ready(planReducer(before, { type: 'guests/changed', guests: 100 })).plan.budget;
    expect(down.contingency).toBeGreaterThan(before.plan.budget.contingency);
    expect(down).not.toHaveProperty('overBy');
    for (const b of [up, crowd, down]) expect(reconciles(b)).toBe(true);
  });

  it('gives exactly the plan a fresh build would, AI result included', () => {
    const next = ready(planReducer(before, { type: 'guests/changed', guests: 400 }));
    const fresh = mergeSuggestions(
      planOf({ ...community, guests: 400 }, { plannedGuests: 250 }),
      clean,
      { doneTasks: new Set(before.progress.doneTasks) },
    );
    expect(next.plan).toEqual(fresh.plan);
    expect(next.adjustments).toEqual(fresh.adjustments);
  });

  it('keeps a ticked AI task done', () => {
    const next = ready(planReducer(before, { type: 'guests/changed', guests: 320 }));
    expect(statusOf(next, 'ai-task-1')).toBe('done');
    expect(next.progress.doneTasks).toContain('ai-task-1');
  });

  it('is reversible: back at the planned count the budget is the planned one', () => {
    const there = planReducer(before, { type: 'guests/changed', guests: 400 });
    const back = ready(planReducer(there, { type: 'guests/changed', guests: 250 }));
    expect(back.plan).toEqual(before.plan);
  });
});

describe('budget/changed', () => {
  it('re-plans at the current guest count: planned guests follow, the overshoot goes', () => {
    const grown = ready(planReducer(applied(), { type: 'guests/changed', guests: 5000 }));
    expect(grown.plan.budget.overBy).toBeGreaterThan(0);
    const next = ready(planReducer(grown, { type: 'budget/changed', budget: 3_000_000 }));
    expect(next.plannedGuests).toBe(5000);
    expect(next.brief).toMatchObject({ budget: 3_000_000, guests: 5000 });
    expect(next.plan.budget.total).toBe(toMinor(3_000_000, 'INR'));
    expect(next.plan.budget.guests).toBe(5000);
    expect(next.plan.budget).not.toHaveProperty('overBy');
    expect(next.ai).toBe(grown.ai);
    const fresh = mergeSuggestions(
      planOf({ ...community, guests: 5000, budget: 3_000_000 }),
      clean,
      { doneTasks: new Set() },
    );
    expect(next.plan).toEqual(fresh.plan);
  });
});

describe('date/changed and today/changed', () => {
  it('moves the whole timeline with the date and nothing else', () => {
    const before = inProgress();
    const next = ready(planReducer(before, { type: 'date/changed', date: '2027-01-15' }));
    expect(next.brief.date).toBe('2027-01-15');
    expect(next.plan.eventDate).toBe('2027-01-15');
    expect(next.ai).toBe(before.ai);
    expect(next.progress).toEqual(before.progress);
    expect(statusOf(next, 'define_goals')).toBe('done');
  });

  it('turns tasks overdue or infeasible as a long-open tab reaches the event', () => {
    const before = applied();
    const next = ready(
      planReducer(before, { type: 'today/changed', today: isoDate('2026-12-11') }),
    );
    expect(next.today).toBe('2026-12-11');
    expect(next.plan.schedule.overdueCount + next.plan.schedule.infeasibleCount).toBeGreaterThan(
      before.plan.schedule.overdueCount + before.plan.schedule.infeasibleCount,
    );
    expect(next.ai).toBe(before.ai);
  });

  it('still plans on the day of the event, but not the day after', () => {
    const onTheDay = planReducer(applied(), {
      type: 'today/changed',
      today: isoDate('2026-12-12'),
    });
    expect(ready(onTheDay)).not.toHaveProperty('error');
    const after = ready(
      planReducer(applied(), { type: 'today/changed', today: isoDate('2026-12-13') }),
    );
    expect(after.error).toEqual({ kind: 'invalid_date', reason: 'past' });
    expect(after.today).toBe(today);
  });
});

describe('an action the types forbid', () => {
  /** A type guard that lies, so a test can send what TypeScript would stop it sending. */
  const claimsAction = (value: unknown): value is PlanAction => value !== undefined;
  const sendUnknown = (state: PlanState, action: unknown): PlanState => {
    if (!claimsAction(action)) throw new Error('unreachable');
    return planReducer(state, action);
  };

  it.each([{ type: 'nope' }, { type: 'guests/Changed', guests: 400 }, { generation: 1 }, {}])(
    'leaves the state as it was for %j',
    (action) => {
      for (const state of [inProgress(), initialPlanState]) {
        expect(sendUnknown(state, action)).toBe(state);
      }
    },
  );
});

describe('ticking tasks and vendors', () => {
  it('changes only the progress for a vendor status or checklist tick: the plan is the same object', () => {
    const before = inProgress();
    const status = ready(
      planReducer(before, { type: 'vendor/status', vendorId: 'sound_lighting', status: 'booked' }),
    );
    const check = ready(planReducer(before, { type: 'vendor/check', itemId: 'sound_lighting:2' }));
    for (const next of [status, check]) {
      expect(next.plan).toBe(before.plan);
      expect(next.adjustments).toBe(before.adjustments);
      expect(next.ai).toBe(before.ai);
      expect(next.brief).toBe(before.brief);
      expect(next.progress).not.toBe(before.progress);
    }
    expect(status.progress.vendorStatus).toEqual({
      tent_shamiana: 'quoted',
      sound_lighting: 'booked',
    });
    expect(check.progress.checklistDone).toEqual(['tent_shamiana:0', 'sound_lighting:2']);
  });

  it('still clears an earlier error on a vendor status or checklist tick', () => {
    const failed = ready(planReducer(inProgress(), { type: 'guests/changed', guests: 0 }));
    expect(failed.error).toBeDefined();
    for (const action of [
      { type: 'vendor/status', vendorId: 'tent_shamiana', status: 'booked' },
      { type: 'vendor/check', itemId: 'tent_shamiana:3' },
    ] satisfies PlanAction[]) {
      const next = ready(planReducer(failed, action));
      expect(next, action.type).not.toHaveProperty('error');
      expect(next.plan, action.type).toBe(failed.plan);
    }
  });

  it('toggles a task on and off', () => {
    const on = ready(planReducer(applied(), { type: 'task/toggled', taskId: 'define_goals' }));
    expect(on.progress.doneTasks).toEqual(['define_goals']);
    expect(statusOf(on, 'define_goals')).toBe('done');
    const off = ready(planReducer(on, { type: 'task/toggled', taskId: 'define_goals' }));
    expect(off.progress.doneTasks).toEqual([]);
    expect(statusOf(off, 'define_goals')).not.toBe('done');
  });

  it('records a vendor status and toggles checklist items', () => {
    const state = inProgress();
    expect(state.progress.vendorStatus).toEqual({ tent_shamiana: 'quoted' });
    expect(state.progress.checklistDone).toEqual(['tent_shamiana:0']);
    const next = ready(
      run(
        state,
        { type: 'vendor/status', vendorId: 'tent_shamiana', status: 'booked' },
        { type: 'vendor/check', itemId: 'tent_shamiana:0' },
        { type: 'vendor/check', itemId: 'tent_shamiana:2' },
      ),
    );
    expect(next.progress.vendorStatus).toEqual({ tent_shamiana: 'booked' });
    expect(next.progress.checklistDone).toEqual(['tent_shamiana:2']);
  });

  it('ignores ids that are not in the plan, so progress stays bounded', () => {
    const state = applied();
    for (const action of [
      { type: 'task/toggled', taskId: 'nope' },
      { type: 'vendor/status', vendorId: 'nope', status: 'booked' },
      { type: 'vendor/check', itemId: 'nope:0' },
      { type: 'vendor/check', itemId: 'tent_shamiana:99' },
    ] satisfies PlanAction[]) {
      expect(planReducer(state, action)).toBe(state);
    }
  });

  it('keeps ticks for ids that drop out of the plan, and restores them when they return', () => {
    const booked = ready(
      run(
        applied(),
        { type: 'vendor/status', vendorId: 'security_crowd', status: 'booked' },
        { type: 'vendor/check', itemId: 'security_crowd:0' },
      ),
    );
    const fewer = ready(planReducer(booked, { type: 'guests/changed', guests: 100 }));
    expect(fewer.plan.vendors.map((v) => v.id)).not.toContain('security_crowd');
    expect(fewer.progress.vendorStatus).toEqual({ security_crowd: 'booked' });
    expect(fewer.progress.checklistDone).toEqual(['security_crowd:0']);
    const back = ready(planReducer(fewer, { type: 'guests/changed', guests: 250 }));
    const view = vendorView(back).find((v) => v.id === 'security_crowd');
    expect(view?.status).toBe('booked');
    expect(view?.checklist[0]?.done).toBe(true);
  });
});

describe('vendorView', () => {
  it('overlays the user status and checklist ticks on the plan vendors', () => {
    const state = inProgress();
    const view = vendorView(state);
    expect(view.map((v) => v.id)).toEqual(state.plan.vendors.map((v) => v.id));
    const tent = view.find((v) => v.id === 'tent_shamiana');
    expect(tent?.status).toBe('quoted');
    expect(tent?.checklist.map((c) => c.done)).toEqual([true, false, false, false]);
    const sound = view.find((v) => v.id === 'sound_lighting');
    expect(sound?.status).toBe('to_contact');
    expect(sound?.checklist.every((c) => !c.done)).toBe(true);
  });

  it('does not touch the plan, and is empty before there is one', () => {
    const state = inProgress();
    const before = JSON.stringify(state.plan);
    vendorView(state);
    expect(JSON.stringify(state.plan)).toBe(before);
    expect(vendorView(initialPlanState)).toEqual([]);
  });
});

describe('rejected edits keep the plan and set an error; the next good edit clears it', () => {
  const invalidDate = (reason: 'invalid' | 'past' | 'too_far') =>
    ({ kind: 'invalid_date', reason }) as const;
  const cases: readonly (readonly [string, PlanAction, PlanState['error']])[] = [
    ['an impossible date', { type: 'date/changed', date: '2026-02-30' }, invalidDate('invalid')],
    ['a malformed date', { type: 'date/changed', date: 'next friday' }, invalidDate('invalid')],
    ['a past date', { type: 'date/changed', date: '2026-10-01' }, invalidDate('past')],
    [
      'a date beyond the horizon',
      { type: 'date/changed', date: '2029-01-01' },
      invalidDate('too_far'),
    ],
    [
      'a today after the event',
      { type: 'today/changed', today: isoDate('2027-01-01') },
      invalidDate('past'),
    ],
    ['zero guests', { type: 'guests/changed', guests: 0 }, { kind: 'invalid_guests' }],
    ['too many guests', { type: 'guests/changed', guests: 5001 }, { kind: 'invalid_guests' }],
    ['fractional guests', { type: 'guests/changed', guests: 2.5 }, { kind: 'invalid_guests' }],
    ['NaN guests', { type: 'guests/changed', guests: Number.NaN }, { kind: 'invalid_guests' }],
    ['zero budget', { type: 'budget/changed', budget: 0 }, { kind: 'invalid_budget' }],
    ['a fractional budget', { type: 'budget/changed', budget: 99.5 }, { kind: 'invalid_budget' }],
    [
      'too large a budget',
      { type: 'budget/changed', budget: 100_000_001 },
      { kind: 'invalid_budget' },
    ],
    [
      'an infinite budget',
      { type: 'budget/changed', budget: Infinity },
      { kind: 'invalid_budget' },
    ],
  ];

  it.each(cases)('%s', (_name, action, error) => {
    const before = inProgress();
    const next = ready(planReducer(before, action));
    expect(next.error).toEqual(error);
    expect(next.plan).toBe(before.plan);
    expect(next.brief).toBe(before.brief);
    expect(next.today).toBe(before.today);
    expect(next.plannedGuests).toBe(before.plannedGuests);
    expect(next.progress).toBe(before.progress);
    expect(next.ai).toBe(before.ai);
    const recovered = ready(planReducer(next, { type: 'guests/changed', guests: 260 }));
    expect(recovered).not.toHaveProperty('error');
    expect(recovered.brief.guests).toBe(260);
  });

  it('is cleared by every kind of successful action', () => {
    const failed = ready(planReducer(inProgress(), { type: 'guests/changed', guests: 0 }));
    const good: readonly PlanAction[] = [
      { type: 'ai/requested', generation: 1 },
      { type: 'ai/failed', generation: 1, error: 'x' },
      { type: 'ai/applied', generation: 1, suggestions: clean, meta },
      { type: 'budget/changed', budget: 160_000 },
      { type: 'date/changed', date: '2026-12-13' },
      { type: 'today/changed', today: isoDate('2026-10-22') },
      { type: 'task/toggled', taskId: 'define_goals' },
      { type: 'vendor/status', vendorId: 'tent_shamiana', status: 'booked' },
      { type: 'vendor/check', itemId: 'tent_shamiana:1' },
      { type: 'brief/submitted', brief: community, today },
    ];
    for (const action of good) {
      expect(planReducer(failed, action), action.type).not.toHaveProperty('error');
    }
    expect(planReducer(failed, { type: 'plan/reset' })).toEqual({ phase: 'empty', generation: 1 });
  });

  it('is cleared on an empty state by a good brief', () => {
    const failed = planReducer(initialPlanState, {
      type: 'brief/submitted',
      brief: brief('community', { date: '2020-01-01' }),
      today,
    });
    expect(failed).toHaveProperty('error');
    expect(
      ready(planReducer(failed, { type: 'brief/submitted', brief: community, today })),
    ).not.toHaveProperty('error');
  });
});

describe('plan/reset and the empty state', () => {
  it('starts at generation 0 and resets to an empty state from anywhere', () => {
    expect(initialPlanState).toEqual({ phase: 'empty', generation: 0 });
    expect(planReducer(inProgress(), { type: 'plan/reset' })).toMatchObject({ phase: 'empty' });
    expect(planReducer(initialPlanState, { type: 'plan/reset' })).toEqual(initialPlanState);
  });

  it('keeps the generation counter across a reset', () => {
    const twice = ready(run(inProgress(), { type: 'brief/submitted', brief: community, today }));
    expect(twice.generation).toBe(2);
    const reset = planReducer(twice, { type: 'plan/reset' });
    expect(reset).toEqual({ phase: 'empty', generation: 2 });
    expect(planReducer(reset, { type: 'plan/reset' })).toEqual(reset);
  });

  it('never reuses a generation: a response for the plan before a reset is ignored', () => {
    const first = submitted();
    expect(first.generation).toBe(1);
    const second = ready(
      run(
        first,
        { type: 'ai/requested', generation: 1 },
        { type: 'plan/reset' },
        { type: 'brief/submitted', brief: brief('birthday'), today },
      ),
    );
    expect(second.generation).toBe(2);
    expect(second.ai).toEqual({ status: 'idle' });
    for (const action of [
      { type: 'ai/applied', generation: 1, suggestions: clean, meta },
      { type: 'ai/failed', generation: 1, error: 'late' },
      { type: 'ai/requested', generation: 1 },
    ] satisfies PlanAction[]) {
      expect(planReducer(second, action), action.type).toBe(second);
    }
  });

  it('counts on after a refused brief on an empty state', () => {
    const reset = planReducer(inProgress(), { type: 'plan/reset' });
    const refused = planReducer(reset, {
      type: 'brief/submitted',
      brief: brief('community', { date: '2020-01-01' }),
      today,
    });
    expect(refused).toMatchObject({ phase: 'empty', generation: 1 });
    expect(
      ready(planReducer(refused, { type: 'brief/submitted', brief: community, today })).generation,
    ).toBe(2);
  });

  it.each(everyAction.filter((a) => a.type !== 'brief/submitted' && a.type !== 'plan/reset'))(
    'ignores $type when there is no plan',
    (action) => {
      expect(planReducer(initialPlanState, action)).toBe(initialPlanState);
    },
  );
});

describe('restorePlanState', () => {
  const state = inProgress();
  const inputs = {
    brief: state.brief,
    today: state.today,
    plannedGuests: state.plannedGuests,
    generation: state.generation,
    progress: state.progress,
    ai: state.ai,
  };

  it('rebuilds exactly the state the reducer holds', () => {
    expect(restorePlanState(inputs)).toEqual({ ok: true, value: state });
  });

  it('reports why when the plan cannot be built', () => {
    expect(restorePlanState({ ...inputs, today: isoDate('2027-01-01') })).toEqual({
      ok: false,
      error: { kind: 'invalid_date', reason: 'past' },
    });
    expect(restorePlanState({ ...inputs, brief: { ...community, date: '2030-01-01' } })).toEqual({
      ok: false,
      error: { kind: 'invalid_date', reason: 'too_far' },
    });
  });

  it('plans without AI when there are no suggestions', () => {
    const result = restorePlanState({ ...inputs, ai: { status: 'idle' } });
    expect(result.ok && result.value.plan).toEqual(
      planOf(community, { doneTasks: new Set(['define_goals']) }),
    );
  });
});

describe('any sequence of edits, valid or not (property)', () => {
  const taskIds = ['define_goals', 'book_venue', 'ai-task-1', 'nope'];
  const vendorIds = ['tent_shamiana', 'security_crowd', 'nope'];
  const edit: fc.Arbitrary<PlanAction> = fc.oneof(
    fc
      .oneof(fc.integer({ min: -5, max: 6000 }), fc.double())
      .map((guests): PlanAction => ({ type: 'guests/changed', guests })),
    fc
      .oneof(fc.integer({ min: -5, max: 200_000_000 }), fc.double())
      .map((budget): PlanAction => ({ type: 'budget/changed', budget })),
    fc
      .constantFrom('2026-10-21', '2026-12-12', '2028-10-20', '2028-10-22', '2026-02-30', '', 'x')
      .map((date): PlanAction => ({ type: 'date/changed', date })),
    fc.constantFrom(...taskIds).map((taskId): PlanAction => ({ type: 'task/toggled', taskId })),
    fc
      .tuple(fc.constantFrom(...vendorIds), fc.constantFrom('to_contact', 'quoted', 'booked'))
      .map(([vendorId, status]): PlanAction => ({ type: 'vendor/status', vendorId, status })),
    fc
      .constantFrom('tent_shamiana:0', 'security_crowd:1', 'nope:0')
      .map((itemId): PlanAction => ({ type: 'vendor/check', itemId })),
  );

  it('never throws, never calls for a new AI result, and always reconciles', () => {
    const start = inProgress();
    fc.assert(
      fc.property(fc.array(edit, { maxLength: 15 }), (actions) => {
        let state: PlanState = start;
        for (const action of actions) {
          state = planReducer(state, action);
          const now = ready(state);
          expect(now.ai).toBe(start.ai);
          expect(now.generation).toBe(start.generation);
          expect(now.plan.budget.total).toBe(toMinor(now.brief.budget, now.brief.currency));
          expect(reconciles(now.plan.budget)).toBe(true);
          expect(now.progress.doneTasks.length).toBeLessThanOrEqual(500);
        }
      }),
      SEED,
    );
  });
});
