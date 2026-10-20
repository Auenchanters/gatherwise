/**
 * Contract tests for src/domain/dates.ts.
 *
 * Does: pins strict ISO parsing (format vs impossible dates), UTC day arithmetic across month,
 * leap-day and year boundaries, and locale formatting, with fast-check properties under a fixed seed.
 * Never does: depend on the clock or the machine's time zone; every date is written out.
 */
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import {
  addDays,
  daysBetween,
  formatDate,
  isoDate,
  parseIsoDate,
  type IsoDate,
} from '../../src/domain/dates.js';

const d = isoDate;
const SEED = { seed: 20261020 };

/** Any calendar date from 1900 to 2100, built from its parts (day <= 28 keeps every month valid). */
const dateArb: fc.Arbitrary<IsoDate> = fc
  .record({
    year: fc.integer({ min: 1900, max: 2100 }),
    month: fc.integer({ min: 1, max: 12 }),
    day: fc.integer({ min: 1, max: 28 }),
  })
  .map(({ year, month, day }) =>
    d(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`),
  );

describe('parseIsoDate', () => {
  it('accepts real calendar dates', () => {
    expect(parseIsoDate('2026-10-20')).toEqual({ ok: true, value: '2026-10-20' });
    expect(parseIsoDate('2028-02-29')).toEqual({ ok: true, value: '2028-02-29' });
    expect(parseIsoDate('2000-02-29')).toEqual({ ok: true, value: '2000-02-29' });
    expect(parseIsoDate('0099-12-31')).toEqual({ ok: true, value: '0099-12-31' });
  });

  it.each(['2026-02-30', '2026-13-01', '2026-00-10', '2026-04-31', '2026-01-00', '2026-01-32'])(
    'rejects the impossible date %s as invalid',
    (bad) => {
      expect(parseIsoDate(bad)).toEqual({ ok: false, error: 'invalid' });
    },
  );

  it.each(['2025-02-29', '2100-02-29'])('rejects %s: not a leap year', (bad) => {
    expect(parseIsoDate(bad)).toEqual({ ok: false, error: 'invalid' });
  });

  it.each([
    '2026-1-5',
    '26-01-05',
    '2026/01/05',
    '2026-01-05T00:00:00Z',
    ' 2026-01-05',
    '2026-01-05\n',
    '２０２６-０１-０５',
    '',
    'tomorrow',
  ])('rejects %j as a format error', (bad) => {
    expect(parseIsoDate(bad)).toEqual({ ok: false, error: 'format' });
  });
});

describe('isoDate', () => {
  it('returns the branded string for a valid date and throws RangeError otherwise', () => {
    expect(isoDate('2026-10-20')).toBe('2026-10-20');
    expect(() => isoDate('2026-02-30')).toThrow(RangeError);
    expect(() => isoDate('2026-2-3')).toThrow(RangeError);
  });
});

describe('addDays', () => {
  it('crosses month ends', () => {
    expect(addDays(d('2026-02-28'), 1)).toBe('2026-03-01');
    expect(addDays(d('2026-01-31'), 1)).toBe('2026-02-01');
    expect(addDays(d('2026-03-01'), -1)).toBe('2026-02-28');
  });

  it('knows leap days', () => {
    expect(addDays(d('2028-02-28'), 1)).toBe('2028-02-29');
    expect(addDays(d('2028-02-28'), 2)).toBe('2028-03-01');
    expect(addDays(d('2100-02-28'), 1)).toBe('2100-03-01');
  });

  it('crosses the year boundary in both directions', () => {
    expect(addDays(d('2026-12-31'), 1)).toBe('2027-01-01');
    expect(addDays(d('2027-01-01'), -1)).toBe('2026-12-31');
    expect(addDays(d('2026-12-25'), 400)).toBe('2028-01-29');
  });

  it('is the identity for zero days', () => {
    expect(addDays(d('2026-10-20'), 0)).toBe('2026-10-20');
    expect(addDays(d('2026-10-20'), -0)).toBe('2026-10-20');
  });

  it('keeps four-digit years, including 0099 where Date.UTC would shift to 1999', () => {
    expect(addDays(d('0099-12-31'), 1)).toBe('0100-01-01');
    expect(addDays(d('0000-01-02'), -1)).toBe('0000-01-01');
  });

  it.each([0.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects %s days', (n) => {
    expect(() => addDays(d('2026-10-20'), n)).toThrow(RangeError);
  });

  it('rejects results outside years 0000 to 9999 rather than minting a malformed date', () => {
    expect(() => addDays(d('9999-12-31'), 1)).toThrow(RangeError);
    expect(() => addDays(d('0000-01-01'), -1)).toThrow(RangeError);
    expect(() => addDays(d('2026-10-20'), 1e17)).toThrow(RangeError);
  });
});

describe('daysBetween', () => {
  it('counts whole days, signed', () => {
    expect(daysBetween(d('2026-10-20'), d('2026-10-20'))).toBe(0);
    expect(daysBetween(d('2026-10-20'), d('2026-10-21'))).toBe(1);
    expect(daysBetween(d('2026-10-21'), d('2026-10-20'))).toBe(-1);
    expect(daysBetween(d('2028-02-28'), d('2028-03-01'))).toBe(2);
    expect(daysBetween(d('2026-01-01'), d('2027-01-01'))).toBe(365);
    expect(daysBetween(d('2027-12-31'), d('2028-12-31'))).toBe(366);
  });

  it('runs in a time zone with daylight saving, so local-time code could not hide', () => {
    // vitest.config.ts pins TZ to America/New_York; without it these offsets would be equal.
    const winter = new Date(2026, 0, 15, 12).getTimezoneOffset();
    const summer = new Date(2026, 6, 15, 12).getTimezoneOffset();
    expect(winter).not.toBe(summer);
  });

  it('is not shifted by daylight-saving transitions', () => {
    // New York: 2026-03-08 has 23 local hours (clocks spring forward), 2026-11-01 has 25 (fall back).
    expect(daysBetween(d('2026-03-07'), d('2026-03-09'))).toBe(2);
    expect(daysBetween(d('2026-03-08'), d('2026-03-09'))).toBe(1);
    expect(daysBetween(d('2026-10-31'), d('2026-11-02'))).toBe(2);
    expect(daysBetween(d('2026-11-01'), d('2026-11-02'))).toBe(1);
    expect(addDays(d('2026-03-07'), 2)).toBe('2026-03-09');
    expect(addDays(d('2026-03-08'), 1)).toBe('2026-03-09');
    expect(addDays(d('2026-10-31'), 2)).toBe('2026-11-02');
    expect(addDays(d('2026-11-02'), -1)).toBe('2026-11-01');
  });

  it('inverts addDays (property)', () => {
    fc.assert(
      fc.property(dateArb, fc.integer({ min: -800, max: 800 }), (x, n) => {
        expect(daysBetween(x, addDays(x, n))).toBe(n);
      }),
      SEED,
    );
  });

  it('keeps addDays reversible and its output a valid date (property)', () => {
    fc.assert(
      fc.property(dateArb, fc.integer({ min: -800, max: 800 }), (x, n) => {
        const moved = addDays(x, n);
        expect(parseIsoDate(moved)).toEqual({ ok: true, value: moved });
        expect(addDays(moved, -n)).toBe(x);
      }),
      SEED,
    );
  });

  it('agrees with plain string comparison, which is why ISO dates sort lexically (property)', () => {
    fc.assert(
      fc.property(dateArb, dateArb, (a, b) => {
        expect(Math.sign(daysBetween(a, b))).toBe(a < b ? 1 : a > b ? -1 : 0);
      }),
      SEED,
    );
  });
});

describe('formatDate', () => {
  it('formats a medium date in the requested locale', () => {
    expect(formatDate(d('2026-12-05'), 'en-IN')).toBe('5 Dec 2026');
    expect(formatDate(d('2026-12-05'), 'en-US')).toBe('Dec 5, 2026');
    expect(formatDate(d('2026-01-01'), 'en-GB')).toBe('1 Jan 2026');
  });

  it('rejects a malformed locale tag', () => {
    expect(() => formatDate(d('2026-12-05'), 'not a locale')).toThrow(RangeError);
  });

  it('builds one UTC formatter per locale', async () => {
    // A fresh module instance has an empty cache, so the first call per locale must construct.
    vi.resetModules();
    const spy = vi.spyOn(Intl, 'DateTimeFormat');
    try {
      const fresh = await import('../../src/domain/dates.js');
      for (const day of ['2026-01-01', '2026-06-15', '2026-12-31']) {
        fresh.formatDate(fresh.isoDate(day), 'en-IN');
      }
      fresh.formatDate(fresh.isoDate('2026-01-01'), 'en-US');
      expect(spy).toHaveBeenCalledTimes(2);
      expect(spy).toHaveBeenCalledWith('en-IN', { dateStyle: 'medium', timeZone: 'UTC' });
    } finally {
      spy.mockRestore();
    }
  });
});
