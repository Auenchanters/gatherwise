/**
 * Money for the planning engine: integer minor units (paise, cents) only, never floats.
 * Does: brands safe integers as `Minor`, converts major units to minor, splits a total across
 * weights without losing or inventing a unit, and formats for display.
 * Never does: carry fractions between calls, read the clock, or touch the host locale
 * (every currency has a fixed formatting locale).
 */
import type { Currency } from '../shared/schema';

/** A safe integer count of minor units. May be negative (a deficit is real money). */
export type Minor = number & { readonly __brand: 'Minor' };

/** True for safe integers other than negative zero; the only way a number becomes a `Minor`. */
export function isMinor(n: number): n is Minor {
  return Number.isSafeInteger(n) && !Object.is(n, -0);
}

/**
 * Mints a `Minor`, turning `-0` into `0`.
 * @throws RangeError if `n` is not a safe integer. That is a programming error, not user input.
 */
export function minor(n: number): Minor {
  const value = n === 0 ? 0 : n;
  if (!isMinor(value)) throw new RangeError(`Not a safe integer of minor units: ${value}`);
  return value;
}

/** Minor units in one major unit. A zero-decimal currency would be a one-line change here. */
export const MINOR_PER_MAJOR: Readonly<Record<Currency, number>> = {
  INR: 100,
  USD: 100,
  EUR: 100,
  GBP: 100,
  AED: 100,
  SGD: 100,
  AUD: 100,
  CAD: 100,
};

/**
 * Converts major units to minor, rounding half away from zero. The scaled amount is first
 * rounded to 15 significant digits, which absorbs binary float noise: 1.005 gives 101 and 19.99
 * gives 1999. Amounts above about 1e13 major units are beyond float precision for cents anyway.
 * @throws RangeError if the amount is not finite or exceeds the safe-integer range.
 */
export function toMinor(major: number, currency: Currency): Minor {
  const scaled = Number((Math.abs(major) * MINOR_PER_MAJOR[currency]).toPrecision(15));
  return minor(Math.sign(major) * Math.round(scaled));
}

/** Weights are compared in steps of 1e-6, so the split is exact integer math. */
const WEIGHT_STEPS_PER_UNIT = 1_000_000;

/** Orders slots by larger remainder first, then by lower index, which is the tie rule. */
function byRemainderThenIndex(
  a: { index: number; remainder: bigint },
  b: { index: number; remainder: bigint },
): number {
  if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1;
  return a.index - b.index;
}

/**
 * Splits `total` across `weights` by largest remainder: each slot gets its floored share, then
 * the units left over go one each to the biggest remainders, lowest index first on ties.
 * The result has one entry per weight, sums to `total` and is 0 wherever the weight is 0.
 *
 * Each weight is first rounded to a whole number of 1e-6 steps, and the shares are then computed
 * in BigInt. So equal ratios are exact ties on every platform (3 : 1 is the same as 0.3 : 0.1),
 * with no epsilon; the price is that weights closer than 1e-6 are equal, and a weight under
 * 5e-7 counts as zero.
 * @throws RangeError if `total` is negative, any weight is negative or not finite, or no weight
 * reaches 1e-6 after rounding. These are programming errors, not user errors.
 */
export function allocate(total: Minor, weights: readonly number[]): Minor[] {
  const steps = weights.map((w) => Math.round(w * WEIGHT_STEPS_PER_UNIT));
  const valid =
    total >= 0 &&
    weights.every((w) => w >= 0 && Number.isFinite(w * WEIGHT_STEPS_PER_UNIT)) &&
    steps.some((n) => n > 0);
  if (!valid) throw new RangeError('allocate needs total >= 0 and finite, non-negative weights');

  const stepSum = steps.reduce((acc, n) => acc + BigInt(n), 0n);
  const slots = steps.map((n, index) => {
    const scaled = BigInt(total) * BigInt(n);
    return { index, whole: scaled / stepSum, remainder: scaled % stepSum };
  });
  // Every remainder is below stepSum and they add up to leftover * stepSum, so the leftover units
  // go only to slots with a non-zero remainder, never to a zero weight.
  const leftover = Number(BigInt(total) - slots.reduce((acc, slot) => acc + slot.whole, 0n));
  const bonus = new Set(
    [...slots]
      .sort(byRemainderThenIndex)
      .slice(0, leftover)
      .map((slot) => slot.index),
  );
  return slots.map((slot) => minor(Number(slot.whole) + (bonus.has(slot.index) ? 1 : 0)));
}

/** The locale each currency is shown in, so the same amount always reads the same. */
const FORMAT_LOCALE: Readonly<Record<Currency, string>> = {
  INR: 'en-IN',
  USD: 'en-US',
  EUR: 'en-IE',
  GBP: 'en-GB',
  AED: 'en-AE',
  SGD: 'en-SG',
  AUD: 'en-AU',
  CAD: 'en-CA',
};

// Formatting runs on every render and building an Intl formatter is the costly part, so keep one each.
const formatters = new Map<Currency, Intl.NumberFormat>();

function formatterFor(currency: Currency): Intl.NumberFormat {
  const cached = formatters.get(currency);
  if (cached) return cached;
  const created = new Intl.NumberFormat(FORMAT_LOCALE[currency], { style: 'currency', currency });
  formatters.set(currency, created);
  return created;
}

/** Formats minor units as currency text, e.g. `₹1,50,000.00`; negatives get a leading minus. */
export function formatMoney(m: Minor, currency: Currency): string {
  return formatterFor(currency).format(m / MINOR_PER_MAJOR[currency]);
}
