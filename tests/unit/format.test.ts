/**
 * Tests for src/features/plan/format.ts, the workspace's number and date wording.
 * Does: pins the en-IN grouping, singular and plural nouns, the date style, and the call count
 * shown while a request is in flight.
 * Never does: read the clock.
 */
import { describe, expect, it } from 'vitest';
import { buildBudget } from '../../src/domain/budget.js';
import { isoDate } from '../../src/domain/dates.js';
import { templateFor } from '../../src/domain/templates/index.js';
import {
  callCount,
  categoryLabel,
  countOf,
  formatCount,
  showDate,
  showMonth,
} from '../../src/features/plan/format.js';
import { brief } from '../support/fixtures.js';

describe('workspace wording', () => {
  it('groups counts the Indian way and picks the noun by number', () => {
    expect(formatCount(150_000)).toBe('1,50,000');
    expect(countOf(1, 'guest', 'guests')).toBe('1 guest');
    expect(countOf(5000, 'guest', 'guests')).toBe('5,000 guests');
  });

  it('shows dates as day, short month and year', () => {
    expect(showDate(isoDate('2026-12-05'))).toBe('5 Dec 2026');
  });

  it('names a month and year for the timeline groups, whatever the day', () => {
    expect(showMonth(isoDate('2026-11-30'))).toBe('November 2026');
    expect(showMonth(isoDate('2027-01-01'))).toBe('January 2027');
  });

  it('names a budget category by id, and shows an unknown id as it is', () => {
    const budget = buildBudget(brief('community'), templateFor('community'));
    expect(categoryLabel(budget, 'decor')).toBe('Décor');
    expect(categoryLabel(budget, 'nope')).toBe('nope');
  });

  it('adds the request in flight to the settled count only while one is pending', () => {
    expect(callCount(1, false)).toBe('1');
    expect(callCount(0, true)).toBe('0 (1 in progress)');
  });
});
