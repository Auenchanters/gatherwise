/**
 * Small `when` rules shared by the templates.
 * Does: answers yes/no questions about a brief (is the venue outdoors, does it run late).
 * Never does: compute dates or money, or read the clock.
 */
import type { EventBrief } from '../../shared/schema';
import type { Condition } from './types';

/** True for every brief; use it for tasks and vendors every plan needs. */
export const always: Condition = () => true;

/** True when the event serves food. */
export const servesFood: Condition = (b) => b.servesFood;

/** True when the event serves alcohol. */
export const servesAlcohol: Condition = (b) => b.servesAlcohol;

/** True when the event uses amplified sound. */
export const amplifiedSound: Condition = (b) => b.amplifiedSound;

/** True for public and private outdoor venues; a home or restaurant does not count. */
export const isOutdoor: Condition = (b) =>
  b.venue === 'outdoor_public' || b.venue === 'outdoor_private';

/** True unless the event is held at home, where there is no venue to book. */
export const hostedOutsideHome: Condition = (b) => b.venue !== 'home';

const MINUTES_PER_HOUR = 60;

/** Minutes after midnight for an `HH:MM` string. Also used by the volunteer shift planner. */
export const minutesOf = (hhmm: string): number =>
  Number(hhmm.slice(0, 2)) * MINUTES_PER_HOUR + Number(hhmm.slice(3, 5));

/**
 * True when start time plus duration is later than `cutoff` (`HH:MM`). Finishing exactly at the
 * cut-off is not later, and an event running past midnight counts as ending after any cut-off.
 */
export const endsAfter = (b: EventBrief, cutoff: string): boolean =>
  minutesOf(b.startTime) + b.durationHours * MINUTES_PER_HOUR > minutesOf(cutoff);
