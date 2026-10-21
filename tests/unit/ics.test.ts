/**
 * Tests for src/domain/ics.ts, the RFC 5545 calendar export.
 *
 * Does: pins the brief's assertions (golden file, CRLF-injection title, 75-octet property, no
 * U+FFFD via a strict UTF-8 round trip), then an injection corpus run against every text field at
 * once, an unfold-and-unescape round-trip property, fold boundaries on ASCII, two-byte and
 * four-byte text, the date arithmetic of `DTEND`, free and busy marking, UID uniqueness, stamp
 * validation and input purity (deep-frozen arguments).
 * Never does: read the clock (`STAMP` is injected) or run an unseeded property.
 */
import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isoDate, type IsoDate } from '../../src/domain/dates.js';
import { toIcs } from '../../src/domain/ics.js';
import type { Schedule, ScheduledTask } from '../../src/domain/schedule.js';
import { brief } from '../support/fixtures.js';

const SEED = 20_261_021;
const STAMP = '20261021T120000Z';
const EVENT = isoDate('2026-12-12');
const CRLF = '\r\n';
/** Next to this file, whatever directory the tests run from. */
const GOLDEN = new URL('../fixtures/plan.ics', import.meta.url);

const encoder = new TextEncoder();
const utf8Len = (s: string): number => encoder.encode(s).length;
const day = (s: string): IsoDate => isoDate(s);

/** A scheduled task with sensible defaults; every field can be replaced. */
const task = (id: string, over: Partial<ScheduledTask> = {}): ScheduledTask => ({
  id,
  title: `Task ${id}`,
  categoryId: 'general',
  start: day('2026-10-21'),
  end: day('2026-10-22'),
  latestStart: day('2026-11-05'),
  latestEnd: day('2026-11-06'),
  slackDays: 15,
  status: 'on_track',
  dependsOn: [],
  ...over,
});

const scheduleOf = (...tasks: ScheduledTask[]): Schedule => ({
  tasks,
  infeasibleCount: 0,
  overdueCount: 0,
});

/** The hand-checked schedule behind tests/fixtures/plan.ics: escapes, a note, a done task, Hindi, a year boundary. */
const fixtureSchedule: Schedule = scheduleOf(
  task('venue_booking', {
    title: 'Book venue, stage; lights',
    categoryId: 'venue',
    latestStart: day('2026-10-31'),
    latestEnd: day('2026-11-06'),
    status: 'at_risk',
  }),
  task('public_space_permission', {
    title: 'Apply for public-space permission',
    categoryId: 'permits',
    latestStart: day('2026-11-12'),
    latestEnd: day('2026-11-27'),
    note: 'Check with your local authority; processing times vary by city, so apply early and keep a copy.',
  }),
  task('sound_licence', {
    title: 'Sound licence',
    categoryId: 'permits',
    latestStart: day('2026-11-20'),
    latestEnd: day('2026-11-28'),
    status: 'done',
  }),
  task('rangoli', {
    title: 'दिवाली रंगोली और सजावट की तैयारी 🎉',
    categoryId: 'decor',
    latestStart: day('2026-12-05'),
    latestEnd: day('2026-12-10'),
  }),
  task('thank_you_notes', {
    title: 'Send thank-you notes to sponsors',
    categoryId: 'followup',
    latestStart: day('2026-12-31'),
    latestEnd: day('2027-01-03'),
  }),
);

const render = (schedule: Schedule, over: Parameters<typeof brief<'community'>>[1] = {}): string =>
  toIcs(schedule, brief('community', over), EVENT, STAMP);

/** Content lines with every fold removed; the final CRLF is not a line. */
const unfold = (ics: string): string[] => ics.replaceAll(`${CRLF} `, '').split(CRLF).slice(0, -1);

/** The lines of each VEVENT, without its BEGIN and END. */
function vevents(lines: readonly string[]): string[][] {
  const blocks: string[][] = [];
  let open = false;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      open = true;
      blocks.push([]);
    } else if (line === 'END:VEVENT') {
      open = false;
    } else if (open) {
      blocks.at(-1)?.push(line);
    }
  }
  return blocks;
}

