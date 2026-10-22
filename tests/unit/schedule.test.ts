/**
 * Tests for src/domain/schedule.ts, the backward critical-path scheduler.
 *
 * Does: pins the brief's assertions, the date window of `eventDateOf`, every status and its
 * boundary, the interval and slack arithmetic, done and inactive dependencies, cycle paths, the
 * event-today case, the post-event task, a seeded property test on random DAGs,
 * the acyclicity of every real template and the 500-task performance budget.
 * Never does: read the clock; `today` is a fixed date and the property test is seeded.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, type IsoDate } from '../../src/domain/dates.js';
import {
  AT_RISK_SLACK_DAYS,
  DUE_SOON_DAYS,
  eventDateOf,
  schedule,
  type Schedule,
  type ScheduledTask,
  type ScheduleError,
  type Status,
} from '../../src/domain/schedule.js';
import { templateFor } from '../../src/domain/templates/index.js';
import { birthdayTemplate } from '../../src/domain/templates/birthday.js';
import { communityTemplate } from '../../src/domain/templates/community.js';
import type { EventTemplate, TaskDef, TaskId } from '../../src/domain/templates/types.js';
import { weddingTemplate } from '../../src/domain/templates/wedding.js';
import { LIMITS } from '../../src/shared/limits.js';
import type { Result } from '../../src/shared/result.js';
import type { EventBrief } from '../../src/shared/schema.js';
import { brief, briefArb, dagArb, TODAY as today } from '../support/fixtures.js';

const SEED = 20_261_021;
const none: ReadonlySet<TaskId> = new Set();
const community = communityTemplate;

type Outcome = Result<Schedule, ScheduleError>;

/** Fails the test when a lookup comes back empty, instead of a non-null assertion. */
function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`missing ${what}`);
  return value;
}

function scheduled(result: Outcome): Schedule {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.value;
}

const taskOf = (result: Outcome, id: TaskId): ScheduledTask =>
  must(
    scheduled(result).tasks.find((t) => t.id === id),
    id,
  );
const statusOf = (result: Outcome, id: TaskId): Status => taskOf(result, id).status;

/** A one-day task due 10 days before the event, unless overridden. */
const task = (id: TaskId, over: Partial<Omit<TaskDef, 'id'>> = {}): TaskDef => ({
  id,
  title: id,
  categoryId: 'general',
  durationDays: 1,
  leadDays: 10,
  dependsOn: [],
  ...over,
});

/** A community brief whose event is `daysOut` days after `today`. */
const eventIn = (daysOut: number): EventBrief =>
  brief('community', { date: addDays(today, daysOut) });

describe('eventDateOf', () => {
  const check = (date: string) => eventDateOf(brief('community', { date }), today);

  it('accepts today and the last day of the horizon', () => {
    expect(check(today)).toEqual({ ok: true, value: today });
    const last = addDays(today, LIMITS.brief.horizonDays);
    expect(check(last)).toEqual({ ok: true, value: last });
  });

  it('rejects yesterday as past', () => {
    expect(check(addDays(today, -1))).toEqual({ ok: false, error: 'past' });
  });

  it('rejects one day beyond the horizon as too_far', () => {
    expect(check(addDays(today, LIMITS.brief.horizonDays + 1))).toEqual({
      ok: false,
      error: 'too_far',
    });
  });

  it('rejects impossible and malformed dates as invalid', () => {
    expect(check('2026-02-30')).toEqual({ ok: false, error: 'invalid' });
    expect(check('next friday')).toEqual({ ok: false, error: 'invalid' });
  });
});

