/**
 * Tests for src/domain/volunteers.ts, the volunteer shift coverage planner.
 *
 * Does: pins the staffing ratio and its constants, the brief's cases (300 guests over 6 hours,
 * a shortfall with 5 volunteers), shift boundaries (a short last shift, wrapping past midnight),
 * the empty and tiny-crowd edges, and a seeded property test over every kind of brief checked
 * against a literal round-robin reference.
 * Never does: read the clock; every random input is seeded.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  GUESTS_PER_VOLUNTEER,
  MIN_PER_SHIFT,
  planShifts,
  SHIFT_HOURS,
  type Shift,
} from '../../src/domain/volunteers';
import { brief, briefArb } from '../support/fixtures';

const SEED = { seed: 20261022, numRuns: 500 };

/** A community event with the given crowd, length and volunteers, starting at 16:00 unless set. */
const community = (
  guests: number,
  durationHours: number,
  volunteersAvailable: number,
  startTime = '16:00',
) => brief('community', { guests, durationHours, volunteersAvailable, startTime });

const sum = (values: readonly number[]): number => values.reduce((total, v) => total + v, 0);
/** One numeric column of the shifts. */
const field = (shifts: readonly Shift[], key: 'needed' | 'assigned' | 'hours'): number[] =>
  shifts.map((s) => s[key]);

/**
 * The reference: hand out volunteers one at a time, shift after shift, skipping full shifts,
 * until they run out or every shift is full. The planner must give the same split.
 */
function roundRobin(volunteers: number, shifts: number, cap: number): number[] {
  const seats = Array.from({ length: shifts }, () => 0);
  let given = 0;
  for (let i = 0; given < volunteers && seats.some((s) => s < cap); i = (i + 1) % shifts) {
    const taken = seats[i] ?? cap;
    if (taken < cap) {
      seats[i] = taken + 1;
      given += 1;
    }
  }
  return seats;
}

describe('the staffing ratio', () => {
  it('is one volunteer per 25 guests per 3-hour shift, at least 2', () => {
    expect(SHIFT_HOURS).toBe(3);
    expect(GUESTS_PER_VOLUNTEER).toBe(25);
    expect(MIN_PER_SHIFT).toBe(2);
  });

  it('needs ceil(guests / 25) per shift: 50 guests need 2, 51 need 3, 300 need 12', () => {
    const needed = (guests: number) => planShifts(community(guests, 3, 0)).needed;
    expect(needed(50)).toBe(2);
    expect(needed(51)).toBe(3);
    expect(needed(300)).toBe(12);
    expect(needed(301)).toBe(13);
    expect(needed(5000)).toBe(200);
  });

  it('never needs fewer than 2 per shift, even for a tiny crowd', () => {
    for (const guests of [1, 10, 25, 26]) {
      const plan = planShifts(community(guests, 6, 0));
      expect(plan.needed).toBe(2);
      expect(field(plan.shifts, 'needed')).toEqual([2, 2]);
    }
  });
});

describe('a 300-guest, 6-hour event', () => {
  const plan = planShifts(community(300, 6, 30));

  it('has two 3-hour shifts that follow each other from the start time', () => {
    expect(plan.shifts).toEqual([
      { start: '16:00', end: '19:00', hours: 3, needed: 12, assigned: 12 },
      { start: '19:00', end: '22:00', hours: 3, needed: 12, assigned: 12 },
    ]);
  });

  it('is fully staffed, with the 6 volunteers left over reported as spare', () => {
    expect(plan.needed).toBe(12);
    expect(plan.shortfall).toBe(0);
    expect(plan.spare).toBe(6);
  });
});

describe('too few volunteers', () => {
  const b = community(300, 6, 5);

  it('reports the shortfall without throwing', () => {
    expect(() => planShifts(b)).not.toThrow();
    const plan = planShifts(b);
    expect(plan.shortfall).toBe(2 * 12 - 5);
    expect(plan.spare).toBe(0);
  });

  it('shares the volunteers round-robin, earlier shifts first', () => {
    expect(field(planShifts(b).shifts, 'assigned')).toEqual([3, 2]);
  });
});