/** The value of the first line named `name`, or undefined. */
const valueOf = (lines: readonly string[], name: string): string | undefined =>
  lines.find((l) => l.startsWith(`${name}:`))?.slice(name.length + 1);

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`missing ${what}`);
  return value;
}

const eventsOf = (ics: string): string[][] => vevents(unfold(ics));
const eventBlock = (ics: string): string[] => must(eventsOf(ics)[0], 'event VEVENT');
const taskBlock = (ics: string, index = 0): string[] =>
  must(eventsOf(ics)[index + 1], `task VEVENT ${index}`);

/** Reverses RFC 5545 §3.3.11 text escaping. */
const unescapeText = (v: string): string =>
  v.replace(/\\([\s\S])/gu, (_m, c: string) => (c === 'n' ? '\n' : c));

/**
 * What escaping must keep of a string: every line break as one LF, a tab as a space, and nothing
 * that is not text (C0 and C1 controls, DEL, lone surrogates, U+2028 and U+2029). Judged by code
 * point range, not by the regex the implementation uses.
 */
const sanitized = (s: string): string =>
  Array.from(s.replace(/\r\n|\r/gu, '\n').replaceAll('\t', ' '))
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      const notText =
        code < 0x20 ||
        (code >= 0x7f && code <= 0x9f) ||
        (code >= 0xd800 && code <= 0xdfff) ||
        code === 0x2028 ||
        code === 0x2029;
      return ch === '\n' || !notText;
    })
    .join('');

/**
 * Fails unless the output survives a strict UTF-8 round trip unchanged. `TextEncoder` writes a lone
 * surrogate as U+FFFD, so any malformed text makes the decoded copy differ.
 */
const roundTripsAsUtf8 = (ics: string): boolean =>
  new TextDecoder('utf-8', { fatal: true }).decode(new TextEncoder().encode(ics)) === ics;

/** Fails when any CR or LF is left outside a CRLF pair. */
const hasBareBreak = (ics: string): boolean => /[\r\n]/u.test(ics.replaceAll(CRLF, ''));

/** Hindi (left to right, three octets a letter) and Arabic (right to left, two), each with emoji. */
const NON_LATIN: [script: string, text: string][] = [
  ['Hindi', 'दिवाली मेला 🎉'.repeat(10)],
  ['Arabic', 'حفلة الحي 🎉'.repeat(8)],
];

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

describe('toIcs: the brief assertions', () => {
  it('matches the golden file byte for byte', () => {
    expect(toIcs(fixtureSchedule, brief('community'), EVENT, STAMP)).toBe(
      readFileSync(GOLDEN, 'utf8'),
    );
  });

  it('keeps CRLF line endings in the golden file', () => {
    const golden = readFileSync(GOLDEN, 'utf8');
    expect(golden.endsWith(CRLF)).toBe(true);
    expect(hasBareBreak(golden)).toBe(false);
  });

  it('neutralizes a CRLF property injection in a title', () => {
    const out = render(scheduleOf(task('a', { title: 'Mela\r\nATTENDEE:mailto:x@y' })));
    expect(out).not.toMatch(/\r\nATTENDEE:/u);
  });

  it('never folds a line past 75 octets, for any title', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), (title) =>
        render(scheduleOf(task('a', { title })))
          .split(CRLF)
          .every((line) => utf8Len(line) <= 75),
      ),
      { seed: SEED, numRuns: 200 },
    );
  });

  it.each(NON_LATIN)('produces no U+FFFD from %s text and emoji', (_script, title) => {
    const out = render(scheduleOf(task('a', { title, note: title })), { name: title, city: title });
    expect(out).not.toContain(String.fromCodePoint(0xfffd));
    // A pair cut in half would leave a lone surrogate, which TextEncoder turns into U+FFFD.
    expect(roundTripsAsUtf8(out)).toBe(true);
    expect(out.split(CRLF).every((line) => utf8Len(line) <= 75)).toBe(true);
  });
});

