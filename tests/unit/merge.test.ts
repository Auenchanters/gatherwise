/**
 * Tests for src/domain/merge.ts, where untrusted model output meets the engine (Review Focus 4).
 *
 * Does: runs the brief's absurd payload, then one focused case per normalization rule, each
 * pinning the exact adjustment `kind` and `target`; checks what a merge preserves (total, guests,
 * today, done tasks, template deadlines), that a refresh replaces the old addenda, purity on
 * deep-frozen input, and a seeded property over arbitrary suggestion-shaped junk.
 * Never does: read the clock; `today` is fixed and every random input is seeded.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Budget } from '../../src/domain/budget.js';
import { addDays, isoDate } from '../../src/domain/dates.js';
import {
  mergeSuggestions,
  normalizeSuggestions,
  type Adjustment,
  type MergeContext,
} from '../../src/domain/merge.js';
import { toMinor } from '../../src/domain/money.js';
import { buildPlan, type Plan } from '../../src/domain/plan.js';
import { templateFor } from '../../src/domain/templates/index.js';
import { communityTemplate } from '../../src/domain/templates/community.js';
import type { EventKind } from '../../src/domain/templates/types.js';
import { LIMITS } from '../../src/shared/limits.js';
import type { AiSuggestions, EventBrief } from '../../src/shared/schema.js';
import { brief, briefArb, TODAY as today } from '../support/fixtures.js';

const SEED = { seed: 20_261_023, numRuns: 150 };
const ai = LIMITS.ai;

function planOf(b: EventBrief, opts?: Parameters<typeof buildPlan>[2], day = today): Plan {
  const result = buildPlan(b, day, opts);
  if (!result.ok) throw new Error(`expected a plan, got ${JSON.stringify(result.error)}`);
  return result.value;
}

/**
 * The fixture community brief: outdoor, amplified sound, food, 250 guests, no access needs and no
 * income. So `accessibility_plan` is an inactive task and `first_aid_ambulance` an inactive vendor.
 */
const base = planOf(brief('community'));

type Idea = AiSuggestions['ideas'][number];
type Hint = AiSuggestions['weightHints'][number];
type Extra = AiSuggestions['extraTasks'][number];
type Questions = AiSuggestions['vendorQuestions'][number];

const idea = (over: Partial<Idea> = {}): Idea => ({
  title: 'Diya-lined paths',
  description: 'Line the walkways with clay diyas made by local potters.',
  categoryId: 'decor',
  estimatedCost: 8000,
  personalization: 'Diwali festival, outdoor venue',
  ...over,
});
const extra = (over: Partial<Extra> = {}): Extra => ({
  title: 'Order clay diyas',
  categoryId: 'decor',
  durationDays: 5,
  leadDays: 10,
  after: ['book_venue'],
  ...over,
});
const hint = (categoryId: string, factor: number): Hint => ({ categoryId, factor });
const asks = (
  vendorId: string,
  questions: string[] = ['Can it stay up overnight?'],
): Questions => ({
  vendorId,
  questions,
});

const clean: AiSuggestions = {
  summary: 'A warm, walkable Diwali mela for 250 neighbours.',
  ideas: [idea()],
  weightHints: [hint('decor', 1.2)],
  extraTasks: [extra()],
  vendorQuestions: [asks('tent_shamiana')],
};

const merge = (over: Partial<AiSuggestions>, plan: Plan = base) =>
  mergeSuggestions(plan, { ...clean, ...over });
/** The adjustments of a merge, without their human-readable detail. */
const logOf = (over: Partial<AiSuggestions>): Omit<Adjustment, 'detail'>[] =>
  merge(over).adjustments.map(({ kind, target }) => ({ kind, target }));
const addendaOf = (over: Partial<AiSuggestions>) => {
  const { addenda } = merge(over).plan;
  if (!addenda) throw new Error('expected addenda after a merge');
  return addenda;
};

const linesSum = (b: Budget): number => b.lines.reduce((acc, l) => acc + l.allocated, 0);
const codePoints = (s: string): number => Array.from(s).length;

