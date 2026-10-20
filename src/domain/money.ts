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
 * Converts major units to minor, rounding half away from zero. Inputs should be whole or
 * two-decimal amounts: a binary float such as 1.005 is not exactly a half, so it rounds by its
 * true stored value.
 * @throws RangeError if the amount is not finite or exceeds the safe-integer range.
 */
export function toMinor(major: number, currency: Currency): Minor {
  const scaled = Math.abs(major) * MINOR_PER_MAJOR[currency];
  return minor(Math.sign(major) * Math.round(scaled));
}

/**
 * Splits `total` across `weights` by largest remainder: each slot gets its floored share, then
 * the units left over go one each to the biggest fractional shares, lowest index first on ties.
 * The result has one entry per weight, sums to `total` and is 0 wherever the weight is 0.
 * @throws RangeError if `total` is negative, any weight is negative or not finite, or no weight
 * is positive. These are programming errors, not user errors.
 */
export function allocate(total: Minor, weights: readonly number[]): Minor[] {
  const weightSum = weights.reduce((acc, w) => acc + w, 0);
  const valid =
    total >= 0 && weights.every((w) => w >= 0) && weightSum > 0 && Number.isFinite(weightSum);
  if (!valid) throw new RangeError('allocate needs total >= 0 and finite, non-negative weights');

  let remaining: number = total;
  const slots = weights.map((weight, index) => {
    const share = (total * weight) / weightSum;
    // Capping at what is left keeps float error from ever handing out more than `total`.
    const whole = Math.min(Math.floor(share), remaining);
    remaining -= whole;
    return { index, weight, whole, fraction: share - whole };
  });
  const bonus = new Set(
    slots
      .filter((slot) => slot.weight > 0)
      .sort((a, b) => b.fraction - a.fraction || a.index - b.index)
      .slice(0, remaining)
      .map((slot) => slot.index),
  );
  return slots.map((slot) => minor(slot.whole + (bonus.has(slot.index) ? 1 : 0)));
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