describe('toIcs: calendar and event structure', () => {
  const lines = unfold(render(fixtureSchedule));

  it('opens with the calendar properties and closes the calendar', () => {
    expect(lines.slice(0, 6)).toEqual([
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Gatherwise//Event Planner//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:Maple Court Diwali Mela',
    ]);
    expect(lines.at(-1)).toBe('END:VCALENDAR');
  });

  it('escapes the calendar name', () => {
    const out = render(scheduleOf(), { name: 'Fun, food; fireworks' });
    expect(unfold(out)).toContain(String.raw`X-WR-CALNAME:Fun\, food\; fireworks`);
  });

  it('puts the event first with its own dates and description', () => {
    const block = eventBlock(render(fixtureSchedule));
    expect(block).toEqual([
      'UID:event-2026-12-12@gatherwise',
      `DTSTAMP:${STAMP}`,
      'DTSTART;VALUE=DATE:20261212',
      'DTEND;VALUE=DATE:20261213',
      'SUMMARY:Maple Court Diwali Mela',
      'DESCRIPTION:Starts 16:00 · 5 hours · Pune',
    ]);
  });

  it('marks task reminders free and leaves the event itself busy', () => {
    const [event, ...tasks] = eventsOf(render(fixtureSchedule));
    expect(tasks).toHaveLength(4);
    for (const block of tasks) expect(valueOf(block, 'TRANSP')).toBe('TRANSPARENT');
    // No TRANSP means OPAQUE, the RFC 5545 default: the event's day is genuinely busy.
    expect(event?.some((line) => line.startsWith('TRANSP'))).toBe(false);
  });

  it('leaves the city out when there is none, and says "1 hour" for one hour', () => {
    const block = eventBlock(render(scheduleOf(), { city: '', durationHours: 1 }));
    expect(valueOf(block, 'DESCRIPTION')).toBe('Starts 16:00 · 1 hour');
  });

  it('writes one all-day VEVENT per open task, in schedule order, on its latest start', () => {
    const blocks = eventsOf(render(fixtureSchedule)).slice(1);
    expect(blocks.map((b) => valueOf(b, 'UID'))).toEqual([
      'venue_booking-2026-12-12@gatherwise',
      'public_space_permission-2026-12-12@gatherwise',
      'rangoli-2026-12-12@gatherwise',
      'thank_you_notes-2026-12-12@gatherwise',
    ]);
    expect(blocks[0]).toEqual([
      'UID:venue_booking-2026-12-12@gatherwise',
      `DTSTAMP:${STAMP}`,
      'DTSTART;VALUE=DATE:20261031',
      'DTEND;VALUE=DATE:20261101',
      'TRANSP:TRANSPARENT',
      String.raw`SUMMARY:Book venue\, stage\; lights`,
      'DESCRIPTION:Start by 2026-10-31. Finish by 2026-11-06.',
      'CATEGORIES:venue',
    ]);
  });

  it('appends the note to the description, escaped', () => {
    const block = taskBlock(render(fixtureSchedule), 1);
    expect(valueOf(block, 'DESCRIPTION')).toBe(
      String.raw`Start by 2026-11-12. Finish by 2026-11-27. Check with your local authority\; processing times vary by city\, so apply early and keep a copy.`,
    );
  });

  it('treats an empty note as no note', () => {
    const block = taskBlock(render(scheduleOf(task('a', { note: '' }))));
    expect(valueOf(block, 'DESCRIPTION')).toBe('Start by 2026-11-05. Finish by 2026-11-06.');
  });

  it('labels a task Gemini added "AI · personalized" in its description, and only that one', () => {
    const out = render(
      scheduleOf(task('ai-task-1', { note: 'Ask, then confirm' }), task('book_venue')),
    );
    const [ai, own] = eventsOf(out).slice(1);
    expect(valueOf(must(ai, 'AI task'), 'DESCRIPTION')).toBe(
      String.raw`AI · personalized — Start by 2026-11-05. Finish by 2026-11-06. Ask\, then confirm`,
    );
    expect(valueOf(must(own, 'template task'), 'DESCRIPTION')).toBe(
      'Start by 2026-11-05. Finish by 2026-11-06.',
    );
    // The label is in the file's text, not a property of its own, so nothing new can be injected.
    expect(valueOf(must(ai, 'AI task'), 'SUMMARY')).toBe('Task ai-task-1');
  });

  it('does not take a title or id that merely contains "ai-task" for an AI task', () => {
    const out = render(scheduleOf(task('x-ai-task-1', { title: 'ai-task-1' })));
    expect(valueOf(taskBlock(out), 'DESCRIPTION')).toBe(
      'Start by 2026-11-05. Finish by 2026-11-06.',
    );
  });

  it('skips done tasks and keeps the rest', () => {
    const out = render(fixtureSchedule);
    expect(out).not.toContain('sound_licence');
    expect(eventsOf(out)).toHaveLength(1 + 4);
  });

  it('writes only the event for an empty or all-done schedule', () => {
    expect(eventsOf(render(scheduleOf()))).toHaveLength(1);
    expect(eventsOf(render(scheduleOf(task('a', { status: 'done' }))))).toHaveLength(1);
  });

  it('ends every line, the last included, with CRLF and uses no bare CR or LF', () => {
    const out = render(fixtureSchedule);
    expect(out.endsWith(CRLF)).toBe(true);
    expect(out.endsWith(`END:VCALENDAR${CRLF}`)).toBe(true);
    expect(hasBareBreak(out)).toBe(false);
  });
});

