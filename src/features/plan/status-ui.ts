/**
 * How every task, booking and budget-fit status looks: one lookup, so the timeline, the vendors,
 * the ideas and the banners always show a status as the same text, icon and colour together (a
 * budget fit has no fixed text: each caller says what it is short of, and by how much).
 * Never does: decide a status (schedule.ts and vendors.ts do), or rely on colour alone.
 */
import type { Status } from '../../domain/schedule.js';
import type { BookingStatus } from '../../domain/vendors.js';

/** The look of one status. The icon is decorative (render it `aria-hidden`); the label carries it. */
interface StatusUi {
  readonly label: string;
  readonly icon: string;
  /** A modifier for the `status` chip class in workspace.css. */
  readonly className: string;
}

/**
 * Task statuses from the scheduler, booking statuses from `bookingStatus` and the two budget fits.
 * A booking label containing `{date}` gets the formatted book-by date at render time.
 */
export const STATUS_UI: {
  readonly task: Readonly<Record<Status, StatusUi>>;
  readonly booking: Readonly<Record<BookingStatus, StatusUi>>;
  readonly fit: Readonly<Record<'fits' | 'over', Omit<StatusUi, 'label'>>>;
} = {
  task: {
    done: { label: 'Done', icon: '✓', className: 'status--done' },
    on_track: { label: 'On track', icon: '●', className: 'status--ok' },
    due_soon: { label: 'Due soon', icon: '◔', className: 'status--soon' },
    at_risk: { label: 'At risk', icon: '▲', className: 'status--risk' },
    infeasible: { label: "Can't be done in time", icon: '✕', className: 'status--bad' },
    overdue: { label: 'Overdue', icon: '!', className: 'status--bad' },
  },
  booking: {
    booked: { label: 'Booked', icon: '✓', className: 'status--ok' },
    ok: { label: 'Book by {date}', icon: '●', className: 'status--ok' },
    due_soon: { label: 'Book soon', icon: '◔', className: 'status--soon' },
    overdue: { label: 'Booking overdue', icon: '!', className: 'status--bad' },
  },
  // An idea against its budget category. `over` is also how a shortfall looks anywhere else
  // (a category too low to fund, volunteers short), always with its own words.
  fit: {
    fits: { icon: '✓', className: 'status--ok' },
    over: { icon: '▲', className: 'status--risk' },
  },
};
