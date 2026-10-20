/**
 * Contract tests for src/domain/budget.ts.
 *
 * Does: pins the reconciliation guarantee (lines plus contingency equal the total, to the paisa)
 * with properties over generated briefs and hints, the hand-computed numbers for the community
 * template, the weight-hint preconditions, the too-low sanity floor and guest-count rescaling.
 * Never does: depend on the clock or the host locale; every random input is seeded.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  buildBudget,
  CONTINGENCY_PERCENT,
  MIN_PER_GUEST_MAJOR,
  rescaleGuests,
  type Budget,
  type BudgetLine,
  type WeightHint,
} from '../../src/domain/budget';
import { allocate, formatMoney, isMinor, minor, toMinor, type Minor } from '../../src/domain/money';
import { templateFor } from '../../src/domain/templates';
import { communityTemplate } from '../../src/domain/templates/community';
import type { EventKind, EventTemplate } from '../../src/domain/templates/types';
import { LIMITS } from '../../src/shared/limits';
import { brief, briefArb } from '../support/fixtures';

const SEED = { seed: 20261020, numRuns: 300 };
const sum = (values: readonly Minor[]): number => values.reduce((acc, v) => acc + v, 0);
const linesSum = (b: Budget): number => sum(b.lines.map((l) => l.allocated));
const guestsArb = fc.integer({ min: LIMITS.brief.guestsMin, max: LIMITS.brief.guestsMax });

function lineOf(b: Budget, categoryId: string): BudgetLine {
  const found = b.lines.find((l) => l.categoryId === categoryId);
  if (!found) throw new Error(`no budget line for ${categoryId}`);
  return found;
}

const factorArb = fc.double({ min: LIMITS.ai.factorMin, max: LIMITS.ai.factorMax, noNaN: true });
/** Valid hints for a template: distinct known categories, factors inside the allowed band. */
const hintsFor = (kind: EventKind): fc.Arbitrary<WeightHint[]> =>
  fc.uniqueArray(
    fc.record({
      categoryId: fc.constantFrom(...templateFor(kind).categories.map((c) => c.id)),
      factor: factorArb,
    }),
    { selector: (hint) => hint.categoryId, maxLength: LIMITS.ai.weightHintsMax },
  );
const briefAndHints = briefArb.chain((b) => hintsFor(b.kind).map((hints) => ({ b, hints })));

const b250 = buildBudget(brief('community'), communityTemplate);
/** Community weights of 12 15 25 8 6 6 5 4 9 10 on 90% of 15,000,000 paise, all exact. */
const B250_LINES: Record<string, number> = {
  venue_permits: 1_620_000,
  stage_av: 2_025_000,
  food_beverage: 3_375_000,
  decor: 1_080_000,
  safety_first_aid: 810_000,
  sanitation_waste: 810_000,
  marketing_printing: 675_000,
  volunteer_care: 540_000,
  rentals: 1_215_000,
  activities_entertainment: 1_350_000,
};

