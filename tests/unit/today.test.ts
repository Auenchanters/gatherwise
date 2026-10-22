/**
 * Tests for src/features/plan/today.ts, the client's one read of today's date.
 *
 * Does: pins that the date comes from local parts (the suite runs in America/New_York, so a late
 * evening there is already tomorrow in UTC), zero-padding, and the default argument.
 * Never does: depend on the real date beyond its shape.
 */
import { describe, expect, it } from 'vitest';
import { todayIso } from '../../src/features/plan/today.js';

describe('todayIso', () => {
  it('uses the local calendar day, not the UTC one', () => {
    const lateEvening = new Date(2026, 9, 21, 23, 30);
    expect(lateEvening.toISOString().slice(0, 10)).toBe('2026-10-22');
    expect(todayIso(lateEvening)).toBe('2026-10-21');
  });

  it('zero-pads months and days', () => {
    expect(todayIso(new Date(2027, 0, 5, 9))).toBe('2027-01-05');
  });

  it('reads the clock when no date is given', () => {
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
  });
});