describe('schedule: the brief assertions', () => {
  it('builds a dependency-respecting timeline for any DAG', () => {
    fc.assert(
      fc.property(dagArb, (tasks) => {
        const r = schedule(tasks, eventIn(120), today, none);
        if (!r.ok) return false;
        const byId = new Map(r.value.tasks.map((t) => [t.id, t]));
        const preds = (t: { id: TaskId }) =>
          must(
            tasks.find((d) => d.id === t.id),
            t.id,
          ).dependsOn.map((id) => must(byId.get(id), id));
        return r.value.tasks.every((t) => preds(t).every((p) => p.end <= t.start));
      }),
      { seed: SEED, numRuns: 200 },
    );
  });

  it('marks the public-space permit infeasible when the event is 12 days away', () => {
    const b = brief('community', { date: addDays(today, 12), venue: 'outdoor_public' });
    expect(statusOf(schedule(community.tasks, b, today, none), 'public_space_permission')).toBe(
      'infeasible',
    );
  });

  it('returns a cycle error instead of throwing', () => {
    const cyclic = [
      task('a', { dependsOn: ['c'] }),
      task('b', { dependsOn: ['a'] }),
      task('c', { dependsOn: ['b'] }),
    ];
    expect(schedule(cyclic, brief('community'), today, none)).toMatchObject({
      ok: false,
      error: { kind: 'cycle' },
    });
  });

  it('still produces a plan when the event is today', () => {
    expect(schedule(community.tasks, brief('community', { date: today }), today, none).ok).toBe(
      true,
    );
  });
});

describe('schedule: invalid dates', () => {
  it.each([
    ['past', addDays(today, -1)],
    ['too_far', addDays(today, LIMITS.brief.horizonDays + 1)],
    ['invalid', '2026-02-30'],
  ] as const)('returns invalid_date with reason %s', (reason, date) => {
    const result = schedule([task('a')], brief('community', { date }), today, none);
    expect(result).toEqual({ ok: false, error: { kind: 'invalid_date', reason } });
  });
});

describe('schedule: statuses', () => {
  // One task, no dependencies, event 30 days out: it starts today, so slack equals its latest
  // start and its deadline is `latestEnd` days from today. due_soon means a deadline within
  // DUE_SOON_DAYS of today while there is still room (slack above AT_RISK_SLACK_DAYS).
  const rows: readonly { name: string; duration: number; latestEnd: number; status: Status }[] = [
    { name: 'far from its deadline', duration: 2, latestEnd: 20, status: 'on_track' },
    { name: 'deadline 8 days out', duration: 2, latestEnd: 8, status: 'on_track' },
    { name: 'deadline exactly 7 days out', duration: 2, latestEnd: 7, status: 'due_soon' },
    { name: 'deadline 6 days out, slack 4', duration: 2, latestEnd: 6, status: 'due_soon' },
    { name: 'deadline 5 days out, slack 3', duration: 2, latestEnd: 5, status: 'due_soon' },
    { name: 'slack exactly 2, deadline near', duration: 2, latestEnd: 4, status: 'at_risk' },
    { name: 'slack exactly 0', duration: 2, latestEnd: 2, status: 'at_risk' },
    {
      name: 'slack -1 with the deadline still ahead',
      duration: 2,
      latestEnd: 1,
      status: 'infeasible',
    },
    { name: 'deadline is today, slack -1', duration: 1, latestEnd: 0, status: 'infeasible' },
    { name: 'deadline was yesterday', duration: 1, latestEnd: -1, status: 'overdue' },
    { name: 'deadline long gone', duration: 3, latestEnd: -40, status: 'overdue' },
  ];

  it.each(rows)('$name is $status', ({ duration, latestEnd, status }) => {
    const t = task('only', { durationDays: duration, leadDays: 30 - latestEnd });
    const result = schedule([t], eventIn(30), today, none);
    expect(statusOf(result, 'only')).toBe(status);
    expect(taskOf(result, 'only').latestEnd).toBe(addDays(today, latestEnd));
  });

  it('exposes the thresholds as named constants', () => {
    expect(AT_RISK_SLACK_DAYS).toBe(2);
    expect(DUE_SOON_DAYS).toBe(7);
  });

  it('reaches due_soon for a task pushed late by its dependency', () => {
    // b's deadline is 5 days out, but it cannot start before a ends on day 1: slack 3.
    const tasks = [
      task('a', { durationDays: 1, leadDays: 26 }),
      task('b', { durationDays: 1, leadDays: 25, dependsOn: ['a'] }),
    ];
    const result = schedule(tasks, eventIn(30), today, none);
    expect(taskOf(result, 'b')).toMatchObject({
      start: addDays(today, 1),
      latestStart: addDays(today, 4),
      latestEnd: addDays(today, 5),
      slackDays: 3,
      status: 'due_soon',
    });
  });

  it('reports done ahead of every other status', () => {
    const doomed = task('doomed', { durationDays: 5, leadDays: 40 });
    const result = schedule([doomed], eventIn(30), today, new Set(['doomed']));
    expect(statusOf(result, 'doomed')).toBe('done');
    expect(scheduled(result)).toMatchObject({ infeasibleCount: 0, overdueCount: 0 });
  });

  it('counts overdue and infeasible tasks, and ignores done ids that match no task', () => {
    const tasks = [
      task('late1', { leadDays: 40 }),
      task('late2', { leadDays: 31 }),
      task('tight', { durationDays: 3, leadDays: 28 }),
      task('fine'),
    ];
    const s = scheduled(schedule(tasks, eventIn(30), today, new Set(['ghost'])));
    expect(s.overdueCount).toBe(2);
    expect(s.infeasibleCount).toBe(1);
    expect(s.tasks).toHaveLength(4);
  });
});