describe('toIcs: DTEND is the next day', () => {
  it.each([
    ['inside a month', '2026-11-05', '20261105', '20261106'],
    ['over a month boundary', '2026-11-30', '20261130', '20261201'],
    ['over a year boundary', '2026-12-31', '20261231', '20270101'],
    ['over a leap day', '2028-02-28', '20280228', '20280229'],
    ['after a leap day', '2028-02-29', '20280229', '20280301'],
  ])('task %s', (_name, latestStart, start, end) => {
    const block = taskBlock(render(scheduleOf(task('a', { latestStart: day(latestStart) }))));
    expect(valueOf(block, 'DTSTART;VALUE=DATE')).toBe(start);
    expect(valueOf(block, 'DTEND;VALUE=DATE')).toBe(end);
  });

  it.each([
    ['2026-12-31', '20261231', '20270101'],
    ['2026-01-31', '20260131', '20260201'],
  ])('event on %s', (date, start, end) => {
    const block = eventBlock(toIcs(scheduleOf(), brief('community'), day(date), STAMP));
    expect(valueOf(block, 'DTSTART;VALUE=DATE')).toBe(start);
    expect(valueOf(block, 'DTEND;VALUE=DATE')).toBe(end);
  });
});

describe('toIcs: UIDs', () => {
  const uids = (ics: string): string[] => eventsOf(ics).map((b) => must(valueOf(b, 'UID'), 'UID'));

  it('are unique within a plan and carry the event date', () => {
    const found = uids(render(fixtureSchedule));
    expect(new Set(found).size).toBe(found.length);
    for (const uid of found) {
      expect(uid).toContain('2026-12-12');
      expect(uid.endsWith('@gatherwise')).toBe(true);
    }
  });

  it('differ between two plans for different dates, so importing both overwrites nothing', () => {
    const first = uids(toIcs(fixtureSchedule, brief('community'), day('2026-12-12'), STAMP));
    const second = uids(toIcs(fixtureSchedule, brief('community'), day('2027-01-09'), STAMP));
    expect(first.filter((uid) => second.includes(uid))).toEqual([]);
  });

  it('are escaped like any other text', () => {
    const block = taskBlock(render(scheduleOf(task('x\r\nATTENDEE:y'))));
    expect(valueOf(block, 'UID')).toBe(String.raw`x\nATTENDEE:y-2026-12-12@gatherwise`);
  });
});

