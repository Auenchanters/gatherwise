/**
 * Tests for src/features/plan/download.ts, which names the calendar file and wraps its text.
 *
 * Does: pins the filename format `gatherwise-{ascii-slug}-{date}.ics`, that the slug is ASCII only
 * (accents fold to their letters; Hindi, Arabic, emoji-only and blank names fall back to `plan`),
 * that punctuation and spacing collapse to single hyphens with none at the ends, that a long name
 * is cut without leaving a trailing hyphen, and the Blob's type and exact content.
 * Never does: touch the DOM; the click that starts the download is tested through the Timeline.
 */
import { describe, expect, it } from 'vitest';
import { isoDate } from '../../src/domain/dates.js';
import { icsBlob, icsFilename } from '../../src/features/plan/download.js';

const date = isoDate('2026-12-20');

describe('icsFilename', () => {
  it('slugifies an ASCII name', () => {
    expect(icsFilename('Green Park Diwali Mela', date)).toBe(
      'gatherwise-green-park-diwali-mela-2026-12-20.ics',
    );
  });

  it('collapses punctuation and spaces, and trims hyphens at the ends', () => {
    expect(icsFilename("  --Aarav's 8th!!  space   adventure--  ", date)).toBe(
      'gatherwise-aarav-s-8th-space-adventure-2026-12-20.ics',
    );
  });

  it('folds accents to their base letters', () => {
    expect(icsFilename('Café Fête Île', date)).toBe('gatherwise-cafe-fete-ile-2026-12-20.ics');
  });

  it.each([
    ['Hindi', 'अनुपमा का जन्मदिन'],
    ['Arabic', 'حفلة عيد ميلاد'],
    ['emoji only', '🎉🎉'],
    ['blank', '   '],
    ['punctuation only', '!!! ???'],
  ])('falls back to "plan" for a %s name', (_label, name) => {
    expect(icsFilename(name, date)).toBe('gatherwise-plan-2026-12-20.ics');
  });

  it('keeps the ASCII part of a mixed name', () => {
    expect(icsFilename('Diwali दिवाली 🎉 Mela', date)).toBe(
      'gatherwise-diwali-mela-2026-12-20.ics',
    );
  });

  it('cuts a long name without a trailing hyphen, and stays ASCII', () => {
    const name = `${'word '.repeat(30)}end`;
    const file = icsFilename(name, date);
    expect(file).toMatch(/^gatherwise-(?:word-)+word-2026-12-20\.ics$/u);
    expect(file.length).toBeLessThanOrEqual('gatherwise-'.length + 50 + '-2026-12-20.ics'.length);
    expect(file).toMatch(/^[\x20-\x7e]+$/u);
  });
});

describe('icsBlob', () => {
  it('is a calendar of type text/calendar;charset=utf-8', async () => {
    const text = 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n';
    const blob = icsBlob(text);
    expect(blob.type).toBe('text/calendar;charset=utf-8');
    expect(await blob.text()).toBe(text);
  });

  it('keeps non-Latin text as UTF-8', async () => {
    const blob = icsBlob('SUMMARY:अनुपमा 🎉\r\n');
    expect(await blob.text()).toBe('SUMMARY:अनुपमा 🎉\r\n');
  });
});
