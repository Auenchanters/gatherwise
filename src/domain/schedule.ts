/**
 * The critical-path scheduler: turns template tasks into a dated timeline by working backward from
 * the event date, with an honest status on every task.
 * Does: drops tasks whose condition is false, orders the rest topologically (Kahn), then makes two
 * passes in O(V+E). The backward pass fixes each task's deadline (`latestEnd`, `latestStart`) from
 * its lead time and from what depends on it. The forward pass fixes the earliest it can really run
 * (`start`, `end`) from today and from the dependencies still open. Slack is the gap between the
 * two, and a negative slack is reported as `infeasible`.
 * Never does: read the clock (`today` is a parameter); throw on a dependency cycle (it returns the
 * cycle); compress a deadline to make a plan look feasible. An impossible task keeps its true
 * deadline and is marked `infeasible` or `overdue` so the user sees what cannot be done in time.
 */
import { LIMITS } from '../shared/limits.js';
import { err, ok, type Result } from '../shared/result.js';
import type { EventBrief } from '../shared/schema.js';
import { addDays, daysBetween, parseIsoDate, type IsoDate } from './dates.js';
import type { TaskDef, TaskId } from './templates/types.js';

/** A task with slack up to this many days is `at_risk`: one slip and it becomes infeasible. */
export const AT_RISK_SLACK_DAYS = 2;
/**
 * A task with room to spare (slack above `AT_RISK_SLACK_DAYS`) is `due_soon` when its deadline is
 * within this many days of today.
 */
export const DUE_SOON_DAYS = 7;

/** How a task stands against its deadline. `done` comes from the user, the rest from the dates. */
export type Status = 'done' | 'on_track' | 'due_soon' | 'at_risk' | 'overdue' | 'infeasible';

/** One task placed on the calendar. A task occupies `[start, end)`, so a dependent may start on `end`. */
export interface ScheduledTask {
  readonly id: TaskId;
  readonly title: string;
  readonly categoryId: string;
  /** The earliest date the task can start: today, or when its last open dependency ends. */
  readonly start: IsoDate;
  /** `start` plus the duration. */
  readonly end: IsoDate;
  /** The last date the task can start and still meet its deadline. */
  readonly latestStart: IsoDate;
  /** The deadline: the event date minus the lead time, or earlier if a dependent needs it sooner. */
  readonly latestEnd: IsoDate;
  /** Days from `start` to `latestStart`; negative means the deadline cannot be met. */
  readonly slackDays: number;
  readonly status: Status;
  /** Dependencies that are part of this plan; ids of tasks that are switched off are left out. */
  readonly dependsOn: readonly TaskId[];
  /** The template's caveat for the task, when it has one. */
  readonly note?: string;
}

/** A timeline, ordered by latest start. */
export interface Schedule {
  readonly tasks: readonly ScheduledTask[];
  /** How many tasks are `infeasible`. */
  readonly infeasibleCount: number;
  /** How many tasks are `overdue`. */
  readonly overdueCount: number;
}

/**
 * Why no schedule could be built: a dependency cycle, or an event date outside the planning
 * window.
 */
export type ScheduleError =
  | { readonly kind: 'cycle'; readonly path: readonly TaskId[] }
  | { readonly kind: 'invalid_date'; readonly reason: 'invalid' | 'past' | 'too_far' };

/**
 * The event date of a brief, checked against `today`: it must be a real calendar date, not in the
 * past, and at most `LIMITS.brief.horizonDays` ahead. Today itself is allowed. Only the date is
 * read, so the brief form can check it before the rest of the brief is valid.
 */
export function eventDateOf(
  brief: Pick<EventBrief, 'date'>,
  today: IsoDate,
): Result<IsoDate, 'invalid' | 'past' | 'too_far'> {
  const parsed = parseIsoDate(brief.date);
  if (!parsed.ok) return err('invalid');
  const daysAway = daysBetween(today, parsed.value);
  if (daysAway < 0) return err('past');
  return daysAway > LIMITS.brief.horizonDays ? err('too_far') : ok(parsed.value);
}

/** A task and its working numbers. Dates are whole days counted from today, so today is 0. */
interface Node {
  readonly def: TaskDef;
  /** Active dependencies, and the tasks that depend on this one. */
  readonly deps: Node[];
  readonly dependents: Node[];
  /** Dependencies not yet placed during the topological sort; above 0 means still blocked. */
  waiting: number;
  start: number;
  end: number;
  latestStart: number;
  latestEnd: number;
}

const isBlocked = (node: Node): boolean => node.waiting > 0;

/**
 * One cycle among the nodes a topological sort could not place. Every blocked node has a blocked
 * dependency, so following the first one from any blocked node must eventually revisit a node;
 * the stretch from that node onward is a cycle. Tasks that merely wait on a cycle are left out.
 */
