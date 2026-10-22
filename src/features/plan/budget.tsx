/**
 * The Budget tab: guests, budget and date controls that re-plan on every change, the reconciled
 * budget table with a native `<meter>` per line, the over-budget callout and, for community events,
 * the break-even ledger.
 * Does: announce each recompute politely, with the session's AI-call count to show it cost none;
 * mark a refused value at its field (`aria-invalid`, an inline message, the brief form's `Field`)
 * as well as in the alert.
 * Never does: compute money (every figure is the engine's), call the AI, snap an input back while
 * the user is typing, send a blank or unreadable draft (a half-typed year included) before the user
 * leaves the field, or leave a confirmation up for a value that was not sent.
 */
import {
  useId,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import { addDays } from '../../domain/dates.js';
import { formatMoney, minor, toMinor, type Minor } from '../../domain/money.js';
import type { PlanStateError, ReadyState } from '../../domain/reducer.js';
import { LIMITS } from '../../shared/limits.js';
import { Field } from '../brief/fields.js';
import { currencySymbol } from '../brief/labels.js';
import type { FieldKey } from '../brief/validate.js';
import { StatusChip } from './chips.js';
import { callCount, countOf, showDate } from './format.js';
import { errorText } from './notices.js';
import { Panel } from './panel.js';
import type { PlannerStore } from './planner-store.js';
import { STATUS_UI } from './status-ui.js';
import './budget.css';

const shareFormat = new Intl.NumberFormat('en-IN', { style: 'percent' });

/** Props for {@link Budget}. */
export interface BudgetProps {
  readonly state: ReadyState;
  readonly store: PlannerStore;
}

/** The Budget field each refused value belongs to. */
const FIELD_OF = {
  invalid_guests: 'guests',
  invalid_budget: 'budget',
  invalid_date: 'date',
} as const satisfies Record<PlanStateError['kind'], FieldKey>;

type ControlKey = (typeof FIELD_OF)[PlanStateError['kind']];

/**
 * Whether the browser can read a draft: a number, or a date with a four-digit year from 1000 on.
 * Chrome fills a date input as the year is typed (`0002-…`, `0020-…`, `0202-…`), and each of those
 * is a real date in the past that would raise the alert before the user has finished typing; the
 * event window starts today, so a year below 1000 is never a finished date.
 */
const readable = (input: HTMLInputElement): boolean =>
  input.type === 'date' ? /^[1-9]\d{3}-/u.test(input.value) : !Number.isNaN(input.valueAsNumber);

/** The three inputs that re-plan the budget, and the live region that reports each recompute. */
function Controls({ state, store }: BudgetProps): ReactElement {
  const { brief, today, error } = state;
  // Drafts, so a half-typed or refused value stays in the field instead of snapping back.
  const [drafts, setDrafts] = useState<Record<ControlKey, string>>({
    guests: String(brief.guests),
    budget: String(brief.budget),
    date: brief.date,
  });
  const [message, setMessage] = useState('');

  /** The refused-value copy for the field the plan's error is about, beside that field. */
  const errorFor = (key: ControlKey): string | undefined =>
    error && FIELD_OF[error.kind] === key ? errorText(error, true) : undefined;

  /**
   * Reports the recompute that just happened, worded by `what` from the new state, or nothing if
   * the edit was refused (the field and the alert say why).
   */
  const announce = (what: (next: ReadyState) => string): void => {
    const { plan, calls } = store.getState();
    if (plan.phase !== 'ready' || plan.error) {
      setMessage('');
      return;
    }
    const { overBy } = plan.plan.budget;
    const over =
      overBy === undefined ? '' : ` — over budget by ${formatMoney(overBy, plan.brief.currency)}`;
    const count = callCount(calls, plan.ai.status === 'pending');
    setMessage(`${what(plan)}${over}. No AI call used (AI calls this session: ${count}).`);
  };

  /** Sends one field's value to the plan and reports the result. */
  const apply: Record<ControlKey, (input: HTMLInputElement) => void> = {
    guests: (input) => {
      store.changeGuests(input.valueAsNumber);
      announce((next) => `Budget updated for ${countOf(next.brief.guests, 'guest', 'guests')}`);
    },
    budget: (input) => {
      store.changeBudget(input.valueAsNumber);
      announce(
        (next) => `Budget updated to ${formatMoney(next.plan.budget.total, next.brief.currency)}`,
      );
    },
    date: (input) => {
      store.changeDate(input.value);
      announce((next) => `Plan updated for ${showDate(next.plan.eventDate)}`);
    },
  };

  /**
   * The draft follows every keystroke, but only a readable value reaches the plan while typing.
   * A blank or unreadable one is sent on blur or Enter, so the error appears only then.
   */
  const bind = (key: ControlKey) => ({
    value: drafts[key],
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      const input = event.currentTarget;
      const { value } = input;
      setDrafts((current) => ({ ...current, [key]: value }));
      if (readable(input)) apply[key](input);
      // Nothing was sent, so the last confirmation no longer describes the field.
      else setMessage('');
    },
    onBlur: (event: FocusEvent<HTMLInputElement>) => {
      if (!readable(event.currentTarget)) apply[key](event.currentTarget);
    },
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter' && !readable(event.currentTarget)) apply[key](event.currentTarget);
    },
  });

  return (
    <div className="controls">
      <div className="controls__fields">
        <Field field="guests" label="Guests attending" error={errorFor('guests')}>
          {(control) => (
            <input
              {...control}
              {...bind('guests')}
              className="field__input field__input--number"
              type="number"
              inputMode="numeric"
              min={LIMITS.brief.guestsMin}
              max={LIMITS.brief.guestsMax}
              step={1}
            />
          )}
        </Field>
        <Field
          field="budget"
          label="Total budget"
          hint={`In ${brief.currency}, whole units.`}
          error={errorFor('budget')}
        >
          {(control) => (
            <div className="field__prefixed">
              <span className="field__prefix" aria-hidden="true">
                {currencySymbol(brief.currency)}
              </span>
              <input
                {...control}
                {...bind('budget')}
                className="field__input field__input--number"
                type="number"
                inputMode="numeric"
                min={LIMITS.brief.budgetMin}
                max={LIMITS.brief.budgetMax}
                step={1}
              />
            </div>
          )}
        </Field>
        <Field field="date" label="Event date" error={errorFor('date')}>
          {(control) => (
            <input
              {...control}
              {...bind('date')}
              className="field__input"
              type="date"
              min={today}
              max={addDays(today, LIMITS.brief.horizonDays)}
            />
          )}
        </Field>
      </div>
      <p className="controls__status" role="status">
        {message}
      </p>
      <p className="controls__note">
        Changes here recompute the whole plan in your browser. They never call the AI.
      </p>
    </div>
  );
}

