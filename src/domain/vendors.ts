/**
 * Vendor checklist rules: which vendors an event needs, by when to book them, and how urgent that is.
 * Does: takes the template's vendors whose rule is true for the brief and turns each into a
 * trackable item with a book-by date, the reason it applies and a ticked-off checklist. Also
 * answers "how urgent is this booking" in one place, so the UI never compares dates itself.
 * Never does: read the clock (`today` and the event date are parameters); decide which vendors
 * apply (templates do, through `when`); change the template, which is shared by every plan.
 */
import type { EventBrief } from '../shared/schema';
import { addDays, daysBetween, type IsoDate } from './dates';
import { DUE_SOON_DAYS } from './schedule';
import type { EventTemplate } from './templates/types';

/** How far the organizer has got with a vendor. Only the user changes it. */
export type VendorStatus = 'to_contact' | 'quoted' | 'booked';

/** How urgent a booking is on a given day; derived from the dates, never stored. */
export type BookingStatus = 'booked' | 'ok' | 'due_soon' | 'overdue';

/** One question or task to settle with a vendor. */
export interface ChecklistItem {
  /** `vendorId:index`, unique within a plan. */
  readonly id: string;
  readonly text: string;
  readonly done: boolean;
}

/** A vendor the plan recommends. */
export interface VendorItem {
  readonly id: string;
  readonly label: string;
  /** Why it applies to this brief; starts with "Recommended: " and quotes the numbers. */
  readonly reason: string;
  /** The last day to book the vendor. */
  readonly bookBy: IsoDate;
  readonly checklist: readonly ChecklistItem[];
  readonly status: VendorStatus;
}

/**
 * The vendors `template` recommends for `brief`, in template order, all `to_contact`. `eventDate`
 * is the validated date from `eventDateOf`; each `bookBy` is that date minus the vendor's lead time.
 * The template is not modified and the result shares no arrays with it.
 * @throws RangeError if a book-by date falls outside years 0000 to 9999.
 */
export function requiredVendors(
  brief: EventBrief,
  template: EventTemplate,
  eventDate: IsoDate,
): VendorItem[] {
  return template.vendors
    .filter((def) => def.when(brief))
    .map((def): VendorItem => ({
      id: def.id,
      label: def.label,
      reason: def.reason(brief),
      bookBy: addDays(eventDate, -def.bookByLeadDays),
      checklist: def.checklist.map((text, index) => ({
        id: `${def.id}:${index}`,
        text,
        done: false,
      })),
      status: 'to_contact',
    }));
}

/**
 * How urgent a vendor is today: `booked` once booked, else `overdue` after the book-by date,
 * `due_soon` from `DUE_SOON_DAYS` before it up to and including the book-by day, else `ok`.
 */
export function bookingStatus(
  item: Pick<VendorItem, 'status' | 'bookBy'>,
  today: IsoDate,
): BookingStatus {
  if (item.status === 'booked') return 'booked';
  if (item.bookBy < today) return 'overdue';
  return daysBetween(today, item.bookBy) <= DUE_SOON_DAYS ? 'due_soon' : 'ok';
}
