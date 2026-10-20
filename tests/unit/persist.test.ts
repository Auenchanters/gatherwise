/**
 * Tests for src/features/plan/persist.ts, which treats localStorage as untrusted (Review Focus 5).
 *
 * Does: round-trips real states (including a property over arbitrary briefs), stores inputs only,
 * walks every corrupt, version, stale and missing case, tampers each envelope field, keeps the plan
 * when only the AI part is bad, and sends absurd-but-schema-valid AI numbers back through the merge
 * so they are clamped and logged. Uses an in-memory store and a throwing one.
 * Never does: touch a real localStorage or read the clock; `today` is fixed.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { isoDate } from '../../src/domain/dates';
import { toMinor } from '../../src/domain/money';
import { buildPlan } from '../../src/domain/plan';
import {
  initialPlanState,
  planReducer,
  vendorView,
  type PlanAction,
  type PlanState,
  type ReadyState,
} from '../../src/domain/reducer';
import { loadPlan, MAX_STORED_CHARS, savePlan, STORAGE_KEY } from '../../src/features/plan/persist';
import type { AiMeta, AiSuggestions, EventBrief } from '../../src/shared/schema';
import { brief, briefArb } from '../support/fixtures';

const SEED = { seed: 20_261_025, numRuns: 100 };
const today = isoDate('2026-10-21');

/** A store that remembers what was written and what was removed. */
function memoryStore(initial?: string) {
  const data = new Map<string, string>(initial === undefined ? [] : [[STORAGE_KEY, initial]]);
  const removed: string[] = [];
  return {
    removed,
    getItem: (key: string): string | null => data.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      data.set(key, value);
    },
    removeItem: (key: string): void => {
      removed.push(key);
      data.delete(key);
    },
  };
}

const boom = (): never => {
  throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
};
/** Private mode or a full disk: every call throws. */
const throwingStore = { getItem: boom, setItem: boom, removeItem: boom };

const meta: AiMeta = {
  model: 'gemini-3.5-flash-lite',
  latencyMs: 812,
  inputTokens: 640,
  outputTokens: 410,
  requestId: '3f2b8c1e-9d4a-4b6e-8a1c-5d7e9f0a1b2c',
};
const suggestions: AiSuggestions = {
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

function ready(state: PlanState): ReadyState {
  if (state.phase !== 'ready') throw new Error(`expected a ready state, got ${state.phase}`);
  return state;
}
const run = (state: PlanState, ...actions: readonly PlanAction[]): PlanState =>
  actions.reduce<PlanState>(planReducer, state);

/** A user mid-plan: AI applied, guests grown, a task, a vendor and a checklist item ticked. */
const midPlan = (b: EventBrief = brief('community')): ReadyState =>
  ready(
    run(
      initialPlanState,
      { type: 'brief/submitted', brief: b, today },
      { type: 'ai/applied', generation: 1, suggestions, meta },
      { type: 'guests/changed', guests: 320 },
      { type: 'task/toggled', taskId: 'define_goals' },
      { type: 'task/toggled', taskId: 'ai-task-1' },
      { type: 'vendor/status', vendorId: 'tent_shamiana', status: 'booked' },
      { type: 'vendor/check', itemId: 'tent_shamiana:1' },
    ),
  );

const jsonRecord = z.record(z.string(), z.unknown());
/** What `savePlan` writes for a state, parsed back so a test can tamper with one field. */
function envelopeOf(state: ReadyState): Record<string, unknown> {
  const store = memoryStore();
  savePlan(store, state);
  return jsonRecord.parse(JSON.parse(store.getItem(STORAGE_KEY) ?? 'null'));
}
const omit = (value: Record<string, unknown>, key: string): Record<string, unknown> =>
  Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));

const state = midPlan();
const good = envelopeOf(state);
/** The store after `over` replaces fields of a good saved envelope. */
const tampered = (over: Record<string, unknown>) =>
  memoryStore(JSON.stringify({ ...good, ...over }));
const failure = (store: Parameters<typeof loadPlan>[0], day = today) => {
  const result = loadPlan(store, day);
  if (result.ok) throw new Error('expected loadPlan to fail');
  return result.error;
};
const loaded = (store: Parameters<typeof loadPlan>[0], day = today): ReadyState => {
  const result = loadPlan(store, day);
  if (!result.ok) throw new Error(`expected loadPlan to succeed, got ${result.error}`);
  return result.value;
};