/** One budget line: category, amount, share meter, whether it scales, and its warning. */
function Line(props: {
  readonly label: string;
  readonly allocated: Minor;
  readonly total: Minor;
  readonly currency: ReadyState['brief']['currency'];
  /** "Yes", "No", or a dash where it does not apply. */
  readonly scales: string;
  readonly tooLow?: boolean;
}): ReactElement {
  const share = shareFormat.format(props.allocated / props.total);
  return (
    <tr>
      <th scope="row">{props.label}</th>
      <td className="num">{formatMoney(props.allocated, props.currency)}</td>
      <td>
        <span className="share">
          <meter
            className="share__meter"
            min={0}
            max={props.total}
            value={props.allocated}
            aria-label={`${props.label}: ${share} of the total`}
          />
          <span className="share__pct">{share}</span>
        </span>
      </td>
      <td>{props.scales}</td>
      <td>
        {props.tooLow && <StatusChip ui={STATUS_UI.fit.over} label="Too low for this category" />}
      </td>
    </tr>
  );
}

/** Income, costs and the surplus or shortfall of a community event. */
function BreakEven({ state }: { readonly state: ReadyState }): ReactElement | null {
  const titleId = useId();
  const { brief, plan } = state;
  if (brief.kind !== 'community') return null;
  const { currency, income } = brief;
  const { breakEven } = plan;
  const money = (amount: Minor): string => formatMoney(amount, currency);
  const major = (amount: number): string => money(toMinor(amount, currency));
  const shortfall = breakEven.surplus < 0;
  return (
    <section className="break-even" aria-labelledby={titleId}>
      <h3 className="break-even__title" id={titleId}>
        Break-even
      </h3>
      <dl className="ledger">
        {income && (
          <>
            <div>
              <dt>Tickets</dt>
              <dd>
                {major(income.ticketPrice)} ×{' '}
                {countOf(income.expectedPaidAttendance, 'paid guest', 'paid guests')}
              </dd>
            </div>
            <div>
              <dt>Sponsors</dt>
              <dd>{major(income.sponsors)}</dd>
            </div>
            <div>
              <dt>Donations</dt>
              <dd>{major(income.donations)}</dd>
            </div>
            <div>
              <dt>Stalls</dt>
              <dd>
                {countOf(income.stallCount, 'stall', 'stalls')} × {major(income.stallFee)}
              </dd>
            </div>
          </>
        )}
        <div className="ledger__subtotal">
          <dt>Total income</dt>
          <dd>{money(breakEven.income)}</dd>
        </div>
        <div>
          <dt>Costs (whole budget)</dt>
          <dd>{money(breakEven.costs)}</dd>
        </div>
        <div className={shortfall ? 'ledger__result ledger__result--bad' : 'ledger__result'}>
          <dt>{shortfall ? 'Shortfall' : 'Surplus'}</dt>
          <dd>{money(minor(Math.abs(breakEven.surplus)))}</dd>
        </div>
        {breakEven.breakEvenTicketPrice !== undefined && (
          <div>
            <dt>Break-even ticket price</dt>
            <dd>{money(breakEven.breakEvenTicketPrice)}</dd>
          </div>
        )}
        {breakEven.breakEvenAttendance !== undefined && (
          <div>
            <dt>Break-even paid attendance</dt>
            <dd>{countOf(breakEven.breakEvenAttendance, 'guest', 'guests')}</dd>
          </div>
        )}
      </dl>
      {!income && <p className="break-even__note">No income was entered for this event.</p>}
    </section>
  );
}

