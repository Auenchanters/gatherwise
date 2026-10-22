/**
 * Tests for src/features/plan/utc-stamp.ts, the ICS DTSTAMP formatter.
 *
 * Does: pins the exact `YYYYMMDDTHHMMSSZ` shape for a fixed instant, UTC (not local) parts in the
 * suite's America/New_York zone, zero padding of every field including a year before 1000, that
 * milliseconds are dropped, and that `toIcs` accepts every stamp it produces.
 * Never does: read the clock.
 */
import { describe, expect, it } from 'vitest';
import { isoDate } from '../../src/domain/dates.js';
import { toIcs } from '../../src/domain/ics.js';
import { schedule } from '../../src/domain/schedule.js';
import { templateFor } from '../../src/domain/templates/index.js';
import { utcStamp } from '../../src/features/plan/utc-stamp.js';
import { brief, TODAY } from '../support/fixtures.js';

describe('utcStamp', () => {
  it('formats a fixed instant exactly', () => {
    expect(utcStamp(new Date(Date.UTC(2026, 9, 21, 13, 45, 7)))).toBe('20261021T134507Z');
  });

  it('uses UTC parts, not the local zone', () => {
    // 23:30 on 21 Oct in New York is 03:30 on 22 Oct in UTC.
    const local = new Date(2026, 9, 21, 23, 30, 0);
    expect(utcStamp(local)).toBe('20261022T033000Z');
  });

  it('zero-pads month, day, hour, minute and second', () => {
    expect(utcStamp(new Date(Date.UTC(2027, 0, 5, 3, 4, 5)))).toBe('20270105T030405Z');
  });

  it('zero-pads a year below 1000', () => {
    const early = new Date(0);
    early.setUTCFullYear(999, 0, 2);
    early.setUTCHours(0, 0, 0, 0);
    expect(utcStamp(early)).toBe('09990102T000000Z');
  });

  it('drops milliseconds', () => {
    expect(utcStamp(new Date(Date.UTC(2026, 11, 31, 23, 59, 59, 999)))).toBe('20261231T235959Z');
  });

  it('is accepted by toIcs', () => {
    const b = brief('community', { date: '2026-12-12' });
    const result = schedule(templateFor('community').tasks, b, TODAY, new Set());
    if (!result.ok) throw new Error('expected a schedule');
    const text = toIcs(result.value, b, isoDate('2026-12-12'), utcStamp(new Date(0)));
    expect(text).toContain('DTSTAMP:19700101T000000Z');
  });
});