describe('savePlan', () => {
  it('stores the inputs only, never the derived plan', () => {
    expect(Object.keys(good).toSorted()).toEqual(
      ['ai', 'brief', 'generation', 'plannedGuests', 'progress', 'v'].toSorted(),
    );
    expect(good).toMatchObject({ v: 1, plannedGuests: 250, generation: 1, brief: state.brief });
    expect(good.ai).toEqual({ suggestions, meta });
    expect(good.progress).toEqual(state.progress);
    const text = JSON.stringify(good);
    for (const derived of ['"plan"', '"adjustments"', '"schedule"', '"phase"', '"error"']) {
      expect(text).not.toContain(derived);
    }
  });

  it('writes under the versioned key and says so', () => {
    const store = memoryStore();
    expect(STORAGE_KEY).toBe('gatherwise.plan.v1');
    expect(savePlan(store, state)).toBe(true);
    expect(store.getItem(STORAGE_KEY)).toBe(JSON.stringify(good));
  });

  it('stores no AI result when there is none', () => {
    const fresh = ready(
      planReducer(initialPlanState, { type: 'brief/submitted', brief: brief('birthday'), today }),
    );
    expect(envelopeOf(fresh).ai).toEqual({});
    const pending = ready(planReducer(fresh, { type: 'ai/requested', generation: 1 }));
    expect(envelopeOf(pending).ai).toEqual({});
  });

  it('removes the key for an empty state', () => {
    const store = memoryStore('anything');
    expect(savePlan(store, initialPlanState)).toBe(true);
    expect(store.removed).toEqual([STORAGE_KEY]);
    expect(store.getItem(STORAGE_KEY)).toBeNull();
  });

  it('returns false instead of throwing when storage refuses (private mode, quota)', () => {
    expect(savePlan(throwingStore, state)).toBe(false);
    expect(savePlan(throwingStore, initialPlanState)).toBe(false);
  });

  it('refuses a state that loadPlan would later reject as too big, leaving the old copy', () => {
    const store = memoryStore(JSON.stringify(good));
    const huge = ready(
      planReducer(state, {
        type: 'ai/applied',
        generation: 1,
        suggestions: { ...suggestions, summary: 'x'.repeat(MAX_STORED_CHARS) },
        meta,
      }),
    );
    expect(savePlan(store, huge)).toBe(false);
    expect(store.getItem(STORAGE_KEY)).toBe(JSON.stringify(good));
  });
});

describe('loadPlan: round trips', () => {
  it('restores an equal state: inputs, derived plan and adjustments', () => {
    const store = memoryStore();
    savePlan(store, state);
    const back = loaded(store);
    expect(back).toEqual(state);
    expect(back.plan).toEqual(state.plan);
    expect(back.ai).toEqual({ status: 'applied', suggestions, meta });
    expect(back.progress).toEqual(state.progress);
    expect(back.plannedGuests).toBe(250);
    expect(back.brief.guests).toBe(320);
  });

  it('continues the generation count after a restore, so an old response cannot apply', () => {
    const third = ready(
      run(
        initialPlanState,
        { type: 'brief/submitted', brief: brief('birthday'), today },
        { type: 'plan/reset' },
        { type: 'brief/submitted', brief: brief('wedding'), today },
        { type: 'brief/submitted', brief: brief('community'), today },
      ),
    );
    expect(third.generation).toBe(3);
    const store = memoryStore();
    savePlan(store, third);
    const back = loaded(store);
    expect(back.generation).toBe(3);
    const next = ready(
      planReducer(back, { type: 'brief/submitted', brief: brief('birthday'), today }),
    );
    expect(next.generation).toBe(4);
    const late = { type: 'ai/applied', generation: 3, suggestions, meta } satisfies PlanAction;
    expect(planReducer(next, late)).toBe(next);
  });

  it('restores a plan that never had AI as idle', () => {
    const fresh = ready(
      planReducer(initialPlanState, { type: 'brief/submitted', brief: brief('wedding'), today }),
    );
    const store = memoryStore();
    savePlan(store, fresh);
    expect(loaded(store)).toEqual(fresh);
  });

  it('keeps ticks on AI tasks and the vendor overlay', () => {
    const store = memoryStore();
    savePlan(store, state);
    const back = loaded(store);
    expect(back.plan.schedule.tasks.find((t) => t.id === 'ai-task-1')?.status).toBe('done');
    const tent = vendorView(back).find((v) => v.id === 'tent_shamiana');
    expect(tent?.status).toBe('booked');
    expect(tent?.checklist[1]?.done).toBe(true);
  });

  it('round-trips any valid brief, non-Latin text and emoji included (property)', () => {
    fc.assert(
      fc.property(briefArb, (b) => {
        const fresh = planReducer(initialPlanState, { type: 'brief/submitted', brief: b, today });
        if (fresh.phase !== 'ready') return; // the generated date was in the past or too far
        const store = memoryStore();
        savePlan(store, fresh);
        expect(loaded(store)).toEqual(fresh);
      }),
      SEED,
    );
  });

  it('renders hostile text as the literal text it is', () => {
    const name = '<script>alert(1)</script>';
    const notes = '"></script><img src=x onerror=alert(1)> {{7*7}} ‮';
    const hostile = midPlan(brief('community', { name, notes }));
    const store = memoryStore();
    savePlan(store, hostile);
    const back = loaded(store);
    expect(back.brief.name).toBe(name);
    expect(back.brief.notes).toBe(notes.trim());
    expect(back.plan.brief.name).toBe(name);
  });
});