describe('toIcs: the stamp', () => {
  it('accepts a UTC basic-format timestamp', () => {
    expect(() => toIcs(scheduleOf(), brief('community'), EVENT, '20260101T000000Z')).not.toThrow();
    expect(() => toIcs(scheduleOf(), brief('community'), EVENT, '20261231T235959Z')).not.toThrow();
  });

  it.each([
    ['empty', ''],
    ['extended format', '2026-10-21T12:00:00Z'],
    ['no Z', '20261021T120000'],
    ['local offset', '20261021T120000+0530'],
    ['a date only', '20261021'],
    ['a leading space', ' 20261021T120000Z'],
    ['month 13', '20261321T120000Z'],
    ['day 32', '20261032T120000Z'],
    ['hour 24', '20261021T240000Z'],
    ['minute 60', '20261021T126000Z'],
    ['a trailing LF', '20261021T120000Z\n'],
    ['an injected property', '20261021T120000Z\r\nATTENDEE:mailto:x@y'],
  ])('rejects %s with a RangeError', (_name, stamp) => {
    expect(() => toIcs(scheduleOf(), brief('community'), EVENT, stamp)).toThrow(RangeError);
  });
});

/** Each case: a label, hostile input, and exactly what escaping must leave of it. */
const corpus: [label: string, payload: string, escaped: string][] = [
  ['a semicolon', 'a;b', String.raw`a\;b`],
  ['a comma', 'a,b', String.raw`a\,b`],
  ['a backslash', 'a\\b', String.raw`a\\b`],
  ['a backslash then n', 'a\\nb', String.raw`a\\nb`],
  ['an already escaped semicolon', 'a\\;b', String.raw`a\\\;b`],
  ['a backslash before a line feed', 'a\\\nb', String.raw`a\\\nb`],
  ['a lone CR', 'a\rb', String.raw`a\nb`],
  ['a lone LF', 'a\nb', String.raw`a\nb`],
  ['a CRLF', 'a\r\nb', String.raw`a\nb`],
  ['an LF then CR', 'a\n\rb', String.raw`a\n\nb`],
  ['a NUL', 'a\u0000b', 'ab'],
  ['a BEL', 'a\u0007b', 'ab'],
  ['an ESC', 'a\u001Bb', 'ab'],
  ['a DEL', 'a\u007Fb', 'ab'],
  ['a tab, which becomes a space', 'a\tb', 'a b'],
  ['a lone high surrogate', `a${String.fromCharCode(0xd83c)}b`, 'ab'],
  ['a lone low surrogate', `a${String.fromCharCode(0xdf89)}b`, 'ab'],
  ['an emoji, a valid pair, kept', 'a🎉b', 'a🎉b'],
  [
    'a pair broken by a NUL, which must not re-join',
    `a${String.fromCharCode(0xd83c)}\u0000${String.fromCharCode(0xdf89)}b`,
    'ab',
  ],
  ['a C1 control (CSI, U+009B)', `a${String.fromCodePoint(0x9b)}b`, 'ab'],
  ['NEL (U+0085)', `a${String.fromCodePoint(0x85)}b`, 'ab'],
  ['a line separator (U+2028)', `a${String.fromCodePoint(0x2028)}b`, 'ab'],
  ['a paragraph separator (U+2029)', `a${String.fromCodePoint(0x2029)}b`, 'ab'],
  [
    'an ATTENDEE smuggled by U+2028',
    `Mela${String.fromCodePoint(0x2028)}ATTENDEE:mailto:x@y`,
    'MelaATTENDEE:mailto:x@y',
  ],
  ['nothing but controls', '\u0000\u0007\u007F', ''],
  ['a NUL between CR and LF', 'a\r\u0000\nb', String.raw`a\n\nb`],
  [
    'an ATTENDEE smuggled by CRLF',
    'Mela\r\nATTENDEE:mailto:x@y',
    String.raw`Mela\nATTENDEE:mailto:x@y`,
  ],
  [
    'an ATTENDEE smuggled by LF',
    'Mela\nATTENDEE:mailto:x@y',
    String.raw`Mela\nATTENDEE:mailto:x@y`,
  ],
  [
    'an ATTENDEE smuggled by CR',
    'Mela\rATTENDEE:mailto:x@y',
    String.raw`Mela\nATTENDEE:mailto:x@y`,
  ],
  [
    'a VEVENT smuggled by newlines',
    'x\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nSUMMARY:pwned',
    String.raw`x\nEND:VEVENT\nBEGIN:VEVENT\nSUMMARY:pwned`,
  ],
  ['a fake fold', 'a\r\n ATTENDEE:x', String.raw`a\n ATTENDEE:x`],
];