describe('buildBudget', () => {
  it('splits 1,50,000 INR into a 10% contingency and the weighted community lines', () => {
    expect(b250.currency).toBe('INR');
    expect(b250.guests).toBe(250);
    expect(b250.total).toBe(15_000_000);
    expect(b250.contingency).toBe(1_500_000);
    expect(Object.fromEntries(b250.lines.map((l) => [l.categoryId, l.allocated]))).toEqual(
      B250_LINES,
    );
    expect(b250.perGuest).toBe(60_000);
    expect(b250.overBy).toBeUndefined();
    expect('overBy' in b250).toBe(false);
  });

  it('keeps the template category order, labels and scaling', () => {
    expect(b250.lines.map((l) => [l.categoryId, l.label, l.scales])).toEqual(
      communityTemplate.categories.map((c) => [c.id, c.label, c.scales]),
    );
  });

  it('holds back exactly CONTINGENCY_PERCENT of the total', () => {
    expect(CONTINGENCY_PERCENT).toBe(10);
    fc.assert(
      fc.property(briefArb, (b) => {
        const x = buildBudget(b, templateFor(b.kind));
        expect(x.contingency).toBe(
          allocate(x.total, [CONTINGENCY_PERCENT, 100 - CONTINGENCY_PERCENT])[0],
        );
      }),
      SEED,
    );
  });

  it('reconciles to the paisa for any brief and any valid hints', () => {
    fc.assert(
      fc.property(briefAndHints, ({ b, hints }) => {
        const x = buildBudget(b, templateFor(b.kind), hints);
        expect(x.total).toBe(toMinor(b.budget, b.currency));
        expect(linesSum(x) + x.contingency).toBe(x.total);
      }),
      SEED,
    );
  });

  it('reconciles with no hints too', () => {
    fc.assert(
      fc.property(briefArb, (b) => {
        const x = buildBudget(b, templateFor(b.kind));
        return linesSum(x) + x.contingency === x.total;
      }),
      SEED,
    );
  });

  it('only ever produces non-negative safe integers, in template order', () => {
    fc.assert(
      fc.property(briefAndHints, ({ b, hints }) => {
        const template = templateFor(b.kind);
        const x = buildBudget(b, template, hints);
        expect(x.lines.map((l) => l.categoryId)).toEqual(template.categories.map((c) => c.id));
        for (const value of [
          x.total,
          x.contingency,
          x.perGuest,
          ...x.lines.map((l) => l.allocated),
        ]) {
          expect(isMinor(value)).toBe(true);
          expect(value).toBeGreaterThanOrEqual(0);
        }
        expect(x.perGuest * x.guests).toBeLessThanOrEqual(x.total);
        expect(x.total).toBeLessThan((x.perGuest + 1) * x.guests);
      }),
      SEED,
    );
  });

  it('does not depend on the order of the hints', () => {
    const hints: WeightHint[] = [
      { categoryId: 'decor', factor: 1.5 },
      { categoryId: 'food_beverage', factor: 0.7 },
      { categoryId: 'rentals', factor: 1.9 },
    ];
    const forward = buildBudget(brief('community'), communityTemplate, hints);
    expect(buildBudget(brief('community'), communityTemplate, [...hints].reverse())).toEqual(
      forward,
    );
  });

  it('treats an empty hint list as no hints', () => {
    expect(buildBudget(brief('community'), communityTemplate, [])).toEqual(b250);
  });
});

describe('buildBudget weight hints', () => {
  it('multiplies a category weight by its factor and still reconciles', () => {
    const hinted = buildBudget(brief('community'), communityTemplate, [
      { categoryId: 'decor', factor: 2 },
    ]);
    // Weights now sum to 108: decor is 16 of 108 of 13,500,000 paise.
    expect(lineOf(hinted, 'decor').allocated).toBe(2_000_000);
    expect(lineOf(hinted, 'food_beverage').allocated).toBe(3_125_000);
    expect(hinted.total).toBe(b250.total);
    expect(hinted.contingency).toBe(b250.contingency);
    expect(linesSum(hinted) + hinted.contingency).toBe(hinted.total);
  });

  it('accepts factors exactly at the allowed limits', () => {
    const edge: WeightHint[] = [
      { categoryId: 'decor', factor: LIMITS.ai.factorMin },
      { categoryId: 'rentals', factor: LIMITS.ai.factorMax },
    ];
    expect(() => buildBudget(brief('community'), communityTemplate, edge)).not.toThrow();
  });

  it('does not mutate the hints it is given', () => {
    const hints = Object.freeze([Object.freeze({ categoryId: 'decor', factor: 1.2 })]);
    expect(() => buildBudget(brief('community'), communityTemplate, hints)).not.toThrow();
  });

  it('throws RangeError for a category the template does not have', () => {
    expect(() =>
      buildBudget(brief('community'), communityTemplate, [{ categoryId: 'fireworks', factor: 1 }]),
    ).toThrow(RangeError);
  });

  it('throws RangeError for a category that belongs to another template', () => {
    expect(() =>
      buildBudget(brief('wedding'), templateFor('wedding'), [{ categoryId: 'decor', factor: 1 }]),
    ).toThrow(RangeError);
  });

  it.each([0.49, 2.01, 0, -1, 3, Number.NaN, Number.POSITIVE_INFINITY])(
    'throws RangeError for factor %s, which the merge step must clamp first',
    (factor) => {
      expect(() =>
        buildBudget(brief('community'), communityTemplate, [{ categoryId: 'decor', factor }]),
      ).toThrow(RangeError);
    },
  );

  it('throws RangeError for two hints on one category', () => {
    expect(() =>
      buildBudget(brief('community'), communityTemplate, [
        { categoryId: 'decor', factor: 1.1 },
        { categoryId: 'decor', factor: 1.2 },
      ]),
    ).toThrow(RangeError);
  });
});

