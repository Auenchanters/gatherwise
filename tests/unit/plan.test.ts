/**
 * Tests for src/domain/plan.ts, which runs every engine module for a brief.
 *
 * Does: checks a full plan for each event kind, each invalid-date reason, the event-today case
 * (Review Focus 1), a budget planned for one guest count and rescaled to another (R29), done
 * tasks, standard versus AI ideas with their fit, folded-in AI addenda, and the invariant throw.
 * Never does: read the clock; `today` is a fixed date.
 */
import { describe, expect, it } from 'vitest';
import { breakEven } from '../../src/domain/break-even';
import { buildBudget, rescaleGuests, type Budget } from '../../src/domain/budget';
import { addDays, isoDate } from '../../src/domain/dates';
import { ideaFit, standardIdeas } from '../../src/domain/ideas';
import { toMinor } from '../../src/domain/money';
import {
  assemblePlan,
  buildPlan,
  type AiAddenda,
  type Plan,
  type PlanError,
} from '../../src/domain/plan';
import { templateFor } from '../../src/domain/templates';
import { communityTemplate } from '../../src/domain/templates/community';
import { requiredVendors } from '../../src/domain/vendors';
import { planShifts } from '../../src/domain/volunteers';
import type { Result } from '../../src/shared/result';
import { EVENT_KINDS, type EventBrief } from '../../src/shared/schema';
import { brief } from '../support/fixtures';

const today = isoDate('2026-10-21');

function planned(result: Result<Plan, PlanError>): Plan {
  if (!result.ok) throw new Error(`expected a plan, got ${JSON.stringify(result.error)}`);
  return result.value;
}

const planOf = (b: EventBrief, opts?: Parameters<typeof buildPlan>[2]): Plan =>
  planned(buildPlan(b, today, opts));

const linesSum = (b: Budget): number => b.lines.reduce((acc, l) => acc + l.allocated, 0);

const addenda: AiAddenda = {
  summary: 'A warm, walkable mela for the whole court.',
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
    {
      id: 'ai-idea-2',
      title: 'Fireworks show',
      description: 'A ticketed fireworks finale.',
      categoryId: 'decor',
      estimatedCost: toMinor(150_000, 'INR'),
      source: 'ai',
    },
  ],
  weightHints: [{ categoryId: 'decor', factor: 1.5 }],
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
  vendorQuestions: { tent_shamiana: ['Can the tent stay up overnight?'] },
};

