/**
 * How every task and booking status looks: one lookup, so the timeline, the vendors and the
 * banners always show a status as the same text, icon and colour together.
 * Never does: decide a status (schedule.ts and vendors.ts do), or rely on colour alone.
 */
import { AI_TASK_PREFIX } from '../../domain/merge.js';
import type { Status } from '../../domain/schedule.js';
import type { TaskId } from '../../domain/templates/types.js';
import type { BookingStatus } from '../../domain/vendors.js';

/** Whether a task came from Gemini rather than the template, so it must carry the AI label. */
export const isAiTask = (id: TaskId): boolean => id.startsWith(AI_TASK_PREFIX);

/** The look of one status. The icon is decorative (render it `aria-hidden`); the label carries it. */
interface StatusUi {
  readonly label: string;
  readonly icon: string;
  /** A modifier for the `status` chip class in workspace.css. */
  readonly className: string;
}

/**
 * Task statuses from the scheduler and booking statuses from `bookingStatus`. A booking label
 * containing `{date}` gets the formatted book-by date at render time.
 */
export const STATUS_UI: {
  readonly task: Readonly<Record<Status, StatusUi>>;
  readonly booking: Readonly<Record<BookingStatus, StatusUi>>;
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
};