describe('the absurd payload (Review Focus 4)', () => {
  const absurd: AiSuggestions = {
    summary: 'Big plans.',
    ideas: [idea({ title: 'Fireworks', estimatedCost: 1e12 }), idea({ title: '   ' })],
    weightHints: [hint('decor', 9)],
    extraTasks: [
      extra({ after: ['publicity'] }),
      extra({ durationDays: Number.NaN }),
      ...Array.from({ length: 48 }, (_, i) => extra({ title: `Task ${i}` })),
    ],
    vendorQuestions: [asks('first_aid_ambulance')],
  };
  const result = mergeSuggestions(base, absurd);

  it('keeps the total and reconciles the budget', () => {
    expect(result.plan.budget.total).toBe(base.budget.total);
    const b = result.plan.budget;
    expect(linesSum(b) + b.contingency).toBe(b.total + (b.overBy ?? 0));
  });

  it('clamps, drops and truncates, logging each with a sentence', () => {
    expect(result.adjustments.map((a) => a.kind)).toEqual(
      expect.arrayContaining(['clamped', 'dropped', 'truncated']),
    );
    for (const a of result.adjustments) expect(a.detail.length, a.target).toBeGreaterThan(0);
    expect(result.adjustments.map(({ kind, target }) => ({ kind, target }))).toEqual([
      { kind: 'clamped', target: 'ideas[0].estimatedCost' },
      { kind: 'dropped', target: 'ideas[1]' },
      { kind: 'clamped', target: 'weightHints[0].factor' },
      { kind: 'truncated', target: 'extraTasks' },
      { kind: 'dropped', target: 'extraTasks[0].after[0]' },
      { kind: 'dropped', target: 'extraTasks[1]' },
      { kind: 'dropped', target: 'vendorQuestions[0]' },
    ]);
  });

  it('says what changed in plain words with formatted money', () => {
    const [cost, , factor, cut] = result.adjustments;
    expect(cost?.detail).toBe(
      "Cost of 'Fireworks' clamped from ₹10,00,00,00,00,000.00 to ₹1,50,000.00 (the whole budget)",
    );
    expect(factor?.detail).toBe('Weight hint for Décor clamped from 9 to 2');
    expect(cut?.detail).toBe('Kept the first 5 of 50 extra tasks');
  });

  it('still uses everything that survived', () => {
    const addenda = result.plan.addenda;
    expect(addenda?.ideas.map((i) => [i.title, i.estimatedCost])).toEqual([
      ['Fireworks', toMinor(150_000, 'INR')],
    ]);
    expect(addenda?.weightHints).toEqual([hint('decor', 2)]);
    expect(addenda?.extraTasks.map((t) => [t.id, t.dependsOn])).toEqual([
      ['ai-task-1', []],
      ['ai-task-2', ['book_venue']],
      ['ai-task-3', ['book_venue']],
      ['ai-task-4', ['book_venue']],
    ]);
    expect(addenda?.vendorQuestions).toEqual({});
  });
});

describe('a clean response', () => {
  const result = merge({});

  it('needs no adjustments and lands whole', () => {
    expect(result.adjustments).toEqual([]);
    expect(result.plan.addenda).toEqual({
      summary: clean.summary,
      ideas: [
        {
          id: 'ai-idea-1',
          title: 'Diya-lined paths',
          description: 'Line the walkways with clay diyas made by local potters.',
          categoryId: 'decor',
          estimatedCost: toMinor(8000, 'INR'),
          personalization: 'Diwali festival, outdoor venue',
          source: 'ai',
        },
      ],
      weightHints: [hint('decor', 1.2)],
      extraTasks: [
        {
          id: 'ai-task-1',
          title: 'Order clay diyas',
          categoryId: 'decor',
          durationDays: 5,
          leadDays: 10,
          dependsOn: ['book_venue'],
        },
      ],
      vendorQuestions: { tent_shamiana: ['Can it stay up overnight?'] },
    });
  });

  it('shows the AI ideas with their fit and schedules the extra task', () => {
    expect(result.plan.ideas.map((i) => [i.id, i.source, i.fit.fits])).toEqual([
      ['ai-idea-1', 'ai', true],
    ]);
    expect(result.plan.schedule.tasks.some((t) => t.id === 'ai-task-1')).toBe(true);
  });

  it('gives AI tasks no condition', () => {
    const [task] = addendaOf({}).extraTasks;
    expect(task && 'when' in task).toBe(false);
  });
});

describe('strings', () => {
  it('trims without logging', () => {
    expect(logOf({ summary: '   Hello   ' })).toEqual([]);
    expect(addendaOf({ summary: '   Hello   ' }).summary).toBe('Hello');
  });

  it('truncates the summary to its cap', () => {
    expect(logOf({ summary: 'a'.repeat(ai.summaryMax + 1) })).toEqual([
      { kind: 'truncated', target: 'summary' },
    ]);
    expect(addendaOf({ summary: 'a'.repeat(500) }).summary).toBe('a'.repeat(ai.summaryMax));
  });

  it('counts code points, so an emoji is never split', () => {
    const summary = addendaOf({ summary: '🎉'.repeat(500) }).summary;
    expect(summary).toBe('🎉'.repeat(ai.summaryMax));
    expect(summary.length).toBe(ai.summaryMax * 2);
  });

  it('keeps Hindi, Tamil and Arabic text as given', () => {
    const titles = ['दीयों से सजी राहें', 'விளக்கு அலங்காரம்', 'ممرات مضاءة'];
    const ideas = addendaOf({ ideas: titles.map((title) => idea({ title })) }).ideas;
    expect(ideas.map((i) => i.title)).toEqual(titles);
  });

  it('truncates an idea title, description and personalization to their caps', () => {
    expect(
      logOf({
        ideas: [
          idea({
            title: 't'.repeat(ai.ideaTitleMax + 1),
            description: 'd'.repeat(ai.ideaDescriptionMax + 1),
            personalization: 'p'.repeat(ai.personalizationMax + 1),
          }),
        ],
      }),
    ).toEqual([
      { kind: 'truncated', target: 'ideas[0].title' },
      { kind: 'truncated', target: 'ideas[0].description' },
      { kind: 'truncated', target: 'ideas[0].personalization' },
    ]);
  });

  it('never leaves trailing space where it cut, and reports the length it kept', () => {
    const title = `${'a'.repeat(ai.ideaTitleMax - 1)} tail`;
    expect(addendaOf({ ideas: [idea({ title })] }).ideas[0]?.title).toBe(
      'a'.repeat(ai.ideaTitleMax - 1),
    );
    expect(merge({ ideas: [idea({ title })] }).adjustments[0]?.detail).toBe(
      `Title of idea 1 shortened from ${ai.ideaTitleMax + 4} to ${ai.ideaTitleMax - 1} characters`,
    );
  });
});