describe('buildPlan', () => {
  it.each(EVENT_KINDS)('builds a full, reconciled plan for a %s brief', (kind) => {
    const b = brief(kind);
    const plan = planOf(b);
    const template = templateFor(kind);
    const budget = buildBudget(b, template);
    expect(plan.brief).toBe(b);
    expect(plan.today).toBe(today);
    expect(plan.eventDate).toBe(b.date);
    expect(plan.plannedGuests).toBe(b.guests);
    expect(plan.budget).toEqual(budget);
    expect(plan.vendors).toEqual(requiredVendors(b, template, isoDate(b.date)));
    expect(plan.shifts).toEqual(planShifts(b));
    expect(plan.schedule.tasks.length).toBeGreaterThan(0);
    expect(plan.vendors.length).toBeGreaterThan(0);
    expect(plan.ideas.length).toBeGreaterThan(0);
    expect('addenda' in plan).toBe(false);
  });

  it.each([
    ['2026-02-30', 'invalid'],
    ['not-a-date', 'invalid'],
    [addDays(today, -1), 'past'],
    [addDays(today, 731), 'too_far'],
  ] as const)('rejects the event date %s as %s', (date, reason) => {
    expect(buildPlan(brief('community', { date }), today)).toEqual({
      ok: false,
      error: { kind: 'invalid_date', reason },
    });
  });

  it('plans an event happening today: every task before it is overdue, nothing throws', () => {
    for (const kind of EVENT_KINDS) {
      const plan = planOf(brief(kind, { date: today }));
      const template = templateFor(kind);
      expect(plan.schedule.tasks.length).toBeGreaterThan(0);
      for (const t of plan.schedule.tasks) {
        const lead = template.tasks.find((d) => d.id === t.id)?.leadDays ?? 0;
        if (lead > 0) expect(['overdue', 'infeasible'], t.id).toContain(t.status);
      }
      expect(plan.schedule.overdueCount).toBeGreaterThan(0);
    }
  });

  it('plans the budget for 250 guests and rescales it to 400 (R29)', () => {
    const b = brief('community', { guests: 400 });
    const plan = planOf(b, { plannedGuests: 250 });
    const base = buildBudget({ ...b, guests: 250 }, communityTemplate);
    expect(plan.plannedGuests).toBe(250);
    expect(plan.budget).toEqual(rescaleGuests(base, 400));
    expect(plan.budget.guests).toBe(400);
    expect(plan.budget.total).toBe(base.total);
    for (const [i, line] of plan.budget.lines.entries()) {
      const before = base.lines[i]?.allocated ?? 0;
      if (line.scales === 'per_guest') expect(line.allocated).toBe(Math.round((before * 8) / 5));
      else expect(line.allocated).toBe(before);
    }
    // Per-guest lines grow by 35,64,000 paise, which eats the 15,00,000 contingency and more.
    expect(plan.budget.contingency).toBe(0);
    expect(plan.budget.overBy).toBe(2_064_000);
    expect(linesSum(plan.budget) + plan.budget.contingency).toBe(
      plan.budget.total + (plan.budget.overBy ?? 0),
    );
    expect(plan.breakEven.costs).toBe(17_064_000);
  });

  it('marks the tasks the user ticked as done', () => {
    const plan = planOf(brief('community'), { doneTasks: new Set(['define_goals', 'set_budget']) });
    const statusOf = (id: string) => plan.schedule.tasks.find((t) => t.id === id)?.status;
    expect(statusOf('define_goals')).toBe('done');
    expect(statusOf('set_budget')).toBe('done');
    expect(statusOf('book_venue')).not.toBe('done');
  });

  it('counts break-even income only for community events', () => {
    const income = {
      ticketPrice: 100,
      expectedPaidAttendance: 200,
      sponsors: 50_000,
      donations: 0,
      stallCount: 10,
      stallFee: 1000,
    };
    const community = planOf(brief('community', { income }));
    expect(community.breakEven).toEqual(breakEven(community.budget, income));
    expect(community.breakEven.income).toBe(toMinor(80_000, 'INR'));
    expect(planOf(brief('wedding')).breakEven.income).toBe(0);
  });

  it('shows standard ideas that all fit when there are no addenda', () => {
    for (const kind of EVENT_KINDS) {
      const b = brief(kind);
      const plan = planOf(b);
      const standard = standardIdeas(templateFor(kind), b, plan.budget);
      expect(plan.ideas).toEqual(standard.map((i) => ({ ...i, fit: { fits: true, overBy: 0 } })));
      for (const i of plan.ideas) expect(i.source).toBe('template');
    }
  });

  it('respects standard idea conditions', () => {
    const ids = (b: EventBrief) => planOf(b).ideas.map((i) => i.id);
    expect(ids(brief('community'))).not.toContain('std-accessible_seating');
    expect(ids(brief('community', { accessibility: ['elderly'] }))).toContain(
      'std-accessible_seating',
    );
  });

  it('shows AI ideas, each with its fit against the hinted budget', () => {
    const plan = planOf(brief('community'), { addenda });
    expect(plan.addenda).toBe(addenda);
    expect(plan.ideas.map((i) => i.source)).toEqual(['ai', 'ai']);
    const [diyas, fireworks] = plan.ideas;
    expect(diyas?.fit).toEqual({ fits: true, overBy: 0 });
    const decor = plan.budget.lines.find((l) => l.categoryId === 'decor')?.allocated ?? 0;
    expect(fireworks?.fit).toEqual({ fits: false, overBy: toMinor(150_000, 'INR') - decor });
    for (const i of plan.ideas) expect(i.fit).toEqual(ideaFit(i, plan.budget));
  });

  it('falls back to standard ideas when the addenda carry none', () => {
    const plan = planOf(brief('community'), { addenda: { ...addenda, ideas: [] } });
    expect(plan.ideas.length).toBeGreaterThan(0);
    for (const i of plan.ideas) expect(i.source).toBe('template');
  });

  it('folds weight hints into the budget and keeps the total', () => {
    const b = brief('community');
    const plan = planOf(b, { addenda });
    expect(plan.budget).toEqual(buildBudget(b, communityTemplate, addenda.weightHints));
    expect(plan.budget.total).toBe(planOf(b).budget.total);
  });

  it('applies weight hints before the rescale, never chaining rescales', () => {
    const b = brief('community', { guests: 400 });
    const plan = planOf(b, { addenda, plannedGuests: 250 });
    const base = buildBudget({ ...b, guests: 250 }, communityTemplate, addenda.weightHints);
    expect(plan.budget).toEqual(rescaleGuests(base, 400));
  });

  it('schedules extra tasks after the template tasks they follow', () => {
    const plan = planOf(brief('community'), { addenda });
    const extra = plan.schedule.tasks.find((t) => t.id === 'ai-task-1');
    const venue = plan.schedule.tasks.find((t) => t.id === 'book_venue');
    expect(extra?.dependsOn).toEqual(['book_venue']);
    expect(extra && venue && extra.start >= venue.end).toBe(true);
    expect(extra?.latestEnd).toBe(addDays(isoDate(brief('community').date), -10));
  });
});

describe('assemblePlan', () => {
  it('throws an invariant error if the tasks it is given form a cycle', () => {
    const b = brief('community');
    const loop = (id: string, dep: string) => ({
      id,
      title: id,
      categoryId: 'decor',
      durationDays: 1,
      leadDays: 1,
      dependsOn: [dep],
    });
    expect(() =>
      assemblePlan({
        brief: b,
        today,
        eventDate: isoDate(b.date),
        plannedGuests: b.guests,
        doneTasks: new Set(),
        addenda: { ...addenda, extraTasks: [loop('a', 'b'), loop('b', 'a')] },
      }),
    ).toThrow(/^invariant:/u);
  });

  it('is what buildPlan returns once the date checks out', () => {
    const b = brief('birthday');
    const done = new Set(['set_budget']);
    expect(
      assemblePlan({
        brief: b,
        today,
        eventDate: isoDate(b.date),
        plannedGuests: 20,
        doneTasks: done,
      }),
    ).toEqual(planOf(b, { plannedGuests: 20, doneTasks: done }));
  });
});
