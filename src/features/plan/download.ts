/**
 * The calendar download's name and contents.
 * Does: build an ASCII-only file name from the event name (`gatherwise-{slug}-{date}.ics`, with
 * `plan` when no ASCII letters or digits are left, as for a Hindi or emoji-only name) and wrap the
 * iCalendar text in a Blob of type `text/calendar;charset=utf-8`.
 * Never does: touch the DOM (the Timeline clicks the link), read the clock, or build the calendar
 * itself (`toIcs` does, and escapes every value).
 */
import type { IsoDate } from '../../domain/dates.js';

/** Longest slug kept, so a long event name still makes a sensible file name. */
const SLUG_MAX = 50;

/**
 * Lower-case ASCII letters and digits joined by single hyphens. Accents fold to their letters (NFKD
 * then dropping the marks), and so does the sharp s, the one common letter NFKD leaves whole.
 */
function slugOf(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replaceAll('ß', 'ss')
    .replace(/[^a-z0-9]+/gu, '-')
    .slice(0, SLUG_MAX)
    .replace(/^-+|-+$/gu, '');
}

/** `gatherwise-{slug}-{eventDate}.ics`, e.g. `gatherwise-green-park-diwali-mela-2026-12-20.ics`. */
export function icsFilename(name: string, eventDate: IsoDate): string {
  return `gatherwise-${slugOf(name) || 'plan'}-${eventDate}.ics`;
}

/** The calendar text as a downloadable file. */
export function icsBlob(text: string): Blob {
  return new Blob([text], { type: 'text/calendar;charset=utf-8' });
}
