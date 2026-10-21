/**
 * Tests for src/features/plan/format.ts, the workspace's number and date wording.
 * Does: pins the en-IN grouping, singular and plural nouns, the date style, and the call count
 * shown while a request is in flight.
 * Never does: read the clock.
 */
import { describe, expect, it } from 'vitest';
import { isoDate } from '../../src/domain/dates.js';
import { callCount, countOf, formatCount, showDate } from '../../src/features/plan/format.js';

describe('workspace wording', () => {
  it('groups counts the Indian way and picks the noun by number', () => {
    expect(formatCount(150_000)).toBe('1,50,000');
    expect(countOf(1, 'guest', 'guests')).toBe('1 guest');
    expect(countOf(5000, 'guest', 'guests')).toBe('5,000 guests');
  });

  it('shows dates as day, short month and year', () => {
    expect(showDate(isoDate('2026-12-05'))).toBe('5 Dec 2026');
  });

  it('adds the request in flight to the settled count only while one is pending', () => {
    expect(callCount(1, false)).toBe('1');
    expect(callCount(0, true)).toBe('0 (1 in progress)');
  });
});