describe('ideas', () => {
  it(`keeps the first ${ai.ideasMax}`, () => {
    const ideas = Array.from({ length: 12 }, (_, i) => idea({ title: `Idea ${i}` }));
    expect(logOf({ ideas })).toEqual([{ kind: 'truncated', target: 'ideas' }]);
    expect(addendaOf({ ideas }).ideas.map((i) => i.id)).toEqual(
      Array.from({ length: ai.ideasMax }, (_, i) => `ai-idea-${i + 1}`),
    );
  });

  it('drops an idea with an empty title or description', () => {
    expect(logOf({ ideas: [idea({ title: '  ' })] })).toEqual([
      { kind: 'dropped', target: 'ideas[0]' },
    ]);
    expect(logOf({ ideas: [idea({ description: '' })] })).toEqual([
      { kind: 'dropped', target: 'ideas[0]' },
    ]);
  });

  it('omits an empty personalization without dropping the idea', () => {
    expect(logOf({ ideas: [idea({ personalization: ' ' })] })).toEqual([]);
    const [kept] = addendaOf({ ideas: [idea({ personalization: ' ' })] }).ideas;
    expect(kept && 'personalization' in kept).toBe(false);
  });

  it('drops an idea in an unknown category', () => {
    expect(logOf({ ideas: [idea({ categoryId: 'catering' })] })).toEqual([
      { kind: 'dropped', target: 'ideas[0]' },
    ]);
  });

  it('logs one drop for a dropped idea, never the cuts it would have needed', () => {
    const long = idea({
      title: 't'.repeat(500),
      personalization: 'p'.repeat(500),
      estimatedCost: Number.NaN,
    });
    expect(logOf({ ideas: [{ ...long, categoryId: 'catering' }] })).toEqual([
      { kind: 'dropped', target: 'ideas[0]' },
    ]);
    expect(logOf({ ideas: [{ ...long, description: ' ' }] })).toEqual([
      { kind: 'dropped', target: 'ideas[0]' },
    ]);
  });

  it('numbers ideas in output order after a drop', () => {
    const ideas = [idea({ title: '' }), idea({ title: 'B' }), idea({ title: 'C' })];
    expect(addendaOf({ ideas }).ideas.map((i) => [i.id, i.title])).toEqual([
      ['ai-idea-1', 'B'],
      ['ai-idea-2', 'C'],
    ]);
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['a negative', -500],
  ])('sets %s cost to 0', (_name, estimatedCost) => {
    expect(logOf({ ideas: [idea({ estimatedCost })] })).toEqual([
      { kind: 'clamped', target: 'ideas[0].estimatedCost' },
    ]);
    expect(addendaOf({ ideas: [idea({ estimatedCost })] }).ideas[0]?.estimatedCost).toBe(0);
  });

  it('caps a cost at the whole budget, even 1e300', () => {
    for (const estimatedCost of [150_001, 1e12, 1e300]) {
      expect(logOf({ ideas: [idea({ estimatedCost })] })).toEqual([
        { kind: 'clamped', target: 'ideas[0].estimatedCost' },
      ]);
      expect(addendaOf({ ideas: [idea({ estimatedCost })] }).ideas[0]?.estimatedCost).toBe(
        toMinor(150_000, 'INR'),
      );
    }
  });

  it('puts an amount it cannot show exactly into words', () => {
    const detailFor = (estimatedCost: number) =>
      merge({ ideas: [idea({ title: 'Lamps', estimatedCost })] }).adjustments[0]?.detail;
    const toZero = "Cost of 'Lamps' clamped from an unusable amount to ₹0.00";
    expect(detailFor(Number.NaN)).toBe(toZero);
    expect(detailFor(Number.NEGATIVE_INFINITY)).toBe(toZero);
    expect(detailFor(-2.345)).toBe(toZero);
    expect(detailFor(1e300)).toBe(
      "Cost of 'Lamps' clamped from an unusable amount to ₹1,50,000.00 (the whole budget)",
    );
    expect(detailFor(Number.MAX_VALUE)).toBe(
      "Cost of 'Lamps' clamped from an unusable amount to ₹1,50,000.00 (the whole budget)",
    );
    expect(detailFor(-500)).toBe("Cost of 'Lamps' clamped from -₹500.00 to ₹0.00");
  });

  it('rounds a cost to a whole unit without logging it, and keeps the budget itself', () => {
    const ideas = [1500.6, 150_000, 150_000.4, -0.4, -1e-7].map((estimatedCost) =>
      idea({ estimatedCost }),
    );
    expect(logOf({ ideas })).toEqual([]);
    expect(addendaOf({ ideas }).ideas.map((i) => i.estimatedCost)).toEqual([
      150_100, 15_000_000, 15_000_000, 0, 0,
    ]);
    expect(logOf({ ideas: [idea({ estimatedCost: 150_000.5 })] })).toEqual([
      { kind: 'clamped', target: 'ideas[0].estimatedCost' },
    ]);
  });
});

