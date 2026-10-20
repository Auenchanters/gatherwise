/**
 * Contract tests for src/domain/money.ts.
 *
 * Does: pins the branded-integer constructors, rounding of toMinor, the largest-remainder
 * allocation (with fast-check properties under a fixed seed) and the locale-aware formatting.
 * Never does: depend on the clock or the host locale; every random input is seeded.
 */
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import {
  allocate,
  formatMoney,
  isMinor,
  MINOR_PER_MAJOR,
  minor,
  toMinor,
  type Minor,
} from '../../src/domain/money';
import { CURRENCIES } from '../../src/shared/schema';

const m = minor;
const sum = (values: readonly Minor[]): number => values.reduce((acc, v) => acc + v, 0);
const SEED = { seed: 20261020 };

describe('minor', () => {
  it('accepts safe integers, negatives included', () => {
    expect(m(100)).toBe(100);
    expect(m(-250)).toBe(-250);
    expect(m(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('normalizes negative zero to zero', () => {
    expect(Object.is(m(-0), 0)).toBe(true);
  });

  it.each([1.5, 2 ** 53, -(2 ** 53), Number.NaN, Number.POSITIVE_INFINITY])(
    'throws RangeError for %s',
    (bad) => {
      expect(() => m(bad)).toThrow(RangeError);
    },
  );

  it('isMinor is the predicate behind the constructor', () => {
    expect(isMinor(7)).toBe(true);
    expect(isMinor(-7)).toBe(true);
    expect(isMinor(0.1)).toBe(false);
    expect(isMinor(-0)).toBe(false);
    expect(isMinor(2 ** 53)).toBe(false);
  });
});

describe('toMinor', () => {
  it('uses 100 minor units per major for every currency', () => {
    for (const currency of CURRENCIES) expect(MINOR_PER_MAJOR[currency]).toBe(100);
  });

  it('converts whole and fractional major units', () => {
    expect(toMinor(150000, 'INR')).toBe(15_000_000);
    expect(toMinor(19.99, 'USD')).toBe(1999);
    expect(toMinor(0, 'EUR')).toBe(0);
  });

  it('rounds half away from zero', () => {
    expect(toMinor(0.005, 'INR')).toBe(1);
    expect(toMinor(-0.005, 'INR')).toBe(-1);
    expect(toMinor(0.004, 'INR')).toBe(0);
  });

  it('never returns negative zero', () => {
    expect(Object.is(toMinor(-0.004, 'INR'), 0)).toBe(true);
    expect(Object.is(toMinor(-0, 'INR'), 0)).toBe(true);
  });

  it('throws RangeError when the amount is not a finite, representable number', () => {
    expect(() => toMinor(Number.NaN, 'INR')).toThrow(RangeError);
    expect(() => toMinor(Number.POSITIVE_INFINITY, 'INR')).toThrow(RangeError);
    expect(() => toMinor(1e15, 'INR')).toThrow(RangeError);
  });

  it('is exact for whole major amounts (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1e9, max: 1e9 }), (major) => {
        expect(toMinor(major, 'INR')).toBe(major * 100);
      }),
      SEED,
    );
  });
});

