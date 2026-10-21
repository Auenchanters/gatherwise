/**
 * The Budget tab: guests, budget and date controls that re-plan on every change, the reconciled
 * budget table with a native `<meter>` per line, the over-budget callout and, for community events,
 * the break-even ledger.
 * Does: announce each recompute politely, with the session's AI-call count to show it cost none.
 * Never does: compute money (every figure is the engine's), call the AI, or snap an input back
 * while the user is typing (a refused value stays in the field and the alert says why).
 */
import { useId, useState, type ReactElement } from 'react';
import { addDays } from '../../domain/dates.js';
import { formatMoney, minor, toMinor, type Minor } from '../../domain/money.js';
import type { ReadyState } from '../../domain/reducer.js';
import { LIMITS } from '../../shared/limits.js';
import { currencySymbol } from '../brief/labels.js';
import { countOf, showDate } from './format.js';
import type { PlannerStore } from './planner-store.js';

const shareFormat = new Intl.NumberFormat('en-IN', { style: 'percent' });

/** Props for {@link Budget}. */
export interface BudgetProps {
  readonly state: ReadyState;
  readonly store: PlannerStore;
}

/** The three inputs that re-plan the budget, and the live region that reports each recompute. */
function Controls({ state, store }: BudgetProps): ReactElement {
  const ids = useId();
  const { brief, today } = state;
  // Drafts, so a half-typed or refused value stays in the field instead of snapping back.
  const [guests, setGuests] = useState(String(brief.guests));
  const [budget, setBudget] = useState(String(brief.budget));
  const [date, setDate] = useState(brief.date);
  const [message, setMessage] = useState('');

  /**
   * Reports the recompute that just happened, worded by `what` from the new state, or nothing if
   * the edit was refused (the alert says why).
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
    setMessage(`${what(plan)}${over}. No AI call used (AI calls this session: ${calls}).`);
  };

  return (
    <div className="controls">
      <div className="controls__fields">
        <div className="field">
          <label className="field__label" htmlFor={`${ids}-guests`}>
            Guests attending
          </label>
          <input
            className="field__input field__input--number"
            id={`${ids}-guests`}
            type="number"
            inputMode="numeric"
            min={LIMITS.brief.guestsMin}
            max={LIMITS.brief.guestsMax}
            step={1}
            value={guests}
            onChange={(event) => {
              const { value, valueAsNumber } = event.currentTarget;
              setGuests(value);
              store.changeGuests(valueAsNumber);
              announce(
                (next) => `Budget updated for ${countOf(next.brief.guests, 'guest', 'guests')}`,
              );
            }}
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor={`${ids}-budget`}>
            Total budget
          </label>
          <div className="field__prefixed">
            <span className="field__prefix" aria-hidden="true">
              {currencySymbol(brief.currency)}
            </span>
            <input
              className="field__input field__input--number"
              id={`${ids}-budget`}
              type="number"
              inputMode="numeric"
              min={LIMITS.brief.budgetMin}
              max={LIMITS.brief.budgetMax}
              step={1}
              value={budget}
              aria-describedby={`${ids}-currency`}
              onChange={(event) => {
                const { value, valueAsNumber } = event.currentTarget;
                setBudget(value);
                store.changeBudget(valueAsNumber);
                announce(
                  (next) =>
                    `Budget updated to ${formatMoney(next.plan.budget.total, next.brief.currency)}`,
                );
              }}
            />
          </div>
          <p className="field__hint" id={`${ids}-currency`}>
            In {brief.currency}, whole units.
          </p>
        </div>
        <div className="field">
          <label className="field__label" htmlFor={`${ids}-date`}>
            Event date
          </label>
          <input
            className="field__input"
            id={`${ids}-date`}
            type="date"
            min={today}
            max={addDays(today, LIMITS.brief.horizonDays)}
            value={date}
            onChange={(event) => {
              const { value } = event.currentTarget;
              setDate(value);
              store.changeDate(value);
              announce((next) => `Plan updated for ${showDate(next.plan.eventDate)}`);
            }}
          />
        </div>
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
        {props.tooLow && (
          <span className="status status--risk">
            <span aria-hidden="true">▲</span> Too low for this category
          </span>
        )}
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
  const titleId = useId();
  const { brief, plan, generation } = state;
  const { budget, breakEven } = plan;
  const { currency, total } = budget;
  return (
    <section className="budget" aria-labelledby={titleId}>
      <h2 className="panel-title" id={titleId}>
        Budget
      </h2>
      <div className="budget__layout">
        {/* A new plan (generation) starts the drafts from its own brief. */}
        <Controls key={generation} state={state} store={store} />
        <div className="budget__main">
          {budget.overBy !== undefined && (
            <p className="callout callout--risk">
              <span className="callout__icon" aria-hidden="true">
                ▲
              </span>
              Over budget by {formatMoney(budget.overBy, currency)} — contingency is used up. Lower
              guests or raise the budget.
            </p>
          )}
          <table className="budget-table">
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
    </section>
  );
}
