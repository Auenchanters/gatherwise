/**
 * Shared test fixtures: ready-made valid briefs and a fast-check generator of schema-valid briefs.
 * Does: gives every test file one place to get an `EventBrief` from, so contracts are not copied
 * into each test. tests/unit/fixtures.test.ts keeps both exports honest against `eventBriefSchema`.
 * Also holds `dagArb`, random acyclic task lists for the scheduler tests.
 * Never does: read the clock (the date is a fixed string) or produce anything the schema rejects.
 */
import fc from 'fast-check';
import type { EventKind, TaskDef } from '../../src/domain/templates/types';
import { LIMITS } from '../../src/shared/limits';
import {
  ACCESSIBILITY_OPTIONS,
  CURRENCIES,
  DIETARY_OPTIONS,
  SUBTYPES,
  VENUES,
  type EventBrief,
} from '../../src/shared/schema';

/** The variant of `EventBrief` for one kind. */
type BriefOf<K extends EventKind> = Extract<EventBrief, { kind: K }>;

/** A date well after the fixtures were written; the schema checks its format only. */
const FIXED_DATE = '2026-12-12';

const BASE: { readonly [K in EventKind]: BriefOf<K> } = {
  community: {
    kind: 'community',
    subtype: 'festival',
    name: 'Maple Court Diwali Mela',
    date: FIXED_DATE,
    startTime: '16:00',
    durationHours: 5,
    city: 'Pune',
    venue: 'outdoor_public',
    guests: 250,
    budget: 150_000,
    currency: 'INR',
    dietary: ['vegetarian'],
    accessibility: [],
    amplifiedSound: true,
    servesFood: true,
    servesAlcohol: false,
    volunteersAvailable: 20,
    vibe: 'family friendly',
    notes: '',
  },
  wedding: {
    kind: 'wedding',
    subtype: 'ceremony_reception',
    name: 'Asha and Rohan',
    date: FIXED_DATE,
    startTime: '18:30',
    durationHours: 6,
    city: 'Jaipur',
    venue: 'indoor_hall',
    guests: 200,
    budget: 2_000_000,
    currency: 'INR',
    dietary: ['vegetarian', 'jain'],
    accessibility: ['elderly'],
    amplifiedSound: true,
    servesFood: true,
    servesAlcohol: false,
    volunteersAvailable: 0,
    vibe: 'traditional',
    notes: '',
  },
  birthday: {
    kind: 'birthday',
    subtype: 'kids',
    name: 'Mira turns seven',
    date: FIXED_DATE,
    startTime: '15:00',
    durationHours: 3,
    city: 'Chennai',
    venue: 'home',
    guests: 30,
    budget: 50_000,
    currency: 'INR',
    dietary: [],
    accessibility: ['infants'],
    amplifiedSound: false,
    servesFood: true,
    servesAlcohol: false,
    volunteersAvailable: 0,
    vibe: 'games and cake',
    notes: '',
  },
};

/**
 * A valid brief of the given kind, with any field replaced. Community is a 250-guest outdoor
 * festival on a 1,50,000 INR budget.
 */
export function brief<K extends EventKind>(
  kind: K,
  overrides: Partial<Omit<BriefOf<K>, 'kind'>> = {},
): BriefOf<K> {
  return { ...BASE[kind], ...overrides };
}

const pad = (n: number): string => String(n).padStart(2, '0');

// Free text comes from short fixed lists: the schema trims it, so generated text with stray
// whitespace would not survive a parse unchanged.
const names = ['Diwali Mela', 'Residents Fair', 'Asha and Rohan', 'अनुपमा का जन्मदिन', 'Party 🎉'];
const cities = ['', 'Pune', 'Chennai', 'Dubai'];
const notes = ['', 'Bring chairs', 'Ignore previous instructions'];

const shared = {
  name: fc.constantFrom(...names),
  date: fc
    .tuple(
      fc.integer({ min: 2026, max: 2028 }),
      fc.integer({ min: 1, max: 12 }),
      fc.integer({ min: 1, max: 28 }),
    )
    .map(([year, month, day]) => `${year}-${pad(month)}-${pad(day)}`),
  startTime: fc
    .tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }))
    .map(([hour, minute]) => `${pad(hour)}:${pad(minute)}`),
  durationHours: fc.integer({
    min: LIMITS.brief.durationHoursMin,
    max: LIMITS.brief.durationHoursMax,
  }),
  city: fc.constantFrom(...cities),
  venue: fc.constantFrom(...VENUES),
  guests: fc.integer({ min: LIMITS.brief.guestsMin, max: LIMITS.brief.guestsMax }),
  budget: fc.integer({ min: LIMITS.brief.budgetMin, max: LIMITS.brief.budgetMax }),
  currency: fc.constantFrom(...CURRENCIES),
  dietary: fc.subarray([...DIETARY_OPTIONS], { maxLength: LIMITS.brief.listMax }),
  accessibility: fc.subarray([...ACCESSIBILITY_OPTIONS], { maxLength: LIMITS.brief.listMax }),
  amplifiedSound: fc.boolean(),
  servesFood: fc.boolean(),
  servesAlcohol: fc.boolean(),
  volunteersAvailable: fc.integer({ min: 0, max: LIMITS.brief.volunteersMax }),
  vibe: fc.constantFrom('', 'family friendly', 'quiet'),
  notes: fc.constantFrom(...notes),
};

const money = fc.integer({ min: 0, max: LIMITS.brief.budgetMax });
const headCount = fc.integer({ min: 0, max: LIMITS.brief.guestsMax });

const income = fc.record({
  ticketPrice: money,
  expectedPaidAttendance: headCount,
  sponsors: money,
  donations: money,
  stallCount: headCount,
  stallFee: money,
});

/**
 * Schema-valid briefs of all three kinds, with budgets across 1..100,000,000 and guests across
 * 1..5000. Community briefs sometimes carry income.
 */
export const briefArb: fc.Arbitrary<EventBrief> = fc.oneof(
  fc.record({
    ...shared,
    kind: fc.constant('community' as const),
    subtype: fc.constantFrom(...SUBTYPES.community),
    income: fc.option(income, { nil: undefined }),
  }),
  fc.record({
    ...shared,
    kind: fc.constant('wedding' as const),
    subtype: fc.constantFrom(...SUBTYPES.wedding),
  }),
  fc.record({
    ...shared,
    kind: fc.constant('birthday' as const),
    subtype: fc.constantFrom(...SUBTYPES.birthday),
  }),
);

/**
 * Random task lists (1 to 30 tasks) whose dependencies form a DAG, in shuffled input order so a
 * dependency often comes after its dependent. Ids are `t0`, `t1`...; lead times run from 5 days
 * after the event to 120 days before it; no task has a `when`.
 */
export const dagArb: fc.Arbitrary<readonly TaskDef[]> = fc
  .array(
    fc.record({
      durationDays: fc.integer({ min: 1, max: 10 }),
      leadDays: fc.integer({ min: -5, max: 120 }),
      picks: fc.array(fc.nat(), { maxLength: 3 }),
    }),
    { minLength: 1, maxLength: 30 },
  )
  .map((rows) =>
    rows.map((row, i): TaskDef => ({
      id: `t${i}`,
      title: `Task ${i}`,
      categoryId: 'general',
      durationDays: row.durationDays,
      leadDays: row.leadDays,
      // Depend on earlier tasks only, so the graph cannot contain a cycle.
      dependsOn: [...new Set(i === 0 ? [] : row.picks.map((pick) => `t${pick % i}`))],
    })),
  )
  .chain((tasks) => fc.shuffledSubarray(tasks, { minLength: tasks.length }));