describe('schedule: dates', () => {
  it('lets a dependent start on the day its dependency ends', () => {
    const tasks = [
      task('a', { durationDays: 3, leadDays: 20 }),
      task('b', { durationDays: 2, leadDays: 15, dependsOn: ['a'] }),
      task('c', { durationDays: 1, leadDays: 5, dependsOn: ['b'] }),
    ];
    const result = schedule(tasks, eventIn(60), today, none);
    expect(taskOf(result, 'a')).toMatchObject({ start: today, end: addDays(today, 3) });
    expect(taskOf(result, 'b')).toMatchObject({
      start: addDays(today, 3),
      end: addDays(today, 5),
    });
    expect(taskOf(result, 'c').start).toBe(addDays(today, 5));
  });

  it('derives deadlines from the event date and lead days', () => {
    const t = taskOf(
      schedule([task('a', { durationDays: 4, leadDays: 10 })], eventIn(60), today, none),
      'a',
    );
    expect(t.latestEnd).toBe(addDays(today, 50));
    expect(t.latestStart).toBe(addDays(today, 46));
    expect(t.slackDays).toBe(46);
  });

  it("pulls a dependency's deadline back to its successor's latest start", () => {
    // `a` alone could finish 5 days before the event, but `b` must start 12 days before it.
    const tasks = [
      task('a', { leadDays: 5 }),
      task('b', { durationDays: 2, leadDays: 10, dependsOn: ['a'] }),
    ];
    const result = schedule(tasks, eventIn(60), today, none);
    expect(taskOf(result, 'b').latestStart).toBe(addDays(today, 48));
    expect(taskOf(result, 'a').latestEnd).toBe(addDays(today, 48));
  });

  it('gives a post-event task a deadline after the event date', () => {
    const b = eventIn(30);
    const report = taskOf(schedule(community.tasks, b, today, none), 'post_event_report');
    expect(report.latestEnd).toBe(addDays(addDays(today, 30), 3));
    expect(report.latestEnd > b.date).toBe(true);
    expect(report.status).toBe('on_track');
  });

  it('does not let a done dependency push its dependent later', () => {
    const tasks = [
      task('a', { durationDays: 5, leadDays: 30 }),
      task('b', { durationDays: 2, leadDays: 10, dependsOn: ['a'] }),
    ];
    const open = schedule(tasks, eventIn(60), today, none);
    const ticked = schedule(tasks, eventIn(60), today, new Set(['a']));
    expect(taskOf(open, 'b').start).toBe(addDays(today, 5));
    expect(taskOf(ticked, 'b').start).toBe(today);
    expect(statusOf(ticked, 'a')).toBe('done');
  });
});