describe('weight hints', () => {
  it(`keeps the first ${ai.weightHintsMax}`, () => {
    const ids = communityTemplate.categories.map((c) => c.id);
    const weightHints = [...ids, 'decor'].map((id) => hint(id, 1));
    expect(logOf({ weightHints })).toEqual([{ kind: 'truncated', target: 'weightHints' }]);
    expect(addendaOf({ weightHints }).weightHints).toHaveLength(ai.weightHintsMax);
  });

  it('drops a hint for an unknown category', () => {
    expect(logOf({ weightHints: [hint('catering', 1.5)] })).toEqual([
      { kind: 'dropped', target: 'weightHints[0]' },
    ]);
  });

  it('keeps the first hint for a category and drops the rest', () => {
    const weightHints = [hint('decor', 1.5), hint('decor', 0.7)];
    expect(logOf({ weightHints })).toEqual([{ kind: 'dropped', target: 'weightHints[1]' }]);
    expect(addendaOf({ weightHints }).weightHints).toEqual([hint('decor', 1.5)]);
  });

  it('drops a factor that is not a finite number', () => {
    for (const factor of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(logOf({ weightHints: [hint('decor', factor)] })).toEqual([
        { kind: 'dropped', target: 'weightHints[0]' },
      ]);
    }
    expect(merge({ weightHints: [hint('decor', Number.NaN)] }).adjustments[0]?.detail).toBe(
      'Dropped the weight hint for Décor: its factor is not a usable number',
    );
  });

  it(`clamps a factor into ${ai.factorMin}..${ai.factorMax}`, () => {
    expect(logOf({ weightHints: [hint('decor', 9), hint('rentals', 0.1)] })).toEqual([
      { kind: 'clamped', target: 'weightHints[0].factor' },
      { kind: 'clamped', target: 'weightHints[1].factor' },
    ]);
    expect(
      addendaOf({ weightHints: [hint('decor', 9), hint('rentals', 0.1)] }).weightHints,
    ).toEqual([hint('decor', ai.factorMax), hint('rentals', ai.factorMin)]);
    expect(logOf({ weightHints: [hint('decor', ai.factorMax)] })).toEqual([]);
  });
});

