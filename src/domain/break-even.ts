/**
 * Break-even for a community event: what the budget costs against what it brings in.
 * Does: turns the organizer's income estimates into minor units, finds the surplus or shortfall,
 * and works out the ticket price or the attendance that closes the gap, rounded up so the answer
 * always covers the costs.
 * Never does: use floats for money (everything is integer minor units, and the divisions are
 * exact), call a shortfall zero, or guess an attendance or price the organizer did not give.
 */
import type { EventBrief } from '../shared/schema';
import type { Budget } from './budget';
import { minor, toMinor, type Minor } from './money';

/** Expected income in major units, as the brief states it (community events only). */
export type Income = NonNullable<Extract<EventBrief, { kind: 'community' }>['income']>;

/** The money picture of an event. */
export interface BreakEven {
  /** Tickets, sponsors, donations and stall fees together. */
  readonly income: Minor;
  /** Every line plus contingency; the total plus any `overBy`. */
  readonly costs: Minor;
  /** Income minus costs. Negative is a shortfall. */
  readonly surplus: Minor;
  /** The cheapest ticket that breaks even at the expected attendance. Only if attendance > 0. */
  readonly breakEvenTicketPrice?: Minor;
  /** The fewest paying guests that break even at the ticket price. Only if the price > 0. */
  readonly breakEvenAttendance?: number;
}

const NO_INCOME: Income = {
  ticketPrice: 0,
  expectedPaidAttendance: 0,
  sponsors: 0,
  donations: 0,
  stallCount: 0,
  stallFee: 0,
};

/** Rounds `n / d` up for whole `n >= 0` and `d >= 1`, exactly (BigInt, so no float rounding). */
const ceilDiv = (n: number, d: number): number => Number((BigInt(n) + BigInt(d) - 1n) / BigInt(d));

/**
 * Compares the budget's costs with the expected income. With no income, income is 0 and neither
 * break-even figure is given. The costs count `overBy`, so an over-budget rescale shows up as a
 * bigger shortfall. Prices and fees are exact integers in major units, so every product below
 * stays well inside the safe-integer range.
 */
export function breakEven(budget: Budget, income: Income = NO_INCOME): BreakEven {
  const major = (amount: number): Minor => toMinor(amount, budget.currency);
  const { ticketPrice, expectedPaidAttendance } = income;
  const otherIncome = minor(
    major(income.sponsors) + major(income.donations) + major(income.stallFee) * income.stallCount,
  );
  const ticketIncome = minor(major(ticketPrice) * expectedPaidAttendance);
  const costs = minor(
    budget.lines.reduce<number>((acc, line) => acc + line.allocated, budget.contingency),
  );
  const totalIncome = minor(ticketIncome + otherIncome);
  // What tickets alone must raise; 0 once the other income already covers the costs.
  const ticketGap = Math.max(0, costs - otherIncome);
  return {
    income: totalIncome,
    costs,
    surplus: minor(totalIncome - costs),
    ...(expectedPaidAttendance > 0
      ? { breakEvenTicketPrice: minor(ceilDiv(ticketGap, expectedPaidAttendance)) }
      : {}),
    ...(ticketPrice > 0 ? { breakEvenAttendance: ceilDiv(ticketGap, major(ticketPrice)) } : {}),
  };
}