describe('loadPlan: nothing usable', () => {
  it('reports missing for an empty store or a store that throws', () => {
    expect(failure(memoryStore())).toBe('missing');
    expect(failure(throwingStore)).toBe('missing');
  });

  it.each([
    ['broken JSON', '{not json'],
    ['a truncated save', JSON.stringify(good).slice(0, 80)],
    ['a long string', JSON.stringify('a'.repeat(MAX_STORED_CHARS + 1))],
    ['a 1 MB string', 'x'.repeat(1_000_000)],
    [
      'a valid save padded past the size cap',
      `${JSON.stringify(good)}${' '.repeat(MAX_STORED_CHARS)}`,
    ],
    ['null', 'null'],
    ['an array', '[]'],
    ['a number', '42'],
    ['a string', '"hello"'],
    ['an empty object', '{}'],
    ['a stringly version', '{"v":"1"}'],
    ['the old plan shape', '{"v":1,"plan":{"brief":{"name":"<script>"}}}'],
  ])('reports corrupt for %s', (_name, text) => {
    expect(failure(memoryStore(text))).toBe('corrupt');
  });

  it('accepts a save exactly at the size cap', () => {
    const text = JSON.stringify(good);
    expect(loadPlan(memoryStore(text + ' '.repeat(MAX_STORED_CHARS - text.length)), today).ok).toBe(
      true,
    );
  });

  it.each([
    ['version 0', '{"v":0}'],
    ['a future version', '{"v":2,"brief":{}}'],
    ['a fractional version', '{"v":1.5}'],
    ['a negative version', '{"v":-1}'],
  ])('reports version for %s', (_name, text) => {
    expect(failure(memoryStore(text))).toBe('version');
  });

  it('reports stale once the event is in the past', () => {
    expect(failure(memoryStore(JSON.stringify(good)), isoDate('2026-12-13'))).toBe('stale');
    expect(loadPlan(memoryStore(JSON.stringify(good)), isoDate('2026-12-12')).ok).toBe(true);
  });
});