describe('allocate', () => {
  it('splits by largest remainder, giving the extra unit to the lowest index on ties', () => {
    expect(allocate(m(100), [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(m(2), [1, 1, 1])).toEqual([1, 1, 0]);
    expect(allocate(m(1), [1, 1])).toEqual([1, 0]);
  });

  it('follows the weights proportionally and ignores their scale', () => {
    expect(allocate(m(10_000), [12, 15, 25, 8, 6, 6, 5, 4, 9, 10])).toEqual([
      1200, 1500, 2500, 800, 600, 600, 500, 400, 900, 1000,
    ]);
    expect(allocate(m(100), [0.1, 0.2, 0.7])).toEqual([10, 20, 70]);
    expect(allocate(m(100), [10, 20, 70])).toEqual([10, 20, 70]);
  });

  it('gives the extra unit to the biggest fractional share, not the biggest weight', () => {
    // exact shares 0.6, 1.2, 1.2: floors leave one unit over, and 0.6 has the largest remainder
    expect(allocate(m(3), [1, 2, 2])).toEqual([1, 1, 1]);
    expect(allocate(m(5), [0.5, 1.2, 0.3])).toEqual([1, 3, 1]);
  });

  it('gives zero-weight slots nothing, even when they sit before the leftover', () => {
    expect(allocate(m(10), [0, 1, 1, 1])).toEqual([0, 4, 3, 3]);
    expect(allocate(m(5), [0, 0, 3])).toEqual([0, 0, 5]);
  });

  it('allocates a zero total and a single slot', () => {
    expect(allocate(m(0), [3, 1])).toEqual([0, 0]);
    expect(allocate(m(123), [9])).toEqual([123]);
  });

  it('keeps float noise in the weights from losing or inventing money', () => {
    expect(allocate(m(6), [0.1, 0.2, 0.3])).toEqual([1, 2, 3]);
  });

  it.each([
    ['a negative total', m(-1), [1]],
    ['no weights', m(10), []],
    ['all-zero weights', m(10), [0, 0]],
    ['a negative weight', m(10), [1, -1]],
    ['a NaN weight', m(10), [1, Number.NaN]],
    ['an infinite weight', m(10), [1, Number.POSITIVE_INFINITY]],
    ['weights whose sum overflows', m(10), [Number.MAX_VALUE, Number.MAX_VALUE]],
  ])('throws RangeError for %s', (_name, total, weights) => {
    expect(() => allocate(total, weights)).toThrow(RangeError);
  });

  it('always sums to the total and never goes negative (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1e12 }),
        fc.array(fc.float({ min: 0, max: 100, noNaN: true }), { minLength: 1, maxLength: 20 }),
        (t, w) =>
          w.some((x) => x > 0)
            ? sum(allocate(m(t), w)) === t && allocate(m(t), w).every((x) => x >= 0)
            : true,
      ),
      SEED,
    );
  });

  it('stays within one unit of each exact share and leaves zero weights at zero (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1e10 }),
        fc.array(fc.float({ min: 0, max: 100, noNaN: true }), { minLength: 1, maxLength: 20 }),
        fc.integer({ min: 0, max: 19 }),
        (t, w, zeroAt) => {
          const weights = w.map((x, i) => (i === zeroAt ? 0 : x));
          fc.pre(weights.some((x) => x > 0));
          const total = weights.reduce((acc, x) => acc + x, 0);
          const out = allocate(m(t), weights);
          expect(out).toHaveLength(weights.length);
          weights.forEach((x, i) => {
            const share = out[i] ?? Number.NaN;
            expect(Math.abs(share - (t * x) / total)).toBeLessThan(1.001);
            if (x === 0) expect(share).toBe(0);
          });
        },
      ),
      SEED,
    );
  });
});

describe('formatMoney', () => {
  it('groups INR the Indian way', () => {
    expect(formatMoney(toMinor(150000, 'INR'), 'INR')).toBe('₹1,50,000.00');
  });

  it('never prints a minus for zero', () => {
    expect(formatMoney(m(0), 'INR')).not.toContain('-');
    expect(formatMoney(m(0), 'INR')).toBe('₹0.00');
  });

  it('prints negative amounts with a leading minus', () => {
    expect(formatMoney(m(-15_000_000), 'INR')).toBe('-₹1,50,000.00');
    expect(formatMoney(m(-1), 'USD')).toBe('-$0.01');
  });

  it.each([
    ['INR', '₹1,234.56'],
    ['USD', '$1,234.56'],
    ['EUR', '€1,234.56'],
    ['GBP', '£1,234.56'],
    ['AED', 'AED 1,234.56'],
    ['SGD', '$1,234.56'],
    ['AUD', '$1,234.56'],
    ['CAD', '$1,234.56'],
  ] as const)('formats %s to two decimals', (currency, text) => {
    // Some locales put a no-break space between symbol and digits; compare with a plain space.
    expect(formatMoney(m(123_456), currency).replace(/\s/gu, ' ')).toBe(text);
  });

  it('builds each currency formatter once', async () => {
    // A fresh module instance has an empty cache, so the first call per currency must construct.
    vi.resetModules();
    const spy = vi.spyOn(Intl, 'NumberFormat');
    try {
      const fresh = await import('../../src/domain/money');
      for (const amount of [1, 2, 3]) fresh.formatMoney(fresh.minor(amount), 'CAD');
      fresh.formatMoney(fresh.minor(1), 'USD');
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      spy.mockRestore();
    }
  });
});