function findCycle(nodes: readonly Node[]): TaskId[] {
  const walk = new Map<Node, number>();
  let node = nodes.find(isBlocked);
  while (node && !walk.has(node)) {
    walk.set(node, walk.size);
    node = node.deps.find(isBlocked);
  }
  const from = node && walk.get(node);
  return [...walk.keys()].slice(from).map((n) => n.def.id);
}

/**
 * First match wins: done, overdue (deadline before today), infeasible (negative slack), at_risk
 * (slack within `AT_RISK_SLACK_DAYS`), due_soon (deadline within `DUE_SOON_DAYS` of today), else
 * on_track. `latestEnd` is in days from today.
 */
function classify(isDone: boolean, slack: number, latestEnd: number): Status {
  if (isDone) return 'done';
  if (latestEnd < 0) return 'overdue';
  if (slack < 0) return 'infeasible';
  if (slack <= AT_RISK_SLACK_DAYS) return 'at_risk';
  return latestEnd <= DUE_SOON_DAYS ? 'due_soon' : 'on_track';
}

/**
 * Schedules `tasks` for the event in `brief`.
 *
 * Only tasks whose `when` is absent or true are planned; a `dependsOn` id that is not among them is
 * ignored. A task in `done` keeps its place but no longer holds up its dependents. Tasks are
 * returned ordered by latest start, ties in input order. `tasks` and `done` are not modified.
 *
 * Task durations and lead times must be whole numbers.
 * @returns the schedule, or `{kind: 'cycle', path}` where each id in `path` depends on the next and
 * the last depends on the first, or `{kind: 'invalid_date', reason}` (see {@link eventDateOf}).
 * @throws RangeError if a duration or lead time is not a whole number or pushes a date outside
 * years 0000 to 9999.
 */
export function schedule(
  tasks: readonly TaskDef[],
  brief: EventBrief,
  today: IsoDate,
  done: ReadonlySet<TaskId>,
): Result<Schedule, ScheduleError> {
  const eventDate = eventDateOf(brief, today);
  if (!eventDate.ok) return err({ kind: 'invalid_date', reason: eventDate.error });
  const eventDay = daysBetween(today, eventDate.value);

  const nodes = tasks
    .filter((def) => def.when === undefined || def.when(brief))
    .map((def): Node => ({
      def,
      deps: [],
      dependents: [],
      waiting: 0,
      start: 0,
      end: 0,
      latestStart: 0,
      latestEnd: eventDay - def.leadDays,
    }));
  const byId = new Map(nodes.map((node) => [node.def.id, node]));
  for (const node of nodes) {
    for (const id of node.def.dependsOn) {
      const dep = byId.get(id);
      if (dep) {
        node.deps.push(dep);
        dep.dependents.push(node);
      }
    }
    node.waiting = node.deps.length;
  }

  // Kahn's algorithm. `sorted` doubles as the queue: the loop below also visits what it appends.
  const sorted = nodes.filter((node) => node.waiting === 0);
  for (const node of sorted) {
    for (const next of node.dependents) {
      next.waiting -= 1;
      if (next.waiting === 0) sorted.push(next);
    }
  }
  if (sorted.length < nodes.length) return err({ kind: 'cycle', path: findCycle(nodes) });

  // Backward: dependents come first, so a node's deadline is final before it pulls on its deps.
  for (const node of sorted.toReversed()) {
    node.latestStart = node.latestEnd - node.def.durationDays;
    for (const dep of node.deps) dep.latestEnd = Math.min(dep.latestEnd, node.latestStart);
  }
  // Forward: a done dependency no longer holds anything up.
  for (const node of sorted) {
    for (const dep of node.deps) {
      if (!done.has(dep.def.id)) node.start = Math.max(node.start, dep.end);
    }
    node.end = node.start + node.def.durationDays;
  }

  // Sorting is stable, so tasks with the same latest start keep their input order.
  const timeline = nodes
    .toSorted((a, b) => a.latestStart - b.latestStart)
    .map((node): ScheduledTask => {
      const { def } = node;
      const slack = node.latestStart - node.start;
      return {
        id: def.id,
        title: def.title,
        categoryId: def.categoryId,
        start: addDays(today, node.start),
        end: addDays(today, node.end),
        latestStart: addDays(today, node.latestStart),
        latestEnd: addDays(today, node.latestEnd),
        slackDays: slack,
        status: classify(done.has(def.id), slack, node.latestEnd),
        dependsOn: node.deps.map((dep) => dep.def.id),
        ...(def.note === undefined ? {} : { note: def.note }),
      };
    });
  const count = (status: Status): number => timeline.filter((t) => t.status === status).length;
  return ok({
    tasks: timeline,
    infeasibleCount: count('infeasible'),
    overdueCount: count('overdue'),
  });
}
