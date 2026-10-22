/**
 * The calendar export: turns a schedule into an iCalendar file (RFC 5545) that Google, Apple and
 * Outlook calendars import.
 * Does: writes one all-day event for the event itself, then one for each task that is not done, on
 * the task's latest start. Every text value is escaped (backslash, semicolon, comma, line breaks as
 * `\n`), a tab becomes a space, and every other control character, line separator, lone surrogate
 * and bidi control is dropped, so no title, note or name can end its line and start a property or
 * an event of its own, or read in a calendar differently from how it runs. Lines over 75 octets are folded between code points, so a UTF-8 sequence or a
 * surrogate pair is never cut in half. Task events are marked free (`TRANSP:TRANSPARENT`) so
 * reminders do not block the user's days. A task Gemini added (see `isAiTask`) says
 * "AI · personalized" at the start of its description, so the label travels with the text into
 * the user's calendar.
 * Never does: read the clock (the `DTSTAMP` is a parameter); emit unescaped user or model text;
 * modify its inputs.
 */
import type { EventBrief } from '../shared/schema.js';
import { addDays, type IsoDate } from './dates.js';
import { AI_LABEL, isAiTask } from './merge.js';
import type { Schedule } from './schedule.js';

const CRLF = '\r\n';
const MAX_OCTETS = 75;
/** UTC basic format, `YYYYMMDDTHHMMSSZ`, with month, day, hour, minute and second in range. */
const STAMP_SHAPE =
  /^\d{4}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3])[0-5]\d[0-5]\dZ$/u;

const encoder = new TextEncoder();
const octets = (s: string): number => encoder.encode(s).length;

/** A text property: its name and its raw, not yet escaped, value. */
type TextProperty = readonly [name: string, value: string];

/**
 * Escapes a TEXT value (RFC 5545 section 3.3.11): `\`, `;` and `,` get a backslash and CRLF, LF or
 * CR become `\n`, all in one pass, so nothing is escaped twice. Then a tab becomes a space and
 * everything that is not text is dropped: C0 and C1 controls (NEL included), DEL, lone surrogates,
 * the line and paragraph separators U+2028 and U+2029, and the bidi marks, embeddings, overrides
 * and isolates (U+200E, U+200F, U+202A to U+202E, U+2066 to U+2069). A lone surrogate would
 * otherwise reach the file as U+FFFD, the separators end a line in some parsers, and a bidi
 * override makes a title read differently from how it runs ("gnp.exe").
 */
function escapeText(raw: string): string {
  return raw
    .replace(/\r\n|[\\;,\r\n]/gu, (match) =>
      match === '\\' || match === ';' || match === ',' ? `\\${match}` : '\\n',
    )
    .replaceAll('\t', ' ')
    .replace(/[\p{Cc}\p{Cs}\u0085\u2028\u2029\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu, '');
}

/**
 * A short, stable fingerprint of `text`: 32-bit FNV-1a over its UTF-16 code units, as 8 hex
 * digits. Pure and deterministic, for telling plans apart in a UID; not a secret or a checksum.
 */
function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Folds a content line (RFC 5545 section 3.1): every physical line is at most 75 octets, and each
 * continuation starts with one space that counts toward its 75. Breaks fall between code points.
 */
function fold(line: string): string {
  if (octets(line) <= MAX_OCTETS) return line;
  const physical: string[] = [];
  let current = '';
  let used = 0;
  for (const ch of line) {
    const size = octets(ch);
    if (used + size > MAX_OCTETS) {
      physical.push(current);
      current = ' ';
      used = 1;
    }
    current += ch;
    used += size;
  }
  physical.push(current);
  return physical.join(CRLF);
}

const compact = (date: IsoDate): string => date.replaceAll('-', '');

/** What a calendar app shows first in a task Gemini added: AI text is always labelled. */
const AI_PREFIX = `${AI_LABEL} — `;

/** One all-day VEVENT on `day`. The UID is `uidStem` (escaped) plus `@gatherwise`. */
function allDayEvent(
  uidStem: string,
  stamp: string,
  day: IsoDate,
  properties: readonly TextProperty[],
): string[] {
  return [
    'BEGIN:VEVENT',
    `UID:${escapeText(uidStem)}@gatherwise`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${compact(day)}`,
    `DTEND;VALUE=DATE:${compact(addDays(day, 1))}`,
    ...properties.map(([name, value]) => `${name}:${escapeText(value)}`),
    'END:VEVENT',
  ];
}

/**
 * Renders `schedule` as an iCalendar file, every line ended with CRLF.
 *
 * The event itself comes first, on `eventDate`, followed by one all-day event per task that is not
 * `done`, in schedule order, on its `latestStart`. UIDs end in `-<eventDate>-<plan>@gatherwise`,
 * where `<plan>` is a fingerprint of the event's kind and name: two plans that differ in date,
 * kind or name never share a UID, so importing both overwrites nothing, while importing the same
 * plan again updates its events instead of doubling them. `schedule` and `brief` are not modified.
 *
 * @param stamp The `DTSTAMP` of every event as UTC basic format (`YYYYMMDDTHHMMSSZ`). The caller
 * reads the clock; this module never does.
 * @throws RangeError if `stamp` is not in that format, which is a programming error, or if a date
 * is 9999-12-31, whose next day (`DTEND`) is outside the years 0000 to 9999 (`addDays`).
 */
export function toIcs(
  schedule: Schedule,
  brief: EventBrief,
  eventDate: IsoDate,
  stamp: string,
): string {
  if (!STAMP_SHAPE.test(stamp)) {
    throw new RangeError(`DTSTAMP must be YYYYMMDDTHHMMSSZ in UTC: ${JSON.stringify(stamp)}`);
  }
  const hours = brief.durationHours === 1 ? 'hour' : 'hours';
  const plan = `${eventDate}-${fingerprint(`${brief.kind}:${brief.name}`)}`;
  const where = brief.city === '' ? '' : ` · ${brief.city}`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Gatherwise//Event Planner//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(brief.name)}`,
    ...allDayEvent(`event-${plan}`, stamp, eventDate, [
      ['SUMMARY', brief.name],
      ['DESCRIPTION', `Starts ${brief.startTime} · ${brief.durationHours} ${hours}${where}`],
    ]),
    ...schedule.tasks
      .filter((task) => task.status !== 'done')
      .flatMap((task) =>
        allDayEvent(`${task.id}-${plan}`, stamp, task.latestStart, [
          // A reminder, not an appointment. The event's own day stays busy (the default, OPAQUE).
          ['TRANSP', 'TRANSPARENT'],
          ['SUMMARY', task.title],
          [
            'DESCRIPTION',
            `${isAiTask(task.id) ? AI_PREFIX : ''}Start by ${task.latestStart}. Finish by ${task.latestEnd}.${task.note ? ` ${task.note}` : ''}`,
          ],
          ['CATEGORIES', task.categoryId],
        ]),
      ),
    'END:VCALENDAR',
  ];
  return lines.map((line) => fold(line) + CRLF).join('');
}