describe('schedule: which tasks and dependencies count', () => {
  const never = (): boolean => false;
  const always = (): boolean => true;

  it('leaves out tasks whose condition is false', () => {
    const tasks = [task('kept', { when: always }), task('dropped', { when: never }), task('plain')];
    const ids = scheduled(schedule(tasks, eventIn(60), today, none)).tasks.map((t) => t.id);
    expect(ids.toSorted()).toEqual(['kept', 'plain']);
  });

  it('ignores dependencies on inactive or unknown tasks, and reports only the active ones', () => {
    const tasks = [
      task('inactive', { durationDays: 9, leadDays: 50, when: never }),
      task('real', { durationDays: 2, leadDays: 40 }),
      task('b', { leadDays: 10, dependsOn: ['inactive', 'ghost', 'real'] }),
    ];
    const result = schedule(tasks, eventIn(60), today, none);
    expect(taskOf(result, 'b').dependsOn).toEqual(['real']);
    expect(taskOf(result, 'b').start).toBe(addDays(today, 2));
  });

  it('is not fooled into a cycle by a loop that runs through an inactive task', () => {
    const tasks = [task('a', { dependsOn: ['b'] }), task('b', { dependsOn: ['a'], when: never })];
    expect(schedule(tasks, eventIn(60), today, none).ok).toBe(true);
  });

  it('carries the title, category and the note only when the template has one', () => {
    const result = schedule(community.tasks, brief('community'), today, none);
    const permit = taskOf(result, 'public_space_permission');
    expect(permit.note).toContain('local authority');
    expect(permit.categoryId).toBe('venue_permits');
    expect(permit.title).toBe('Apply for public-space permission');
    expect('note' in taskOf(result, 'define_goals')).toBe(false);
  });

  it('orders tasks by latest start, then by input order', () => {
    const tasks = [
      task('late', { leadDays: 2 }),
      task('tie-b', { leadDays: 20 }),
      task('early', { leadDays: 40 }),
      task('tie-a', { leadDays: 20 }),
    ];
    const ids = scheduled(schedule(tasks, eventIn(60), today, none)).tasks.map((t) => t.id);
    expect(ids).toEqual(['early', 'tie-b', 'tie-a', 'late']);
  });

  it('does not mutate its inputs', () => {
    const tasks = Object.freeze(
      [task('a', { leadDays: 30 }), task('b', { dependsOn: ['a'] })].map((t) =>
        Object.freeze({ ...t, dependsOn: Object.freeze([...t.dependsOn]) }),
      ),
    );
    const doneIds = new Set(['a']);
    const result = schedule(tasks, eventIn(60), today, doneIds);
    expect(result.ok).toBe(true);
    expect([...doneIds]).toEqual(['a']);
  });
});

