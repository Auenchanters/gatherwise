/**
 * Contract tests for src/domain/break-even.ts.
 *
 * Does: pins income, costs and surplus against hand-computed paise, both break-even answers
 * (ticket price and attendance, rounded up), the cases where they are omitted, and the link to
 * the budget's overBy.
 * Never does: depend on the clock or the host locale; every random input is seeded.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildBudget, rescaleGuests } from '../../src/domain/budget.js';
import { breakEven, type Income } from '../../src/domain/break-even.js';
import { isMinor, toMinor } from '../../src/domain/money.js';
import { templateFor } from '../../src/domain/templates/index.js';
import { communityTemplate } from '../../src/domain/templates/community.js';
import { brief, briefArb } from '../support/fixtures.js';

const SEED = { seed: 20261020, numRuns: 300 };
const zeros: Income = {
  ticketPrice: 0,
  expectedPaidAttendance: 0,
  sponsors: 0,
  donations: 0,
  stallCount: 0,
  stallFee: 0,
};
const budgetOf = (major: number) =>
  buildBudget(brief('community', { budget: major }), communityTemplate);
const inr = (major: number) => toMinor(major, 'INR');

describe('breakEven with no income', () => {
  it('has zero income, a deficit equal to the costs and no break-even figures', () => {
    const result = breakEven(budgetOf(150_000));
    expect(result).toEqual({
      income: 0,
      costs: inr(150_000),
      surplus: inr(-150_000),
      balance: { kind: 'shortfall', amount: inr(150_000) },
    });
    expect('breakEvenTicketPrice' in result).toBe(false);
    expect('breakEvenAttendance' in result).toBe(false);
  });

  it('treats all-zero income the same way', () => {
    expect(breakEven(budgetOf(150_000), zeros)).toEqual(breakEven(budgetOf(150_000)));
  });
});

describe('breakEven with income', () => {
  it('shows an 80,000 shortfall for sponsors of 40,000 and 20 stalls at 1,500', () => {
    const result = breakEven(budgetOf(150_000), {
      ...zeros,
      sponsors: 40_000,
      stallCount: 20,
      stallFee: 1500,
    });
    expect(result.income).toBe(inr(70_000));
    expect(result.costs).toBe(inr(150_000));
    expect(result.surplus).toBe(inr(-80_000));
  });

  it('adds tickets, sponsors, donations and stall fees exactly', () => {
    const result = breakEven(budgetOf(150_000), {
      ticketPrice: 200,
      expectedPaidAttendance: 250,
      sponsors: 40_000,
      donations: 10_000,
      stallCount: 20,
      stallFee: 1500,
    });
    // 50,000 tickets + 40,000 sponsors + 10,000 donations + 30,000 stalls.
    expect(result.income).toBe(inr(130_000));
    expect(result.surplus).toBe(inr(-20_000));
  });

  it('answers both break-even questions with whole numbers when they divide evenly', () => {
    const result = breakEven(budgetOf(150_000), {
      ticketPrice: 200,
      expectedPaidAttendance: 250,
      sponsors: 40_000,
      donations: 10_000,
      stallCount: 20,
      stallFee: 1500,
    });
    // Other income is 80,000, so tickets must cover 70,000: 280 each for 250 people,
    // or 350 people at 200.
    expect(result.breakEvenTicketPrice).toBe(inr(280));
    expect(result.breakEvenAttendance).toBe(350);
  });

  it('rounds the break-even ticket price up to the next paisa', () => {
    // 7,000,000 paise over 300 attendees is 23,333.33 paise each.
    const result = breakEven(budgetOf(150_000), {
      ...zeros,
      expectedPaidAttendance: 300,
      sponsors: 80_000,
    });
    expect(result.breakEvenTicketPrice).toBe(23_334);
    expect(result.breakEvenAttendance).toBeUndefined();
    // A price rounded up really does break even; one paisa less does not.
    expect(300 * 23_334).toBeGreaterThanOrEqual(7_000_000);
    expect(300 * 23_333).toBeLessThan(7_000_000);
  });

  it('rounds the break-even attendance up to the next person', () => {
    // 7,000,000 paise at 30,000 paise a ticket is 233.33 people.
    const result = breakEven(budgetOf(150_000), { ...zeros, ticketPrice: 300, sponsors: 80_000 });
    expect(result.breakEvenAttendance).toBe(234);
    expect(result.breakEvenTicketPrice).toBeUndefined();
  });

  it('needs no tickets at all once other income covers the costs', () => {
    const result = breakEven(budgetOf(150_000), {
      ...zeros,
      ticketPrice: 100,
      expectedPaidAttendance: 50,
      sponsors: 200_000,
    });
    expect(result.surplus).toBe(inr(55_000));
    expect(result.balance).toEqual({ kind: 'surplus', amount: inr(55_000) });
    expect(result.breakEvenTicketPrice).toBe(0);
    expect(result.breakEvenAttendance).toBe(0);
  });

  it('omits the ticket price when nobody is expected to pay, and attendance when tickets are free', () => {
    const noAttendance = breakEven(budgetOf(150_000), { ...zeros, ticketPrice: 500 });
    expect(noAttendance.breakEvenAttendance).toBe(300);
    expect('breakEvenTicketPrice' in noAttendance).toBe(false);
    const freeEntry = breakEven(budgetOf(150_000), { ...zeros, expectedPaidAttendance: 100 });
    expect(freeEntry.breakEvenTicketPrice).toBe(inr(1500));
    expect('breakEvenAttendance' in freeEntry).toBe(false);
  });

  it('uses minor units for every currency without float noise', () => {
    const usd = buildBudget(
      brief('community', { budget: 1000, currency: 'USD' }),
      communityTemplate,
    );
    const result = breakEven(usd, {
      ...zeros,
      ticketPrice: 7,
      expectedPaidAttendance: 3,
      donations: 1,
    });
    expect(result.income).toBe(toMinor(22, 'USD'));
    expect(result.costs).toBe(toMinor(1000, 'USD'));
  });

  it('counts an over-budget rescale in the costs, so the surplus is the real gap', () => {
    const over = rescaleGuests(budgetOf(150_000), 400);
    const result = breakEven(over, { ...zeros, sponsors: 150_000 });
    expect(over.overBy).toBe(2_064_000);
    expect(result.costs).toBe(over.total + 2_064_000);
    expect(result.surplus).toBe(inr(150_000) - result.costs);
    expect(result.surplus).toBe(-2_064_000);
  });

  it('keeps income, costs and surplus consistent for any budget and any income', () => {
    const incomeArb = fc.record({
      ticketPrice: fc.integer({ min: 0, max: 100_000_000 }),
      expectedPaidAttendance: fc.integer({ min: 0, max: 5000 }),
      sponsors: fc.integer({ min: 0, max: 100_000_000 }),
      donations: fc.integer({ min: 0, max: 100_000_000 }),
      stallCount: fc.integer({ min: 0, max: 5000 }),
      stallFee: fc.integer({ min: 0, max: 100_000_000 }),
    });
    fc.assert(
      fc.property(briefArb, incomeArb, (b, income) => {
        const budget = buildBudget(b, templateFor(b.kind));
        const result = breakEven(budget, income);
        expect(isMinor(result.income)).toBe(true);
        expect(result.costs).toBe(budget.total + (budget.overBy ?? 0));
        expect(result.surplus).toBe(result.income - result.costs);
        // The worded balance is the surplus split into a side of zero and a non-negative amount.
        expect(result.balance.amount).toBe(Math.abs(result.surplus));
        expect(result.balance.kind).toBe(result.surplus < 0 ? 'shortfall' : 'surplus');
        const { ticketPrice, expectedPaidAttendance } = income;
        const tickets = toMinor(ticketPrice, b.currency) * expectedPaidAttendance;
        const other =
          toMinor(income.sponsors, b.currency) +
          toMinor(income.donations, b.currency) +
          toMinor(income.stallFee, b.currency) * income.stallCount;
        expect(result.income).toBe(tickets + other);
        if (expectedPaidAttendance > 0) {
          const price = result.breakEvenTicketPrice ?? Number.NaN;
          // The returned price covers the gap, and a paisa less does not (unless it is already 0).
          expect(price * expectedPaidAttendance + other).toBeGreaterThanOrEqual(result.costs);
          if (price > 0) {
            expect((price - 1) * expectedPaidAttendance + other).toBeLessThan(result.costs);
          }
        } else expect(result.breakEvenTicketPrice).toBeUndefined();
        if (ticketPrice > 0) {
          const people = result.breakEvenAttendance ?? Number.NaN;
          const price = toMinor(ticketPrice, b.currency);
          expect(Number.isInteger(people)).toBe(true);
          expect(people * price + other).toBeGreaterThanOrEqual(result.costs);
          if (people > 0) expect((people - 1) * price + other).toBeLessThan(result.costs);
        } else expect(result.breakEvenAttendance).toBeUndefined();
      }),
      SEED,
    );
  });
});
