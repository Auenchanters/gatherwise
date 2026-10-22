/**
 * Volunteer shift planner: how many volunteers each stretch of a community event needs, and who
 * is available to cover it.
 * Does: cuts the event into 3-hour shifts from its start time (the last one may be shorter, times
 * wrap past midnight), sets the staffing each shift needs from the crowd, and spreads the available
 * volunteers across the shifts round-robin. Each volunteer works one shift, so they get a rest.
 * Reports what is missing (`shortfall`) and what is left over (`spare`) instead of failing.
 * Never does: read the clock; throw on too few volunteers; assign anyone to two shifts. It knows
 * nothing about roles (templates list them) and works for any event kind; the UI decides where to
 * show it.
 */
import type { EventBrief } from '../shared/schema.js';
import { MINUTES_PER_HOUR, minutesOf } from './templates/conditions.js';

/** Length of a full shift in hours. */
export const SHIFT_HOURS = 3;
/** One volunteer per this many guests, per shift. */
export const GUESTS_PER_VOLUNTEER = 25;
/** The fewest volunteers a shift ever needs, even for a tiny crowd. */
export const MIN_PER_SHIFT = 2;

const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;

/** One block of the event and how well it is staffed. */
export interface Shift {
  /** `HH:MM`, 24-hour. */
  readonly start: string;
  /** `HH:MM`; earlier than `start` when the shift runs past midnight. */
  readonly end: string;
  /** `SHIFT_HOURS`, or fewer for the last shift. */
  readonly hours: number;
  readonly needed: number;
  /** Volunteers placed on this shift, never more than `needed`. */
  readonly assigned: number;
  /** Volunteers still missing on this shift: `needed - assigned`, 0 when fully staffed. */
  readonly short: number;
}

/** The shifts of an event and the gap between the volunteers needed and available. */
export interface ShiftPlan {
  /** In time order; together they cover the event from start to finish. */
  readonly shifts: readonly Shift[];
  /** Volunteers needed on each shift. */
  readonly needed: number;
  /** Volunteers missing across all shifts. 0 when every shift is fully staffed. */
  readonly shortfall: number;
  /** Available volunteers not needed anywhere. */
  readonly spare: number;
}

/** Minutes after midnight as `HH:MM`, wrapping at 24 hours. */
function clock(minutes: number): string {
  const wrapped = minutes % MINUTES_PER_DAY;
  const hh = String(Math.floor(wrapped / MINUTES_PER_HOUR)).padStart(2, '0');
  const mm = String(wrapped % MINUTES_PER_HOUR).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Plans the shifts for the event in `brief`. Each shift needs `max(MIN_PER_SHIFT,
 * ceil(guests / GUESTS_PER_VOLUNTEER))` volunteers; `volunteersAvailable` are dealt out one at a
 * time to each shift in turn, skipping a shift once it is full.
 */
export function planShifts(brief: EventBrief): ShiftPlan {
  const needed = Math.max(MIN_PER_SHIFT, Math.ceil(brief.guests / GUESTS_PER_VOLUNTEER));
  const count = Math.ceil(brief.durationHours / SHIFT_HOURS);
  // Every shift has the same cap, so dealing one by one gives everyone `floor(v / count)` and the
  // first `v % count` shifts one more, up to the cap. No loop needed.
  const share = Math.floor(brief.volunteersAvailable / count);
  const extra = brief.volunteersAvailable % count;
  const startMinutes = minutesOf(brief.startTime);

  const shifts = Array.from({ length: count }, (_, i): Shift => {
    const hours = Math.min(SHIFT_HOURS, brief.durationHours - i * SHIFT_HOURS);
    const from = startMinutes + i * SHIFT_HOURS * MINUTES_PER_HOUR;
    const assigned = Math.min(needed, share + (i < extra ? 1 : 0));
    return {
      start: clock(from),
      end: clock(from + hours * MINUTES_PER_HOUR),
      hours,
      needed,
      assigned,
      short: needed - assigned,
    };
  });
  const assigned = shifts.reduce((total, shift) => total + shift.assigned, 0);
  return {
    shifts,
    needed,
    shortfall: needed * count - assigned,
    spare: brief.volunteersAvailable - assigned,
  };
}