describe('too_low warnings', () => {
  it('flags the per-guest lines of 1,000 for 5,000 guests, and nothing else', () => {
    const tiny = buildBudget(brief('community', { budget: 1000, guests: 5000 }), communityTemplate);
    expect(tiny.lines.filter((l) => l.warning === 'too_low').map((l) => l.categoryId)).toEqual([
      'food_beverage',
      'sanitation_waste',
      'volunteer_care',
      'rentals',
    ]);
    expect(tiny.perGuest).toBe(20);
  });

  it('shows no NaN, negative or negative-zero amount anywhere for that budget', () => {
    const tiny = buildBudget(brief('community', { budget: 1000, guests: 5000 }), communityTemplate);
    for (const value of [
      tiny.total,
      tiny.contingency,
      tiny.perGuest,
      ...tiny.lines.map((l) => l.allocated),
    ]) {
      expect(Number.isFinite(value)).toBe(true);
      expect(Object.is(value, -0)).toBe(false);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(formatMoney(value, 'INR')).toMatch(/^₹\d[\d,]*\.\d{2}$/u);
    }
  });

  it('omits the warning key on lines that are fine', () => {
    expect(b250.lines.every((l) => !('warning' in l))).toBe(true);
  });

  it('flags a per-guest line one paisa under the floor and not exactly at it', () => {
    expect(MIN_PER_GUEST_MAJOR).toBe(1);
    // 40 INR: 4,000 paise, 3,600 spendable, food is exactly 900 paise = 9 guests x 1 INR.
    const atFloor = buildBudget(brief('community', { budget: 40, guests: 9 }), communityTemplate);
    expect(lineOf(atFloor, 'food_beverage')).toMatchObject({ allocated: 900 });
    expect(lineOf(atFloor, 'food_beverage').warning).toBeUndefined();
    // 39 INR: 3,510 spendable, food is 877 paise, under the 900 floor.
    const under = buildBudget(brief('community', { budget: 39, guests: 9 }), communityTemplate);
    expect(lineOf(under, 'food_beverage')).toMatchObject({ allocated: 877, warning: 'too_low' });
  });

  it('flags a fixed line only when it is exactly zero', () => {
    const template: EventTemplate = {
      ...communityTemplate,
      categories: [
        { id: 'main', label: 'Main', weight: 100, scales: 'fixed' },
        { id: 'sliver', label: 'Sliver', weight: 0.0001, scales: 'fixed' },
      ],
    };
    const x = buildBudget(brief('community', { budget: 1 }), template);
    expect(lineOf(x, 'sliver')).toMatchObject({ allocated: 0, warning: 'too_low' });
    expect(lineOf(x, 'main').warning).toBeUndefined();
    expect(linesSum(x) + x.contingency).toBe(x.total);
  });
});