describe('toIcs: injection corpus', () => {
  const ALLOWED =
    /^(?:BEGIN|END|VERSION|PRODID|CALSCALE|METHOD|X-WR-CALNAME|UID|DTSTAMP|DTSTART|DTEND|TRANSP|SUMMARY|DESCRIPTION|CATEGORIES)[:;]/u;
  const nameOf = (line: string): string => line.split(/[:;]/u, 1)[0] ?? '';

  /** The payload in every text field at once: title, note, category, event name and city. */
  const hostile = (payload: string): string =>
    render(scheduleOf(task('a', { title: payload, note: payload, categoryId: payload })), {
      name: payload,
      city: payload,
    });
  const baseline = unfold(hostile('plain'));

  it.each(corpus)('%s adds no property line', (_label, payload) => {
    const out = hostile(payload);
    const lines = unfold(out);
    expect(hasBareBreak(out)).toBe(false);
    expect(lines.every((l) => ALLOWED.test(l))).toBe(true);
    expect(lines.map(nameOf)).toEqual(baseline.map(nameOf));
    expect(vevents(lines)).toHaveLength(2);
  });

  it.each(corpus)('%s unfolds to the escaped value in every field', (_label, payload, escaped) => {
    const out = hostile(payload);
    const lines = unfold(out);
    const event = eventBlock(out);
    const first = taskBlock(out);
    expect(valueOf(lines, 'X-WR-CALNAME')).toBe(escaped);
    expect(valueOf(event, 'SUMMARY')).toBe(escaped);
    expect(valueOf(event, 'DESCRIPTION')).toBe(`Starts 16:00 · 5 hours · ${escaped}`);
    expect(valueOf(first, 'SUMMARY')).toBe(escaped);
    expect(valueOf(first, 'CATEGORIES')).toBe(escaped);
    expect(valueOf(first, 'DESCRIPTION')).toBe(
      `Start by 2026-11-05. Finish by 2026-11-06. ${escaped}`,
    );
  });
});

