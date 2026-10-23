/**
 * The Vendors tab: a card for each vendor the plan recommends, with why, how urgent it is to book,
 * a status the organizer sets, a checklist to tick off and, once Gemini has answered, questions to
 * ask that vendor.
 * Does: show the plan's vendors with the organizer's status and ticks already laid over them (the
 * workspace computes that once, with `vendorView`); label every checkbox with its item and every select with its vendor; announce each change
 * politely; label the AI questions "AI · personalized" and tag them with the plan's language.
 * Never does: call the AI, decide how urgent a booking is (`bookingStatus` does), or show a status
 * by colour alone.
 */
import { useId, useState, type ReactElement } from 'react';
import type { ReadyState } from '../../domain/reducer.js';
import type { IsoDate } from '../../domain/dates.js';
import { AI_LABEL } from '../../domain/merge.js';
import { LANGUAGE_TAGS } from '../../shared/options.js';
import {
  bookingStatus,
  VENDOR_STATUSES,
  type BookingStatus,
  type VendorItem,
  type VendorStatus,
} from '../../domain/vendors.js';
import { StatusChip } from './chips.js';
import { showDate } from '../../ui/format.js';
import { LiveRegion, Panel } from './panel.js';
import type { PlannerStore } from './planner-store.js';
import { STATUS_UI } from './status-ui.js';
import './vendors.css';

/** What the organizer calls each stage of a vendor. */
const STATUS_LABELS: Readonly<Record<VendorStatus, string>> = {
  to_contact: 'To contact',
  quoted: 'Quoted',
  booked: 'Booked',
};

/** Booking statuses whose chip does not already carry the date. */
const NEEDS_DATE: ReadonlySet<BookingStatus> = new Set(['due_soon', 'overdue']);

/** The status a `<select>` value names, if it names one. */
const statusOf = (value: string): VendorStatus | undefined =>
  VENDOR_STATUSES.find((status) => status === value);

/** One vendor. */
function VendorCard(props: {
  readonly vendor: VendorItem;
  readonly today: IsoDate;
  readonly questions: readonly string[] | undefined;
  /** The language tag for Gemini's questions. */
  readonly aiLang: string;
  readonly onStatus: (vendor: VendorItem, status: VendorStatus) => void;
  readonly onCheck: (item: VendorItem['checklist'][number]) => void;
}): ReactElement {
  const { vendor, today, questions, onStatus, onCheck } = props;
  const id = useId();
  const booking = bookingStatus(vendor, today);
  const ui = STATUS_UI.booking[booking];
  return (
    <li className="vendor">
      <div className="vendor__head">
        <h3 className="vendor__title" dir="auto">
          {vendor.label}
        </h3>
        <StatusChip ui={ui} label={ui.label(showDate(vendor.bookBy))} />
      </div>
      <p className="vendor__reason" dir="auto">
        {vendor.reason}
      </p>
      {NEEDS_DATE.has(booking) && (
        <p className="vendor__bookby">Book by {showDate(vendor.bookBy)}</p>
      )}
      <div className="vendor__status">
        <label className="vendor__status-label" htmlFor={`${id}-status`}>
          Status <span className="visually-hidden">for {vendor.label}</span>
        </label>
        <select
          className="field__input vendor__select"
          id={`${id}-status`}
          value={vendor.status}
          onChange={(event) => {
            const status = statusOf(event.currentTarget.value);
            if (status) onStatus(vendor, status);
          }}
        >
          {VENDOR_STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </select>
        {/* A printed page has no menus, so print shows the chosen status as words. */}
        <span className="print-only">Status: {STATUS_LABELS[vendor.status]}</span>
      </div>
      <fieldset className="vendor__checklist">
        <legend className="vendor__legend">
          Checklist <span className="visually-hidden">for {vendor.label}</span>
        </legend>
        <ul className="checks">
          {vendor.checklist.map((item) => (
            <li className="check" key={item.id}>
              <input
                className="check__input"
                id={`${id}-${item.id}`}
                type="checkbox"
                checked={item.done}
                onChange={() => {
                  onCheck(item);
                }}
              />
              <label className="check__label" htmlFor={`${id}-${item.id}`} dir="auto">
                {item.text}
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      {questions !== undefined && questions.length > 0 && (
        <div className="vendor__questions">
          <h4 className="vendor__questions-title">
            <span aria-hidden="true">✦</span> Questions to ask ({AI_LABEL})
          </h4>
          <ul className="vendor__question-list" lang={props.aiLang}>
            {questions.map((question, index) => (
              <li key={index} dir="auto">
                {question}
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

/** Props for {@link Vendors}. */
export interface VendorsProps {
  readonly state: ReadyState;
  /** The plan's vendors with the organizer's status and ticks laid over them (`vendorView`). */
  readonly vendors: readonly VendorItem[];
  readonly store: PlannerStore;
}

/** The vendor cards. */
export function Vendors({ state, vendors, store }: VendorsProps): ReactElement {
  const [message, setMessage] = useState('');
  const questions = state.plan.addenda?.vendorQuestions;
  return (
    <Panel title="Vendors">
      <p className="panel-note">
        Book-by dates count back from your event date; they are typical planning heuristics, so
        confirm real lead times with each vendor.
      </p>
      <LiveRegion message={message} />
      <ul className="cards">
        {vendors.map((vendor) => (
          <VendorCard
            key={vendor.id}
            vendor={vendor}
            today={state.today}
            questions={questions?.[vendor.id]}
            aiLang={LANGUAGE_TAGS[state.brief.language]}
            onStatus={(item, status) => {
              store.setVendorStatus(item.id, status);
              setMessage(`Marked '${item.label}' as ${STATUS_LABELS[status].toLowerCase()}`);
            }}
            onCheck={(item) => {
              store.toggleChecklist(item.id);
              setMessage(`Marked '${item.text}' ${item.done ? 'not done' : 'done'}`);
            }}
          />
        ))}
      </ul>
    </Panel>
  );
}