describe('extra tasks', () => {
  it(`keeps the first ${ai.extraTasksMax} and numbers them`, () => {
    const extraTasks = Array.from({ length: 50 }, (_, i) => extra({ title: `Task ${i}` }));
    expect(logOf({ extraTasks })).toEqual([{ kind: 'truncated', target: 'extraTasks' }]);
    expect(addendaOf({ extraTasks }).extraTasks.map((t) => t.id)).toEqual(
      Array.from({ length: ai.extraTasksMax }, (_, i) => `ai-task-${i + 1}`),
    );
  });

  it('drops a task with an empty title or an unknown category', () => {
    expect(logOf({ extraTasks: [extra({ title: ' \n ' })] })).toEqual([
      { kind: 'dropped', target: 'extraTasks[0]' },
    ]);
    expect(logOf({ extraTasks: [extra({ categoryId: 'catering' })] })).toEqual([
      { kind: 'dropped', target: 'extraTasks[0]' },
    ]);
  });

  it('logs one drop for a dropped task, never the cuts it would have needed', () => {
    expect(
      logOf({ extraTasks: [extra({ title: 'x'.repeat(500), durationDays: Number.NaN })] }),
    ).toEqual([{ kind: 'dropped', target: 'extraTasks[0]' }]);
    expect(
      logOf({ extraTasks: [extra({ title: 'x'.repeat(500), categoryId: 'catering' })] }),
    ).toEqual([{ kind: 'dropped', target: 'extraTasks[0]' }]);
  });

  it('drops a task whose duration or lead time is not a finite number', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(logOf({ extraTasks: [extra({ durationDays: bad })] })).toEqual([
        { kind: 'dropped', target: 'extraTasks[0]' },
      ]);
      expect(logOf({ extraTasks: [extra({ leadDays: bad })] })).toEqual([
        { kind: 'dropped', target: 'extraTasks[0]' },
      ]);
    }
  });

  it(`rounds and clamps the duration into ${ai.durationMin}..${ai.durationMax} days`, () => {
    const cases: [number, number][] = [
      [-5, ai.durationMin],
      [0, ai.durationMin],
      [100, ai.durationMax],
      [0.4, ai.durationMin],
      [1e300, ai.durationMax],
    ];
    for (const [durationDays, expected] of cases) {
      const extraTasks = [extra({ durationDays, after: [] })];
      expect(logOf({ extraTasks })).toEqual([
        { kind: 'clamped', target: 'extraTasks[0].durationDays' },
      ]);
      expect(addendaOf({ extraTasks }).extraTasks[0]?.durationDays).toBe(expected);
    }
    expect(merge({ extraTasks: [extra({ durationDays: -5, after: [] })] }).adjustments).toEqual([
      {
        kind: 'clamped',
        target: 'extraTasks[0].durationDays',
        detail: "Duration of 'Order clay diyas' in days clamped from -5 to 1",
      },
    ]);
  });

  it('rounds days to whole numbers without logging it', () => {
    const extraTasks = [
      extra({ durationDays: 2.4, leadDays: 3.6, after: [] }),
      extra({ durationDays: 59.5, leadDays: -0.2, after: [] }),
    ];
    expect(logOf({ extraTasks })).toEqual([]);
    const kept = addendaOf({ extraTasks }).extraTasks;
    expect(kept.map((t) => [t.durationDays, t.leadDays])).toEqual([
      [2, 4],
      [60, 0],
    ]);
    expect(Object.is(kept[1]?.leadDays, -0)).toBe(false);
  });

  it(`rounds and clamps the lead time into ${ai.leadMin}..${ai.leadMax} days`, () => {
    const cases: [number, number][] = [
      [1000, ai.leadMax],
      [-30, ai.leadMin],
      [-7.6, ai.leadMin],
      [365.7, ai.leadMax],
    ];
    for (const [leadDays, expected] of cases) {
      const extraTasks = [extra({ leadDays, after: [] })];
      expect(logOf({ extraTasks })).toEqual([
        { kind: 'clamped', target: 'extraTasks[0].leadDays' },
      ]);
      expect(addendaOf({ extraTasks }).extraTasks[0]?.leadDays).toBe(expected);
    }
  });

  it(`keeps the first ${ai.afterMax} dependencies`, () => {
    const after = ['book_venue', 'set_budget', 'form_committee', 'define_goals'];
    expect(logOf({ extraTasks: [extra({ after })] })).toEqual([
      { kind: 'truncated', target: 'extraTasks[0].after' },
    ]);
    expect(addendaOf({ extraTasks: [extra({ after })] }).extraTasks[0]?.dependsOn).toEqual(
      after.slice(0, ai.afterMax),
    );
  });

  it('drops a dependency on a task that is not active for this brief', () => {
    const extraTasks = [extra({ after: ['accessibility_plan', 'book_venue'] })];
    expect(logOf({ extraTasks })).toEqual([{ kind: 'dropped', target: 'extraTasks[0].after[0]' }]);
    expect(addendaOf({ extraTasks }).extraTasks[0]?.dependsOn).toEqual(['book_venue']);
  });

  it('drops a dependency that is due after the extra task has to start', () => {
    // publicity is due 3 days out; a 5-day task due 10 days out must start 15 days out.
    const extraTasks = [extra({ after: ['publicity'] })];
    expect(logOf({ extraTasks })).toEqual([{ kind: 'dropped', target: 'extraTasks[0].after[0]' }]);
    expect(addendaOf({ extraTasks }).extraTasks[0]?.dependsOn).toEqual([]);
  });

  it('keeps a dependency due exactly when the extra task has to start', () => {
    // book_venue is due 45 days out; a 5-day task due 40 days out starts exactly then.
    const extraTasks = [extra({ leadDays: 40, durationDays: 5 })];
    expect(logOf({ extraTasks })).toEqual([]);
    expect(logOf({ extraTasks: [extra({ leadDays: 41, durationDays: 5 })] })).toEqual([
      { kind: 'dropped', target: 'extraTasks[0].after[0]' },
    ]);
  });

  it('drops a repeated dependency', () => {
    const extraTasks = [extra({ after: ['book_venue', 'book_venue'] })];
    expect(logOf({ extraTasks })).toEqual([{ kind: 'dropped', target: 'extraTasks[0].after[1]' }]);
    expect(addendaOf({ extraTasks }).extraTasks[0]?.dependsOn).toEqual(['book_venue']);
  });

  it('checks dependencies against the clamped numbers, not the raw ones', () => {
    // A 1000-day lead is clamped to 365, which no community task can come before.
    const extraTasks = [extra({ leadDays: 1000 })];
    expect(logOf({ extraTasks })).toEqual([
      { kind: 'clamped', target: 'extraTasks[0].leadDays' },
      { kind: 'dropped', target: 'extraTasks[0].after[0]' },
    ]);
  });
});