describe('toIcs: folding', () => {
  /** The physical lines of the task's SUMMARY property, folds included. */
  const summaryLines = (title: string): string[] => {
    const physical = render(scheduleOf(task('a', { title }))).split(CRLF);
    const from = physical.indexOf('UID:a-2026-12-12@gatherwise');
    const start = from + physical.slice(from).findIndex((l) => l.startsWith('SUMMARY:'));
    const rest = physical.slice(start + 1);
    return [
      must(physical[start], 'SUMMARY'),
      ...rest.slice(
        0,
        rest.findIndex((l) => !l.startsWith(' ')),
      ),
    ];
  };
  const joined = (lines: readonly string[]): string => lines.join(CRLF).replaceAll(`${CRLF} `, '');

  it('leaves a line of exactly 75 octets alone and folds one of 76', () => {
    expect(summaryLines('a'.repeat(67))).toEqual([`SUMMARY:${'a'.repeat(67)}`]);
    expect(summaryLines('a'.repeat(68))).toEqual([`SUMMARY:${'a'.repeat(67)}`, ' a']);
  });

  it('counts the continuation space toward 75', () => {
    const lines = summaryLines('a'.repeat(200));
    expect(lines.map(utf8Len)).toEqual([75, 75, 60]);
    expect(lines.slice(1).every((l) => l.startsWith(' '))).toBe(true);
    expect(joined(lines)).toBe(`SUMMARY:${'a'.repeat(200)}`);
  });

  it('keeps two-byte characters whole', () => {
    // "SUMMARY:" and 33 two-byte letters fill 74 octets; a 34th would make 76.
    const lines = summaryLines('é'.repeat(100));
    expect(lines.map(utf8Len)).toEqual([74, 75, 61]);
    expect(joined(lines)).toBe(`SUMMARY:${'é'.repeat(100)}`);
  });

  it('keeps four-byte characters whole', () => {
    // "SUMMARY:" and 16 emoji fill 72 octets; a 17th would make 76, so the fold lands before it.
    const lines = summaryLines('🎉'.repeat(40));
    expect(lines.map(utf8Len)).toEqual([72, 73, 25]);
    expect(joined(lines)).toBe(`SUMMARY:${'🎉'.repeat(40)}`);
  });

  it.each(NON_LATIN)(
    'folds %s text on code point boundaries and unfolds to the original',
    (_s, title) => {
      const lines = summaryLines(title);
      expect(lines.length).toBeGreaterThan(1);
      expect(lines.every((l) => utf8Len(l) <= 75)).toBe(true);
      expect(lines.every(roundTripsAsUtf8)).toBe(true);
      expect(joined(lines)).toBe(`SUMMARY:${title}`);
    },
  );

  it('folds long property lines of every kind, not just SUMMARY', () => {
    const long = 'word '.repeat(60);
    const out = render(scheduleOf(task('a', { title: long, note: long, categoryId: long })), {
      name: long,
      city: long,
    });
    expect(out.split(CRLF).every((l) => utf8Len(l) <= 75)).toBe(true);
    expect(unfold(out).some((l) => utf8Len(l) > 75)).toBe(true);
  });
});

describe('toIcs: unfolding and unescaping give back the sanitized input (property)', () => {
  const text = fc.oneof(
    fc.string({ maxLength: 300 }),
    fc.string({ unit: 'grapheme', maxLength: 200 }),
    fc.string({ unit: 'binary', maxLength: 150 }),
  );
  const BASE_LINES = unfold(render(scheduleOf(task('a'))));

  it('holds for title, note, category, event name and city alike', () => {
    fc.assert(
      fc.property(
        fc.record({ title: text, note: text, categoryId: text, name: text, city: text }),
        ({ title, note, categoryId, name, city }) => {
          const out = render(scheduleOf(task('a', { title, note, categoryId })), { name, city });
          const lines = unfold(out);
          const first = taskBlock(out);
          return (
            out.split(CRLF).every((l) => utf8Len(l) <= 75) &&
            !hasBareBreak(out) &&
            roundTripsAsUtf8(out) &&
            lines.length === BASE_LINES.length &&
            unescapeText(must(valueOf(first, 'SUMMARY'), 'SUMMARY')) === sanitized(title) &&
            unescapeText(must(valueOf(first, 'CATEGORIES'), 'CATEGORIES')) ===
              sanitized(categoryId) &&
            unescapeText(must(valueOf(lines, 'X-WR-CALNAME'), 'calname')) === sanitized(name) &&
            unescapeText(must(valueOf(eventBlock(out), 'SUMMARY'), 'event')) === sanitized(name)
          );
        },
      ),
      { seed: SEED, numRuns: 300 },
    );
  });
});

describe('toIcs: purity', () => {
  it('does not mutate its inputs and is deterministic', () => {
    const schedule = deepFreeze(
      scheduleOf(task('a', { title: 'x;y', note: 'n' }), task('b', { status: 'done' })),
    );
    const b = deepFreeze(brief('community'));
    const once = toIcs(schedule, b, EVENT, STAMP);
    expect(toIcs(schedule, b, EVENT, STAMP)).toBe(once);
  });
});
