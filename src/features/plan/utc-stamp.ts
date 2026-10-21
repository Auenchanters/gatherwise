/**
 * The calendar export's one clock input: the instant as an iCalendar `DTSTAMP`.
 * Does: format a Date as UTC basic format, `YYYYMMDDTHHMMSSZ`, which is what `toIcs` requires.
 * Never does: read the clock (the caller passes `new Date()`), or use local-time parts.
 */

/** `now` as `YYYYMMDDTHHMMSSZ` in UTC: every field zero-padded, milliseconds dropped. */
export function utcStamp(now: Date): string {
  // `2026-10-21T13:45:07.123Z` without its dashes, colons and fraction.
  return now.toISOString().replace(/[-:]|\.\d{3}/gu, '');
}