describe('shift boundaries', () => {
  it('makes the last shift shorter when the event is not a multiple of 3 hours', () => {
    const plan = planShifts(community(100, 7, 100, '09:00'));
    expect(plan.shifts.map(({ start, end, hours }) => [start, end, hours])).toEqual([
      ['09:00', '12:00', 3],
      ['12:00', '15:00', 3],
      ['15:00', '16:00', 1],
    ]);
  });

  it('plans a single shift of the event length when it is under 3 hours', () => {
    const plan = planShifts(community(100, 1, 100, '10:30'));
    expect(plan.shifts.map(({ start, end, hours }) => [start, end, hours])).toEqual([
      ['10:30', '11:30', 1],
    ]);
  });

  it('keeps minutes in the shift times', () => {
    const plan = planShifts(community(100, 4, 100, '17:45'));
    expect(plan.shifts.map(({ start, end }) => [start, end])).toEqual([
      ['17:45', '20:45'],
      ['20:45', '21:45'],
    ]);
  });

  it('wraps past midnight: 22:00 for 6 hours is 22:00-01:00 then 01:00-04:00', () => {
    const plan = planShifts(community(100, 6, 100, '22:00'));
    expect(plan.shifts.map(({ start, end }) => [start, end])).toEqual([
      ['22:00', '01:00'],
      ['01:00', '04:00'],
    ]);
  });

  it('writes a shift that ends exactly at midnight as 00:00', () => {
    expect(planShifts(community(100, 3, 100, '21:00')).shifts[0]?.end).toBe('00:00');
  });

  it('covers the longest event, 16 hours, with six shifts ending in a 1-hour shift', () => {
    const plan = planShifts(community(100, 16, 100, '08:00'));
    expect(field(plan.shifts, 'hours')).toEqual([3, 3, 3, 3, 3, 1]);
    expect(plan.shifts.at(-1)?.end).toBe('00:00');
  });
});

describe('volunteer supply', () => {
  it('assigns nobody and reports the whole requirement as a shortfall with 0 volunteers', () => {
    const plan = planShifts(community(300, 6, 0));
    expect(field(plan.shifts, 'assigned')).toEqual([0, 0]);
    expect(plan.shortfall).toBe(24);
    expect(plan.spare).toBe(0);
  });

  it('never staffs a shift above what it needs: the rest are spare', () => {
    const plan = planShifts(community(10, 1, 500));
    expect(plan.shifts).toEqual([
      { start: '16:00', end: '17:00', hours: 1, needed: 2, assigned: 2 },
    ]);
    expect(plan.shortfall).toBe(0);
    expect(plan.spare).toBe(498);
  });

  it('staffs exactly when volunteers match the requirement', () => {
    const plan = planShifts(community(300, 6, 24));
    expect(plan.shortfall).toBe(0);
    expect(plan.spare).toBe(0);
  });
});

describe('any kind of event', () => {
  it('plans weddings and birthdays the same way', () => {
    const wedding = planShifts(
      brief('wedding', { guests: 200, durationHours: 6, volunteersAvailable: 10 }),
    );
    expect(wedding.needed).toBe(8);
    expect(wedding.shortfall).toBe(2 * 8 - 10);
    const birthday = planShifts(
      brief('birthday', { guests: 30, durationHours: 3, volunteersAvailable: 0 }),
    );
    expect(birthday.needed).toBe(2);
    expect(birthday.shortfall).toBe(2);
  });

  it('is deterministic', () => {
    const b = community(300, 6, 30);
    expect(planShifts(b)).toEqual(planShifts(b));
  });
});

describe('planShifts over every valid brief', () => {
  it('never over-staffs a shift or over-uses volunteers, and accounts for every volunteer', () => {
    fc.assert(
      fc.property(briefArb, (b) => {
        const plan = planShifts(b);
        const assigned = sum(field(plan.shifts, 'assigned'));
        for (const shift of plan.shifts) {
          expect(shift.assigned).toBeGreaterThanOrEqual(0);
          expect(shift.assigned).toBeLessThanOrEqual(shift.needed);
          expect(shift.needed).toBe(plan.needed);
        }
        expect(assigned).toBeLessThanOrEqual(b.volunteersAvailable);
        expect(assigned + plan.spare).toBe(b.volunteersAvailable);
        expect(plan.spare).toBeGreaterThanOrEqual(0);
        expect(plan.shortfall).toBeGreaterThanOrEqual(0);
        expect(plan.shortfall).toBe(plan.needed * plan.shifts.length - assigned);
        expect(plan.needed).toBe(
          Math.max(MIN_PER_SHIFT, Math.ceil(b.guests / GUESTS_PER_VOLUNTEER)),
        );
      }),
      SEED,
    );
  });

  it('covers the event exactly: hours add up, shifts are back to back from the start', () => {
    fc.assert(
      fc.property(briefArb, (b) => {
        const { shifts } = planShifts(b);
        expect(sum(field(shifts, 'hours'))).toBe(b.durationHours);
        expect(shifts.length).toBe(Math.ceil(b.durationHours / SHIFT_HOURS));
        expect(shifts[0]?.start).toBe(b.startTime);
        for (const [i, shift] of shifts.entries()) {
          expect(shift.hours).toBeGreaterThanOrEqual(1);
          expect(shift.hours).toBeLessThanOrEqual(SHIFT_HOURS);
          expect(shift.start).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/u);
          expect(shift.end).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/u);
          expect(shift.start).toBe(i === 0 ? b.startTime : shifts[i - 1]?.end);
        }
      }),
      SEED,
    );
  });

  it('splits volunteers exactly as a literal round-robin would', () => {
    fc.assert(
      fc.property(briefArb, (b) => {
        const plan = planShifts(b);
        expect(field(plan.shifts, 'assigned')).toEqual(
          roundRobin(b.volunteersAvailable, plan.shifts.length, plan.needed),
        );
      }),
      SEED,
    );
  });
});