describe('vendor questions', () => {
  it(`keeps the first ${ai.vendorQuestionsMax} vendors`, () => {
    const vendorQuestions = [...base.vendors.map((v) => asks(v.id)), asks('tent_shamiana')];
    expect(vendorQuestions.length).toBeGreaterThan(ai.vendorQuestionsMax);
    const log = logOf({ vendorQuestions });
    expect(log[0]).toEqual({ kind: 'truncated', target: 'vendorQuestions' });
  });

  it('drops questions for a vendor this plan does not need, or does not know', () => {
    expect(logOf({ vendorQuestions: [asks('first_aid_ambulance')] })).toEqual([
      { kind: 'dropped', target: 'vendorQuestions[0]' },
    ]);
    expect(logOf({ vendorQuestions: [asks('caterer')] })).toEqual([
      { kind: 'dropped', target: 'vendorQuestions[0]' },
    ]);
  });

  it('keeps the first entry for a vendor', () => {
    const vendorQuestions = [asks('tent_shamiana', ['First?']), asks('tent_shamiana', ['Second?'])];
    expect(logOf({ vendorQuestions })).toEqual([{ kind: 'dropped', target: 'vendorQuestions[1]' }]);
    expect(addendaOf({ vendorQuestions }).vendorQuestions).toEqual({ tent_shamiana: ['First?'] });
  });

  it(`keeps the first ${ai.questionsPerVendorMax} questions, each capped and trimmed`, () => {
    const questions = ['  One?  ', 'q'.repeat(ai.questionMax + 1), 'Three?', 'Four?', 'Five?'];
    expect(logOf({ vendorQuestions: [asks('generator', questions)] })).toEqual([
      { kind: 'truncated', target: 'vendorQuestions[0].questions' },
      { kind: 'truncated', target: 'vendorQuestions[0].questions[1]' },
    ]);
    expect(addendaOf({ vendorQuestions: [asks('generator', questions)] }).vendorQuestions).toEqual({
      generator: ['One?', 'q'.repeat(ai.questionMax), 'Three?', 'Four?'],
    });
  });

  it('drops empty questions, and a vendor left with none', () => {
    expect(logOf({ vendorQuestions: [asks('generator', ['', 'Fuel?'])] })).toEqual([
      { kind: 'dropped', target: 'vendorQuestions[0].questions[0]' },
    ]);
    expect(logOf({ vendorQuestions: [asks('generator', [' ', '', '\t'])] })).toEqual([
      { kind: 'dropped', target: 'vendorQuestions[0]' },
    ]);
    expect(logOf({ vendorQuestions: [asks('generator', [])] })).toEqual([
      { kind: 'dropped', target: 'vendorQuestions[0]' },
    ]);
  });
});

describe('normalizeSuggestions', () => {
  it('only lets extra tasks follow the active tasks it is given', () => {
    const ctx: MergeContext = {
      brief: base.brief,
      template: communityTemplate,
      activeTasks: new Map(),
      vendorIds: new Set(),
    };
    const { addenda, adjustments } = normalizeSuggestions(clean, ctx);
    expect(addenda.extraTasks[0]?.dependsOn).toEqual([]);
    expect(adjustments.map((a) => a.target)).toEqual([
      'extraTasks[0].after[0]',
      'vendorQuestions[0]',
    ]);
  });
});

describe('mergeSuggestions', () => {
  it('keeps today, the guest counts and the done tasks', () => {
    const b = brief('community', { guests: 400 });
    const plan = planOf(b, { plannedGuests: 250, doneTasks: new Set(['define_goals']) });
    const merged = mergeSuggestions(plan, clean).plan;
    expect(merged.today).toBe(plan.today);
    expect(merged.eventDate).toBe(plan.eventDate);
    expect(merged.plannedGuests).toBe(250);
    expect(merged.budget.guests).toBe(400);
    expect(merged.budget.total).toBe(plan.budget.total);
    expect(merged.schedule.tasks.find((t) => t.id === 'define_goals')?.status).toBe('done');
  });

  it('replaces the previous addenda on a refresh, without carrying a ticked AI task over', () => {
    const first = mergeSuggestions(base, clean).plan;
    const ticked = planOf(first.brief, {
      ...(first.addenda ? { addenda: first.addenda } : {}),
      doneTasks: new Set(['ai-task-1', 'define_goals']),
    });
    const refreshed = mergeSuggestions(ticked, {
      ...clean,
      extraTasks: [extra({ title: 'Hire a rangoli artist' })],
    }).plan;
    const status = (id: string) => refreshed.schedule.tasks.find((t) => t.id === id)?.status;
    expect(refreshed.addenda?.extraTasks.map((t) => t.title)).toEqual(['Hire a rangoli artist']);
    expect(status('ai-task-1')).not.toBe('done');
    expect(status('define_goals')).toBe('done');
  });

  it('keeps AI task ticks when the same response is re-merged with the done set', () => {
    const first = mergeSuggestions(base, clean).plan;
    const done = new Set(['ai-task-1', 'define_goals']);
    const again = mergeSuggestions(first, clean, { doneTasks: done }).plan;
    const status = (id: string) => again.schedule.tasks.find((t) => t.id === id)?.status;
    expect(again.addenda).toEqual(first.addenda);
    expect(status('ai-task-1')).toBe('done');
    expect(status('define_goals')).toBe('done');
    expect(status('set_budget')).not.toBe('done');
  });

  it('never moves a template task: extra tasks only add to the timeline', () => {
    const merged = merge({ extraTasks: [extra(), extra({ leadDays: -7, after: [] })] }).plan;
    for (const task of base.schedule.tasks) {
      expect(merged.schedule.tasks.find((t) => t.id === task.id)).toEqual(task);
    }
  });

  it('works on deep-frozen input and changes neither the plan nor the suggestions', () => {
    const plan = deepFreeze(planOf(brief('wedding')));
    const s = deepFreeze<AiSuggestions>({
      ...clean,
      ideas: [idea({ categoryId: 'catering', estimatedCost: 1e12 })],
      weightHints: [hint('catering', 9)],
      extraTasks: [extra({ categoryId: 'catering', after: ['set_budget', 'book_caterer'] })],
      vendorQuestions: [asks('caterer')],
    });
    const before = JSON.stringify([plan, s]);
    const merged = mergeSuggestions(plan, s);
    expect(merged.plan.addenda?.ideas).toHaveLength(1);
    expect(JSON.stringify([plan, s])).toBe(before);
  });
});