/** Controls, the reconciled table, the over-budget callout and the break-even ledger. */
export function Budget({ state, store }: BudgetProps): ReactElement {
  const { brief, plan, generation } = state;
  const { budget, breakEven } = plan;
  const { currency, total } = budget;
  return (
    <Panel title="Budget">
      <div className="budget__layout">
        {/* A new plan (generation) starts the drafts from its own brief. */}
        <Controls key={generation} state={state} store={store} />
        <div>
          {budget.overBy !== undefined && (
            <p className="callout callout--risk">
              <span aria-hidden="true">▲</span>
              Over budget by {formatMoney(budget.overBy, currency)} — contingency is used up. Lower
              guests or raise the budget.
            </p>
          )}
          <table className="data-table">
            <caption>
              How {formatMoney(total, currency)} is split for{' '}
              {countOf(brief.guests, 'guest', 'guests')} on {showDate(plan.eventDate)}
            </caption>
            <thead>
              <tr>
                <th scope="col">Category</th>
                <th scope="col" className="num">
                  Allocated
                </th>
                <th scope="col">Share</th>
                <th scope="col">Scales with guests</th>
                <th scope="col">Note</th>
              </tr>
            </thead>
            <tbody>
              {budget.lines.map((line) => (
                <Line
                  key={line.categoryId}
                  label={line.label}
                  allocated={line.allocated}
                  total={total}
                  currency={currency}
                  scales={line.scales === 'per_guest' ? 'Yes' : 'No'}
                  tooLow={line.warning === 'too_low'}
                />
              ))}
              <Line
                label="Contingency"
                scales="—"
                allocated={budget.contingency}
                total={total}
                currency={currency}
              />
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Total</th>
                <td className="num">{formatMoney(breakEven.costs, currency)}</td>
                <td colSpan={3}>
                  {budget.overBy === undefined
                    ? 'Adds up exactly to your budget.'
                    : `Your budget is ${formatMoney(total, currency)}.`}
                </td>
              </tr>
            </tfoot>
          </table>
          <BreakEven state={state} />
        </div>
      </div>
    </Panel>
  );
}
