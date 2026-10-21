/**
 * Number and date wording shared by the workspace views, in the product's default locale.
 * Never does: compute a figure; every number shown comes from the engine.
 */
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