describe('schedule: cycles', () => {
  /** True when each id in the path depends on the next and the last depends on the first. */
  function isRealCycle(path: readonly TaskId[], tasks: readonly TaskDef[]): boolean {
    const dependsOn = (id: TaskId) =>
      must(
        tasks.find((t) => t.id === id),
        id,
      ).dependsOn;
    return (
      path.length > 0 &&
      new Set(path).size === path.length &&
      path.every((id, i) => dependsOn(id).includes(must(path[(i + 1) % path.length], 'next')))
    );
  }

  const cyclePath = (tasks: readonly TaskDef[]): readonly TaskId[] => {
    const result = schedule(tasks, eventIn(60), today, none);
    if (result.ok || result.error.kind !== 'cycle') throw new Error('expected a cycle error');
    return result.error.path;
  };

  it('returns the exact ids of a 3-cycle, in dependency order', () => {
    const tasks = [
      task('a', { dependsOn: ['c'] }),
      task('b', { dependsOn: ['a'] }),
      task('c', { dependsOn: ['b'] }),
    ];
    const path = cyclePath(tasks);
    expect(isRealCycle(path, tasks)).toBe(true);
    expect(path).toEqual(['a', 'c', 'b']);
  });

  it('returns a self-loop as a one-task cycle', () => {
    const tasks = [task('ok'), task('loop', { dependsOn: ['ok', 'loop'] })];
    expect(cyclePath(tasks)).toEqual(['loop']);
  });

  it('leaves out tasks that merely wait on a cycle, and tasks that are fine', () => {
    const tasks = [
      task('fine'),
      task('tail', { dependsOn: ['a'] }),
      task('a', { dependsOn: ['b', 'fine'] }),
      task('b', { dependsOn: ['a'] }),
    ];
    const path = cyclePath(tasks);
    expect(isRealCycle(path, tasks)).toBe(true);
    expect(path.toSorted()).toEqual(['a', 'b']);
  });

  it('finds a cycle in a random graph that may have many', () => {
    fc.assert(
      fc.property(
        fc.array(fc.array(fc.nat({ max: 7 }), { maxLength: 3 }), { minLength: 1, maxLength: 8 }),
        (rows) => {
          const tasks = rows.map((deps, i) =>
            task(`n${i}`, { dependsOn: deps.map((d) => `n${d}`) }),
          );
          const result = schedule(tasks, eventIn(60), today, none);
          return (
            result.ok || (result.error.kind === 'cycle' && isRealCycle(result.error.path, tasks))
          );
        },
      ),
      { seed: SEED, numRuns: 300 },
    );
  });
});

describe('schedule: event today or tomorrow', () => {
  const crunch: Record<string, EventBrief> = {
    'a typical community brief': brief('community'),
    'every condition on': brief('community', {
      venue: 'outdoor_public',
      subtype: 'sports_day',
      amplifiedSound: true,
      servesFood: true,
      servesAlcohol: true,
      accessibility: ['elderly'],
      guests: 1000,
      income: {
        ticketPrice: 100,
        expectedPaidAttendance: 500,
        sponsors: 50_000,
        donations: 1000,
        stallCount: 10,
        stallFee: 500,
      },
    }),
  };
  const positiveLead = new Map(community.tasks.filter((t) => t.leadDays > 0).map((t) => [t.id, t]));

  describe.each([0, 1])('with the event %i day(s) away', (daysOut) => {
    it.each(Object.keys(crunch))('marks every task due before the event unmeetable: %s', (name) => {
      const date = addDays(today, daysOut);
      const result = schedule(community.tasks, { ...must(crunch[name], name), date }, today, none);
      const s = scheduled(result);
      const before = s.tasks.filter((t) => positiveLead.has(t.id));
      expect(before.length).toBeGreaterThan(10);
      for (const t of before) expect(['infeasible', 'overdue'], t.id).toContain(t.status);
      expect(s.infeasibleCount + s.overdueCount).toBeGreaterThanOrEqual(before.length);
      expect(s.infeasibleCount).toBe(s.tasks.filter((t) => t.status === 'infeasible').length);
      expect(s.overdueCount).toBe(s.tasks.filter((t) => t.status === 'overdue').length);
    });
  });
});