describe('rescaleGuests', () => {
  const to400 = rescaleGuests(b250, 400);

  it('keeps fixed lines and grows per-guest lines in proportion', () => {
    expect(lineOf(to400, 'decor').allocated).toBe(1_080_000);
    expect(lineOf(to400, 'venue_permits').allocated).toBe(1_620_000);
    expect(lineOf(to400, 'food_beverage').allocated).toBe(5_400_000);
    expect(lineOf(to400, 'sanitation_waste').allocated).toBe(1_296_000);
    expect(lineOf(to400, 'volunteer_care').allocated).toBe(864_000);
    expect(lineOf(to400, 'rentals').allocated).toBe(1_944_000);
    expect(to400.guests).toBe(400);
    expect(to400.total).toBe(b250.total);
    expect(to400.perGuest).toBe(37_500);
  });

  it('spends the contingency first, then reports what is still over, cutting nothing', () => {
    // The per-guest lines grow by 3,564,000 paise; 1,500,000 of it comes out of contingency.
    expect(to400.contingency).toBe(0);
    expect(to400.overBy).toBe(2_064_000);
    expect(linesSum(to400) + to400.contingency).toBe(to400.total + 2_064_000);
  });

  it('returns freed money to contingency when guests drop, with no overBy', () => {
    const to125 = rescaleGuests(b250, 125);
    // The per-guest lines halve, freeing 2,970,000 paise.
    expect(to125.contingency).toBe(1_500_000 + 2_970_000);
    expect('overBy' in to125).toBe(false);
    expect(linesSum(to125) + to125.contingency).toBe(to125.total);
    expect(lineOf(to125, 'decor').allocated).toBe(1_080_000);
  });

  it('absorbs a small increase in contingency without going over', () => {
    const to260 = rescaleGuests(b250, 260);
    // 5,940,000 x 260 / 250 grows by 237,600 paise, well under the 1,500,000 contingency.
    expect(to260.contingency).toBe(1_500_000 - 237_600);
    expect('overBy' in to260).toBe(false);
    expect(linesSum(to260) + to260.contingency).toBe(to260.total);
  });

  it('rounds each per-guest line to the nearest paisa', () => {
    // 39 INR over 9 guests: food 877, sanitation 211, volunteers 140, rentals 316 paise.
    const small = buildBudget(brief('community', { budget: 39, guests: 9 }), communityTemplate);
    const to4 = rescaleGuests(small, 4);
    expect(lineOf(to4, 'food_beverage').allocated).toBe(390); // 389.78
    expect(lineOf(to4, 'sanitation_waste').allocated).toBe(94); // 93.78
    expect(lineOf(to4, 'volunteer_care').allocated).toBe(62); // 62.22
    expect(lineOf(to4, 'rentals').allocated).toBe(140); // 140.44
    expect(lineOf(to4, 'decor').allocated).toBe(lineOf(small, 'decor').allocated);
    expect(to4.contingency).toBe(3900 - 2652);
    expect(to4.perGuest).toBe(975);
  });

  it('is the identity on lines and contingency when the count does not change', () => {
    expect(rescaleGuests(b250, 250)).toEqual(b250);
  });

  it('comes back to the same budget after a round trip when nothing was lost to rounding', () => {
    expect(rescaleGuests(rescaleGuests(b250, 400), 250)).toEqual(b250);
  });

  it('recomputes warnings instead of carrying them over', () => {
    const handMade: Budget = {
      currency: 'INR',
      guests: 10,
      total: minor(10_000),
      contingency: minor(1_001),
      lines: [
        {
          categoryId: 'food',
          label: 'Food',
          allocated: minor(999),
          scales: 'per_guest',
          warning: 'too_low',
        },
        { categoryId: 'hall', label: 'Hall', allocated: minor(8000), scales: 'fixed' },
      ],
      perGuest: minor(1000),
    };
    // 999 x 3 / 10 = 299.7 rounds to 300 paise: exactly the floor for 3 guests, so the flag goes.
    expect(rescaleGuests(handMade, 3).lines[0]).toEqual({
      categoryId: 'food',
      label: 'Food',
      allocated: 300,
      scales: 'per_guest',
    });
    // 999 x 9 / 10 = 899.1 rounds to 899, one paisa under the floor for 9 guests, so it stays.
    expect(rescaleGuests(handMade, 9).lines[0]).toMatchObject({
      allocated: 899,
      warning: 'too_low',
    });
  });

  it('throws RangeError for a guest count the product cannot have', () => {
    for (const bad of [0, -3, 1.5, Number.NaN, LIMITS.brief.guestsMax + 1]) {
      expect(() => rescaleGuests(b250, bad)).toThrow(RangeError);
    }
    expect(() => rescaleGuests(b250, 1)).not.toThrow();
    expect(() => rescaleGuests(b250, LIMITS.brief.guestsMax)).not.toThrow();
  });

  it('never mutates its input and returns new objects', () => {
    const frozen = Object.freeze({
      ...b250,
      lines: Object.freeze(b250.lines.map((l) => Object.freeze({ ...l }))),
    });
    const snapshot = structuredClone(frozen);
    let next: Budget | undefined;
    expect(() => {
      next = rescaleGuests(frozen, 400);
    }).not.toThrow();
    expect(next).not.toBe(frozen);
    expect(next?.lines).not.toBe(frozen.lines);
    expect(frozen).toEqual(snapshot);
  });

  it('keeps the R29 invariant for any budget and any target guest count', () => {
    fc.assert(
      fc.property(briefAndHints, guestsArb, ({ b, hints }, target) => {
        const before = buildBudget(b, templateFor(b.kind), hints);
        const after = rescaleGuests(before, target);
        const over = after.overBy ?? 0;
        expect(linesSum(after) + after.contingency).toBe(before.total + over);
        expect(after.total).toBe(before.total);
        expect(after.currency).toBe(before.currency);
        expect(after.guests).toBe(target);
        expect(after.contingency).toBeGreaterThanOrEqual(0);
        expect(isMinor(after.contingency)).toBe(true);
        if ('overBy' in after) {
          expect(over).toBeGreaterThan(0);
          expect(after.contingency).toBe(0);
        }
        expect(after.perGuest).toBe(Math.floor(after.total / target));
      }),
      SEED,
    );
  });

  it('scales per-guest lines by the guest ratio to within half a paisa, and leaves fixed lines alone', () => {
    fc.assert(
      fc.property(briefArb, guestsArb, (b, target) => {
        const before = buildBudget(b, templateFor(b.kind));
        const after = rescaleGuests(before, target);
        before.lines.forEach((was, i) => {
          const now = after.lines[i];
          expect(now?.categoryId).toBe(was.categoryId);
          expect(isMinor(now?.allocated ?? Number.NaN)).toBe(true);
          if (was.scales === 'fixed') expect(now?.allocated).toBe(was.allocated);
          else {
            // |now - was x target / from| <= 1/2, multiplied through by from to stay in integers.
            expect(
              Math.abs((now?.allocated ?? 0) * before.guests - was.allocated * target),
            ).toBeLessThanOrEqual(before.guests / 2);
          }
        });
      }),
      SEED,
    );
  });

  it('only gives money back when guests drop and only draws on it when they rise', () => {
    fc.assert(
      fc.property(briefArb, guestsArb, (b, target) => {
        const before = buildBudget(b, templateFor(b.kind));
        const after = rescaleGuests(before, target);
        if (target <= before.guests) {
          expect('overBy' in after).toBe(false);
          expect(after.contingency).toBeGreaterThanOrEqual(before.contingency);
        } else {
          expect(after.contingency).toBeLessThanOrEqual(before.contingency);
        }
      }),
      SEED,
    );
  });

  it('keeps the invariant through several rescales in a row, even from an over-budget state', () => {
    fc.assert(
      fc.property(briefArb, fc.array(guestsArb, { minLength: 1, maxLength: 4 }), (b, targets) => {
        let current = buildBudget(b, templateFor(b.kind));
        for (const target of targets) {
          current = rescaleGuests(current, target);
          expect(linesSum(current) + current.contingency).toBe(
            current.total + (current.overBy ?? 0),
          );
          expect(current.contingency).toBeGreaterThanOrEqual(0);
          expect('overBy' in current ? current.contingency : 0).toBe(0);
        }
      }),
      SEED,
    );
  });

  it('shrinking after an overrun clears the overrun once the lines fit again', () => {
    const back = rescaleGuests(to400, 250);
    expect('overBy' in back).toBe(false);
    expect(back.contingency).toBe(1_500_000);
  });
});