describe('loadPlan: tampered envelope fields', () => {
  const longId = 'x'.repeat(81);
  const manyIds = Array.from({ length: 501 }, (_, i) => `id${i}`);
  const manyVendors = Object.fromEntries(
    Array.from({ length: 101 }, (_, i) => [`v${i}`, 'booked'] as const),
  );
  const progress = state.progress;

  it.each<[string, Record<string, unknown>]>([
    ['a brief with zero guests', { brief: { ...state.brief, guests: 0 } }],
    ['a brief with an unknown key', { brief: { ...state.brief, admin: true } }],
    ['a brief that is not an object', { brief: 'rm -rf' }],
    ['a null brief', { brief: null }],
    ['a script as the venue', { brief: { ...state.brief, venue: '<script>' } }],
    ['an impossible date', { brief: { ...state.brief, date: '2026-02-30' } }],
    ['a date beyond the horizon', { brief: { ...state.brief, date: '2031-01-01' } }],
    ['zero planned guests', { plannedGuests: 0 }],
    ['too many planned guests', { plannedGuests: 5001 }],
    ['fractional planned guests', { plannedGuests: 2.5 }],
    ['stringly planned guests', { plannedGuests: '250' }],
    ['a negative generation', { generation: -1 }],
    ['a fractional generation', { generation: 1.5 }],
    ['an unknown top-level key', { plan: { budget: 1 } }],
    ['progress that is not an object', { progress: [] }],
    ['progress with an unknown key', { progress: { ...progress, extra: [] } }],
    ['too many done tasks', { progress: { ...progress, doneTasks: manyIds } }],
    ['a task id that is too long', { progress: { ...progress, doneTasks: [longId] } }],
    ['a task id that is not text', { progress: { ...progress, doneTasks: [7] } }],
    ['done tasks that are not a list', { progress: { ...progress, doneTasks: 'all' } }],
    ['too many checklist ticks', { progress: { ...progress, checklistDone: manyIds } }],
    ['a checklist id that is too long', { progress: { ...progress, checklistDone: [longId] } }],
    [
      'a vendor status outside the enum',
      { progress: { ...progress, vendorStatus: { a: 'paid' } } },
    ],
    ['too many vendor statuses', { progress: { ...progress, vendorStatus: manyVendors } }],
    [
      'a vendor id that is too long',
      { progress: { ...progress, vendorStatus: { [longId]: 'booked' } } },
    ],
  ])('reports corrupt for %s', (_name, over) => {
    expect(failure(tampered(over))).toBe('corrupt');
  });

  it.each(['v', 'brief', 'plannedGuests', 'generation', 'progress'])(
    'reports corrupt when %s is missing',
    (key) => {
      expect(failure(memoryStore(JSON.stringify(omit(good, key))))).toBe('corrupt');
    },
  );

  it('accepts the bounds themselves', () => {
    const edge = tampered({
      plannedGuests: 5000,
      generation: 0,
      progress: {
        doneTasks: manyIds.slice(0, 500),
        checklistDone: ['x'.repeat(80)],
        vendorStatus: Object.fromEntries(Object.entries(manyVendors).slice(0, 100)),
      },
    });
    expect(loaded(edge).progress.doneTasks).toHaveLength(500);
  });

  it('keeps ids the plan no longer has, without letting them change it', () => {
    const extra = tampered({
      progress: { ...progress, doneTasks: [...progress.doneTasks, 'ghost'] },
    });
    const back = loaded(extra);
    expect(back.progress.doneTasks).toContain('ghost');
    expect(back.plan).toEqual(state.plan);
  });

  it('drops a __proto__ key instead of polluting anything', () => {
    const text = JSON.stringify(good).replace(
      '"vendorStatus":{',
      '"vendorStatus":{"__proto__":"booked",',
    );
    expect(text).toContain('"__proto__":"booked"');
    const back = loaded(memoryStore(text));
    expect(Object.keys(back.progress.vendorStatus)).toEqual(['tent_shamiana']);
    expect(Object.getPrototypeOf(back.progress.vendorStatus)).toBe(Object.prototype);
    expect(Object.hasOwn({}, 'booked')).toBe(false);
  });
});