describe('schedule: random DAGs', () => {
  const earlier = (a: IsoDate, b: IsoDate): IsoDate => (a < b ? a : b);
  const later = (a: IsoDate, b: IsoDate): IsoDate => (a > b ? a : b);

  it('satisfies the scheduling identities whatever is done and however far the event is', () => {
    fc.assert(
      fc.property(
        dagArb,
        fc.array(fc.boolean(), { maxLength: 30 }),
        fc.integer({ min: 0, max: 300 }),
        (tasks, flags, daysOut) => {
          const event = addDays(today, daysOut);
          const done = new Set(tasks.filter((_, i) => flags[i] === true).map((t) => t.id));
          const s = scheduled(schedule(tasks, eventIn(daysOut), today, done));
          const byId = new Map(s.tasks.map((t) => [t.id, t]));
          expect(s.tasks).toHaveLength(tasks.length);

          for (const def of tasks) {
            const t = must(byId.get(def.id), def.id);
            const successors = tasks
              .filter((other) => other.dependsOn.includes(def.id))
              .map((other) => must(byId.get(other.id), other.id));
            const openDeps = def.dependsOn
              .filter((id) => !done.has(id))
              .map((id) => must(byId.get(id), id));

            // Earliest dates: today or the last open dependency, and a task spans its duration.
            expect(t.start).toBe(openDeps.reduce((acc, d) => later(acc, d.end), today));
            expect(daysBetween(t.start, t.end)).toBe(def.durationDays);
            // Deadlines: the lead time or the tightest successor, whichever is earlier.
            expect(t.latestEnd).toBe(
              successors.reduce(
                (acc, s2) => earlier(acc, s2.latestStart),
                addDays(event, -def.leadDays),
              ),
            );
            expect(daysBetween(t.latestStart, t.latestEnd)).toBe(def.durationDays);
            expect(t.latestEnd <= addDays(event, -def.leadDays)).toBe(true);
            for (const next of successors) expect(t.latestEnd <= next.latestStart).toBe(true);
            expect(t.slackDays).toBe(daysBetween(t.start, t.latestStart));
            // Statuses agree with the numbers.
            expect(t.status === 'done').toBe(done.has(def.id));
            if (t.status === 'overdue') expect(t.latestEnd < today).toBe(true);
            if (t.status === 'infeasible') expect(t.slackDays).toBeLessThan(0);
            if (['on_track', 'due_soon', 'at_risk'].includes(t.status)) {
              expect(t.slackDays).toBeGreaterThanOrEqual(0);
            }
            const deadlineIn = daysBetween(today, t.latestEnd);
            if (t.status === 'due_soon') {
              expect(t.slackDays).toBeGreaterThan(AT_RISK_SLACK_DAYS);
              expect(deadlineIn).toBeLessThanOrEqual(DUE_SOON_DAYS);
            }
            if (t.status === 'on_track') {
              expect(t.slackDays).toBeGreaterThan(AT_RISK_SLACK_DAYS);
              expect(deadlineIn).toBeGreaterThan(DUE_SOON_DAYS);
            }
          }
          const starts = s.tasks.map((t) => t.latestStart);
          expect(starts).toEqual(starts.toSorted());
          expect(s.infeasibleCount).toBe(s.tasks.filter((t) => t.status === 'infeasible').length);
          expect(s.overdueCount).toBe(s.tasks.filter((t) => t.status === 'overdue').length);
        },
      ),
      { seed: SEED, numRuns: 300 },
    );
  });
});