/** Freezes an object graph so any write in the code under test throws. */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

describe('any suggestion-shaped junk (property)', () => {
  const junkNumber = fc.oneof(
    fc.double(),
    fc.integer({ min: -1000, max: 1000 }),
    fc.constantFrom(Number.NaN, Infinity, -Infinity, 1e300, -1e300, 1e12, -0, 0.5),
  );
  const junkText = fc.oneof(
    fc.string({ maxLength: 120 }),
    fc.string({ unit: 'grapheme', maxLength: 200 }),
    fc.constantFrom(
      '',
      '   ',
      '🎉'.repeat(300),
      'مرحبا بكم '.repeat(60),
      'அன்புடன் வரவேற்கிறோம்',
      '<script>alert(1)</script>',
      'x'.repeat(2000),
    ),
  );
  const oneOf = (ids: readonly string[]) =>
    fc.oneof(fc.constantFrom(...ids), fc.constant('not_a_real_id'));

  const suggestionsFor = (kind: EventKind): fc.Arbitrary<AiSuggestions> => {
    const t = templateFor(kind);
    const category = oneOf(t.categories.map((c) => c.id));
    return fc.record({
      summary: junkText,
      ideas: fc.array(
        fc.record({
          title: junkText,
          description: junkText,
          categoryId: category,
          estimatedCost: junkNumber,
          personalization: junkText,
        }),
        { maxLength: 14 },
      ),
      weightHints: fc.array(fc.record({ categoryId: category, factor: junkNumber }), {
        maxLength: 16,
      }),
      extraTasks: fc.array(
        fc.record({
          title: junkText,
          categoryId: category,
          durationDays: junkNumber,
          leadDays: junkNumber,
          after: fc.array(oneOf(t.tasks.map((task) => task.id)), { maxLength: 6 }),
        }),
        { maxLength: 60 },
      ),
      vendorQuestions: fc.array(
        fc.record({
          vendorId: oneOf(t.vendors.map((v) => v.id)),
          questions: fc.array(junkText, { maxLength: 7 }),
        }),
        { maxLength: 12 },
      ),
    });
  };

  const scenario = briefArb.chain((b) =>
    fc.record({
      b: fc.constant(b),
      leadTime: fc.integer({ min: 0, max: 400 }),
      plannedGuests: fc.integer({ min: LIMITS.brief.guestsMin, max: LIMITS.brief.guestsMax }),
      s: suggestionsFor(b.kind),
    }),
  );

  const withinCap = (s: string, max: number): boolean => codePoints(s) <= max && s === s.trim();

  /** How many items a list cap cut, read back from its "Kept the first N of M" detail. */
  const cutBy = (adjustments: readonly Adjustment[], list: string): number => {
    const cap = adjustments.find((a) => a.kind === 'truncated' && a.target === list);
    if (!cap) return 0;
    const counts = /^Kept the first (\d+) of (\d+) /u.exec(cap.detail);
    if (!counts) throw new Error(`no counts in "${cap.detail}"`);
    return Number(counts[2]) - Number(counts[1]);
  };

  it('accounts for every item: kept, dropped with one adjustment, or cut by the cap', () => {
    fc.assert(
      fc.property(scenario, ({ b, leadTime, s }) => {
        const plan = planOf(b, {}, addDays(isoDate(b.date), -leadTime));
        const { plan: merged, adjustments } = mergeSuggestions(plan, s);
        const addenda = merged.addenda;
        if (!addenda) throw new Error('expected addenda');
        const lists: [string, number, number][] = [
          ['ideas', s.ideas.length, addenda.ideas.length],
          ['weightHints', s.weightHints.length, addenda.weightHints.length],
          ['extraTasks', s.extraTasks.length, addenda.extraTasks.length],
          [
            'vendorQuestions',
            s.vendorQuestions.length,
            Object.keys(addenda.vendorQuestions).length,
          ],
        ];
        for (const [list, given, kept] of lists) {
          const item = new RegExp(`^${list}\\[\\d+\\]$`, 'u');
          const drops = adjustments.filter((a) => a.kind === 'dropped' && item.test(a.target));
          expect(kept + drops.length + cutBy(adjustments, list), list).toBe(given);
          // A dropped item is reported once, with nothing logged beneath it.
          for (const drop of drops) {
            const under = adjustments.filter((a) => a.target.startsWith(`${drop.target}.`));
            expect(under, drop.target).toEqual([]);
          }
        }
      }),
      SEED,
    );
  });

  it('normalizes everything into a plan that still adds up', () => {
    fc.assert(
      fc.property(scenario, ({ b, leadTime, plannedGuests, s }) => {
        const plan = planOf(b, { plannedGuests }, addDays(isoDate(b.date), -leadTime));

        const { plan: merged, adjustments } = mergeSuggestions(plan, s);
        const { budget } = merged;
        expect(budget.total).toBe(plan.budget.total);
        expect(linesSum(budget) + budget.contingency).toBe(budget.total + (budget.overBy ?? 0));

        const addenda = merged.addenda;
        if (!addenda) throw new Error('expected addenda');
        expect(withinCap(addenda.summary, ai.summaryMax)).toBe(true);
        expect(addenda.ideas.length).toBeLessThanOrEqual(ai.ideasMax);
        for (const i of addenda.ideas) {
          expect(Number.isSafeInteger(i.estimatedCost)).toBe(true);
          expect(i.estimatedCost).toBeGreaterThanOrEqual(0);
          expect(i.estimatedCost).toBeLessThanOrEqual(budget.total);
          expect(withinCap(i.title, ai.ideaTitleMax) && i.title !== '').toBe(true);
          expect(withinCap(i.description, ai.ideaDescriptionMax)).toBe(true);
          expect(withinCap(i.personalization ?? '', ai.personalizationMax)).toBe(true);
        }

        expect(addenda.weightHints.length).toBeLessThanOrEqual(ai.weightHintsMax);
        const hinted = addenda.weightHints.map((h) => h.categoryId);
        expect(new Set(hinted).size).toBe(hinted.length);
        for (const h of addenda.weightHints) {
          expect(h.factor).toBeGreaterThanOrEqual(ai.factorMin);
          expect(h.factor).toBeLessThanOrEqual(ai.factorMax);
        }

        expect(addenda.extraTasks.length).toBeLessThanOrEqual(ai.extraTasksMax);
        const ids = addenda.extraTasks.map((t) => t.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const t of addenda.extraTasks) {
          expect(Number.isInteger(t.durationDays) && Number.isInteger(t.leadDays)).toBe(true);
          expect(t.durationDays).toBeGreaterThanOrEqual(ai.durationMin);
          expect(t.durationDays).toBeLessThanOrEqual(ai.durationMax);
          expect(t.leadDays).toBeGreaterThanOrEqual(ai.leadMin);
          expect(t.leadDays).toBeLessThanOrEqual(ai.leadMax);
          expect(withinCap(t.title, ai.taskTitleMax) && t.title !== '').toBe(true);
          expect(t.dependsOn.length).toBeLessThanOrEqual(ai.afterMax);
          expect(merged.schedule.tasks.some((x) => x.id === t.id)).toBe(true);
        }

        const vendorIds = Object.keys(addenda.vendorQuestions);
        expect(vendorIds.length).toBeLessThanOrEqual(ai.vendorQuestionsMax);
        for (const id of vendorIds) {
          expect(merged.vendors.some((v) => v.id === id)).toBe(true);
          const questions = addenda.vendorQuestions[id] ?? [];
          expect(questions.length).toBeGreaterThan(0);
          expect(questions.length).toBeLessThanOrEqual(ai.questionsPerVendorMax);
          for (const q of questions) expect(withinCap(q, ai.questionMax) && q !== '').toBe(true);
        }

        for (const a of adjustments) {
          expect(['clamped', 'dropped', 'truncated']).toContain(a.kind);
          expect(a.target.length).toBeGreaterThan(0);
          expect(a.detail.trim().length).toBeGreaterThan(0);
        }

        // Every kept dependency finishes before the extra task must start, so the AI may add
        // tasks but never moves a template task's dates or status.
        const defs = new Map(templateFor(b.kind).tasks.map((t) => [t.id, t]));
        for (const t of addenda.extraTasks) {
          for (const id of t.dependsOn) {
            const dep = defs.get(id);
            expect(dep && dep.leadDays >= t.leadDays + t.durationDays).toBe(true);
          }
        }
        for (const task of plan.schedule.tasks) {
          expect(merged.schedule.tasks.find((t) => t.id === task.id)).toEqual(task);
        }
      }),
      SEED,
    );
  });
});