describe('loadPlan: tampered AI (the plan survives)', () => {
  const noAi = buildPlan(state.brief, today, {
    plannedGuests: 250,
    doneTasks: new Set(['define_goals', 'ai-task-1']),
  });
  if (!noAi.ok) throw new Error('expected a plan without AI');
  const withoutAi = (over: unknown): ReadyState => {
    const back = loaded(tampered({ ai: over }));
    expect(back.ai).toEqual({ status: 'idle' });
    expect(back.adjustments).toEqual([]);
    expect(back.plan.addenda).toBeUndefined();
    expect(back.progress).toEqual(state.progress);
    expect(back.generation).toBe(state.generation);
    return back;
  };

  it('restores without AI when a category id is unknown', () => {
    const back = withoutAi({
      suggestions: { ...suggestions, ideas: [{ ...suggestions.ideas[0], categoryId: 'nope' }] },
      meta,
    });
    expect(back.plan).toEqual(noAi.value);
  });

  it.each<[string, Record<string, unknown>]>([
    ['an unknown task id', { extraTasks: [{ ...suggestions.extraTasks[0], after: ['nope'] }] }],
    ['an unknown vendor id', { vendorQuestions: [{ vendorId: 'nope', questions: [] }] }],
    ['a missing field', { ideas: undefined }],
    ['a field of the wrong type', { summary: 7 }],
    ['a number that is not a number', { weightHints: [{ categoryId: 'decor', factor: null }] }],
    ['an unknown key', { extra: 'x' }],
  ])('restores without AI for %s', (_name, over) => {
    withoutAi({ suggestions: { ...suggestions, ...over }, meta });
  });

  it.each<[string, unknown]>([
    ['a bad request id', { suggestions, meta: { ...meta, requestId: 'x' } }],
    ['negative tokens', { suggestions, meta: { ...meta, inputTokens: -1 } }],
    ['an unknown meta key', { suggestions, meta: { ...meta, secret: 'k' } }],
    ['no meta', { suggestions }],
    ['no suggestions', { meta }],
    ['an extra key', { suggestions, meta, extra: true }],
    ['null', null],
    ['a number', 5],
    ['a list', []],
    ['text', '<script>alert(1)</script>'],
  ])('restores without AI for %s', (_name, over) => {
    withoutAi(over);
  });

  it('restores without AI when the field is absent altogether', () => {
    const back = loaded(memoryStore(JSON.stringify(omit(good, 'ai'))));
    expect(back.ai).toEqual({ status: 'idle' });
  });

  it('checks the suggestions against the brief kind: wedding ids do not fit a community brief', () => {
    const wedding = midPlanWithWeddingAi();
    const swapped = tampered({ ...envelopeOf(wedding), brief: state.brief });
    expect(loaded(swapped).ai).toEqual({ status: 'idle' });
  });

  it('sends absurd but schema-valid numbers back through the merge, clamped and logged', () => {
    const absurd: AiSuggestions = {
      summary: 's'.repeat(5000),
      ideas: Array.from({ length: 12 }, (_, i) => ({
        title: `Idea ${i}`,
        description: 'A long description. '.repeat(40),
        categoryId: 'decor',
        estimatedCost: i === 0 ? 1e12 : -50,
        personalization: '',
      })),
      weightHints: [{ categoryId: 'decor', factor: 9 }],
      extraTasks: Array.from({ length: 50 }, (_, i) => ({
        title: `Task ${i}`,
        categoryId: 'decor',
        durationDays: -4,
        leadDays: 9999,
        after: ['book_venue'],
      })),
      vendorQuestions: [],
    };
    const back = loaded(tampered({ ai: { suggestions: absurd, meta } }));
    expect(back.ai).toEqual({ status: 'applied', suggestions: absurd, meta });
    expect(back.adjustments.length).toBeGreaterThan(0);
    expect(back.adjustments.map((a) => a.kind)).toEqual(
      expect.arrayContaining(['clamped', 'truncated']),
    );
    expect(back.plan.budget.total).toBe(toMinor(state.brief.budget, state.brief.currency));
    const ideas = back.plan.addenda?.ideas ?? [];
    expect(ideas.length).toBeLessThanOrEqual(8);
    for (const idea of ideas) {
      expect(idea.estimatedCost).toBeLessThanOrEqual(toMinor(state.brief.budget, 'INR'));
      expect(idea.estimatedCost).toBeGreaterThanOrEqual(0);
    }
    expect(back.plan.addenda?.extraTasks.length).toBeLessThanOrEqual(5);
    expect(back.plan.addenda?.weightHints).toEqual([{ categoryId: 'decor', factor: 2 }]);
  });
});

/** A wedding plan with a valid AI result, whose category ids belong to the wedding template. */
function midPlanWithWeddingAi(): ReadyState {
  const weddingSuggestions: AiSuggestions = {
    summary: 'A traditional two-day celebration.',
    ideas: [
      {
        title: 'Live shehnai at the entrance',
        description: 'A shehnai duo welcomes guests as they arrive.',
        categoryId: 'catering',
        estimatedCost: 20_000,
        personalization: 'traditional',
      },
    ],
    weightHints: [],
    extraTasks: [],
    vendorQuestions: [],
  };
  return ready(
    run(
      initialPlanState,
      { type: 'brief/submitted', brief: brief('wedding'), today },
      { type: 'ai/applied', generation: 1, suggestions: weddingSuggestions, meta },
    ),
  );
}