describe('schedule: the real templates', () => {
  const on: Partial<
    Pick<
      EventBrief,
      | 'venue'
      | 'amplifiedSound'
      | 'servesFood'
      | 'servesAlcohol'
      | 'guests'
      | 'accessibility'
      | 'startTime'
      | 'durationHours'
    >
  > = {
    venue: 'outdoor_public',
    amplifiedSound: true,
    servesFood: true,
    servesAlcohol: true,
    guests: 5000,
    accessibility: ['elderly', 'wheelchair'],
    startTime: '10:00',
    durationHours: 16,
  };
  const off: typeof on = {
    venue: 'home',
    amplifiedSound: false,
    servesFood: false,
    servesAlcohol: false,
    guests: 1,
    accessibility: [],
    startTime: '09:00',
    durationHours: 1,
  };
  const date = addDays(today, 200);
  const briefs: readonly [EventTemplate, EventBrief][] = [
    [
      communityTemplate,
      brief('community', {
        ...on,
        date,
        subtype: 'sports_day',
        income: {
          ticketPrice: 1,
          expectedPaidAttendance: 1,
          sponsors: 1,
          donations: 1,
          stallCount: 1,
          stallFee: 1,
        },
      }),
    ],
    [communityTemplate, brief('community', { ...off, date })],
    [weddingTemplate, brief('wedding', { ...on, date })],
    [weddingTemplate, brief('wedding', { ...off, date })],
    [birthdayTemplate, brief('birthday', { ...on, date })],
    [birthdayTemplate, brief('birthday', { ...off, date })],
  ];

  /** Schedules the template for the brief and checks every active dependency edge. */
  function expectSound(template: EventTemplate, b: EventBrief): void {
    const s = scheduled(schedule(template.tasks, b, today, none));
    const byId = new Map(s.tasks.map((t) => [t.id, t]));
    const active = template.tasks.filter((t) => t.when === undefined || t.when(b));
    expect(s.tasks.map((t) => t.id).toSorted()).toEqual(active.map((t) => t.id).toSorted());
    for (const def of active) {
      const t = must(byId.get(def.id), def.id);
      // A template never depends on a task that is switched off, so no edge is dropped.
      expect(t.dependsOn, def.id).toEqual(def.dependsOn);
      for (const dep of def.dependsOn) {
        expect(must(byId.get(dep), dep).end <= t.start, `${dep} before ${def.id}`).toBe(true);
      }
    }
  }

  it.each(briefs.map(([template, b], i) => [`${template.kind} #${i}`, template, b] as const))(
    'schedules %s without a cycle and with every dependency honoured',
    (_name, template, b) => {
      expectSound(template, b);
    },
  );

  // With every task switched on, the whole graph is checked whatever conditions a sample brief
  // happens to trigger, so acyclicity does not depend on the random briefs below.
  it.each([communityTemplate, weddingTemplate, birthdayTemplate])(
    'schedules every $kind task at once, with every dependency honoured',
    (template) => {
      const allOn = { ...template, tasks: template.tasks.map((t) => ({ ...t, when: () => true })) };
      const b = brief(template.kind, { date });
      expectSound(allOn, b);
      expect(scheduled(schedule(allOn.tasks, b, today, none)).tasks).toHaveLength(
        template.tasks.length,
      );
    },
  );

  it.each([communityTemplate, weddingTemplate, birthdayTemplate])(
    'schedules nothing, without failing, when every $kind task is switched off',
    (template) => {
      const allOff = template.tasks.map((t) => ({ ...t, when: () => false }));
      expect(schedule(allOff, brief(template.kind, { date }), today, none)).toEqual({
        ok: true,
        value: { tasks: [], infeasibleCount: 0, overdueCount: 0 },
      });
    },
  );

  it('does so for any valid brief of any kind', () => {
    fc.assert(
      fc.property(briefArb, (b) => {
        expectSound(templateFor(b.kind), { ...b, date });
      }),
      { seed: SEED, numRuns: 200 },
    );
  });
});

describe('schedule: performance', () => {
  /** 500 tasks, each waiting on the two before it and on one seven back. */
  const gen500 = (): TaskDef[] =>
    Array.from({ length: 500 }, (_, i) =>
      task(`p${i}`, {
        durationDays: 1 + (i % 3),
        leadDays: 500 - i,
        dependsOn: [i - 1, i - 2, i - 7].filter((j) => j >= 0).map((j) => `p${j}`),
      }),
    );

  /** Best of five runs in milliseconds, after one warm-up so JIT compilation is not timed. */
  function timeIt(run: () => unknown): number {
    run();
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 5; i++) {
      const started = performance.now();
      run();
      best = Math.min(best, performance.now() - started);
    }
    return best;
  }

  it('schedules 500 tasks in under 50 ms', () => {
    const tasks = gen500();
    const b = eventIn(400);
    expect(scheduled(schedule(tasks, b, today, none)).tasks).toHaveLength(500);
    expect(timeIt(() => schedule(tasks, b, today, none))).toBeLessThan(50);
  });
});
