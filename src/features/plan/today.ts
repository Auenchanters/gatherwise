/**
 * The client's one read of today's date: the calendar date where the user is. (The calendar
 * download also reads the clock, once, for its DTSTAMP; that is a moment, not a date.)
 * Does: builds `YYYY-MM-DD` from the local date parts, so an organizer in India at 01:00 is already
 * planning from the new day.
 * Never does: use UTC parts (that would lag or lead the user's own calendar by up to a day).
 */
import { isoDate, type IsoDate } from '../../domain/dates.js';

const pad = (n: number, width: number): string => String(n).padStart(width, '0');

/** Today's local date. `now` is injectable for tests; it defaults to the current instant. */
export function todayIso(now: Date = new Date()): IsoDate {
  return isoDate(
    `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1, 2)}-${pad(now.getDate(), 2)}`,
  );
}
