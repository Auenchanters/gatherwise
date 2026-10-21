/**
 * Number and date wording shared by the workspace views, in the product's default locale.
 * Never does: compute a figure; every number shown comes from the engine or the client's counter.
 */
import type { Budget } from '../../domain/budget.js';
import { formatDate, type IsoDate } from '../../domain/dates.js';

/** Dates and counts read as in India (5 Dec 2026, 1,50,000), the product's default locale. */
const LOCALE = 'en-IN';
const counts = new Intl.NumberFormat(LOCALE);

/** A whole count with grouping, e.g. `5,000`. */
export const formatCount = (n: number): string => counts.format(n);

/** A count and its noun, e.g. `1 guest` or `250 guests`. */
export const countOf = (n: number, one: string, many: string): string =>
  `${formatCount(n)} ${n === 1 ? one : many}`;

/** A date such as `30 Nov 2026`. */
export const showDate = (d: IsoDate): string => formatDate(d, LOCALE);

const months = new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** The month a date falls in, such as `November 2026`; the timeline's group heading. */
export const showMonth = (d: IsoDate): string =>
  months.format(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, 1));

/** The session's settled AI calls, plus the one in flight while a request is pending. */
export const callCount = (calls: number, pending: boolean): string =>
  pending ? `${formatCount(calls)} (1 in progress)` : formatCount(calls);

/** The label of a budget category, by id. An id the budget lacks is shown as it is. */
export const categoryLabel = (budget: Budget, id: string): string =>
  budget.lines.find((line) => line.categoryId === id)?.label ?? id;
