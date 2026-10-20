/**
 * Calendar dates for the planning engine: `YYYY-MM-DD` strings with no time of day and no zone.
 * Does: validates strictly, and runs every calculation at UTC midnight, so daylight saving and the
 * machine's time zone can never move a date. The fixed-width, most-significant-first format means
 * two `IsoDate` values compare correctly with plain `<` and `>`.
 * Never does: read the clock (callers pass `today` in) or use local-time Date methods.
 */
import { err, ok, type Result } from '../shared/result.js';

/** A real calendar date written `YYYY-MM-DD`, years 0000 to 9999. Mint it with `parseIsoDate`. */
export type IsoDate = string & { readonly __brand: 'IsoDate' };

const SHAPE = /^\d{4}-\d{2}-\d{2}$/u;
const MS_PER_DAY = 86_400_000;

/** UTC-midnight timestamp of a calendar date. Impossible dates roll over (Feb 30 becomes Mar 2). */
function utcMidnight(year: number, month: number, day: number): number {
  // Date.UTC would read years 0 to 99 as 1900 to 1999, so set the full year explicitly.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getTime();
}

/** UTC-midnight timestamp of a string that already matches SHAPE. */
const timeOf = (iso: string): number =>
  utcMidnight(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), Number(iso.slice(8, 10)));

/** The `YYYY-MM-DD` of a timestamp. Years outside 0000 to 9999 come out in a form SHAPE rejects. */
const isoOf = (time: number): string => new Date(time).toISOString().slice(0, 10);

/** A date is real when it survives a round trip through the calendar unchanged. */
function isIsoDate(s: string): s is IsoDate {
  return SHAPE.test(s) && isoOf(timeOf(s)) === s;
}

/**
 * Parses user or stored input. `'format'` means it is not `YYYY-MM-DD` at all; `'invalid'` means
 * it looks right but is not a calendar date, such as 2026-02-30 or 2026-13-01.
 */
export function parseIsoDate(s: string): Result<IsoDate, 'format' | 'invalid'> {
  if (!SHAPE.test(s)) return err('format');
  return isIsoDate(s) ? ok(s) : err('invalid');
}

/**
 * Mints an `IsoDate` from a literal the caller knows is good (fixtures, constants).
 * @throws RangeError if `s` is not a real calendar date. Use `parseIsoDate` for untrusted input.
 */
export function isoDate(s: string): IsoDate {
  if (!isIsoDate(s)) throw new RangeError(`Not a calendar date written YYYY-MM-DD: ${s}`);
  return s;
}

/**
 * The date `n` days after `d` (before it when `n` is negative).
 * @throws RangeError if `n` is not a whole number or the result leaves years 0000 to 9999.
 */
export function addDays(d: IsoDate, n: number): IsoDate {
  if (!Number.isInteger(n)) throw new RangeError(`Days must be a whole number: ${n}`);
  const result = isoOf(timeOf(d) + n * MS_PER_DAY);
  if (!isIsoDate(result)) throw new RangeError(`${d} plus ${n} days is outside years 0000-9999`);
  return result;
}

/** Whole days from `a` to `b`: positive when `b` is later, negative when earlier. */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  return (timeOf(b) - timeOf(a)) / MS_PER_DAY;
}

// Rendering formats dozens of dates and building an Intl formatter is the costly part, so keep one per locale.
const formatters = new Map<string, Intl.DateTimeFormat>();

/**
 * Formats a date in the given locale, e.g. `5 Dec 2026` for `en-IN`. Fixed to UTC so the machine's
 * zone cannot shift the day.
 * @throws RangeError if `locale` is not a valid BCP 47 tag.
 */
export function formatDate(d: IsoDate, locale: string): string {
  let formatter = formatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' });
    formatters.set(locale, formatter);
  }
  return formatter.format(timeOf(d));
}
