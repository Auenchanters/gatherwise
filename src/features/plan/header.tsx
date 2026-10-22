/**
 * The workspace header: the event name as the page's only `<h1>`, the facts line (kind, date,
 * countdown, guests, budget) and the plan actions.
 * Does: take focus when a plan opens (the workspace calls `focus` on `headingRef`); the heading has
 * an id, so a dismissed notice can hand focus back to it.
 * Never does: compute a figure (every number is the engine's) or change the plan itself.
 */
import type { ReactElement, Ref } from 'react';
import { daysBetween } from '../../domain/dates.js';
import { formatMoney } from '../../domain/money.js';
import type { ReadyState } from '../../domain/reducer.js';
import { KIND_LABELS, SUBTYPE_LABELS } from '../brief/labels.js';
import { countOf, showDate } from './format.js';

/** The id of the event name heading, which takes focus whenever a plan opens. */
export const PLAN_HEADING_ID = 'plan-heading';

/** "Today!" on the day, otherwise how many days are left. */
const countdown = (days: number): string =>
  days === 0 ? 'Today!' : `${countOf(days, 'day', 'days')} to go`;

/** Props for {@link Header}. */
export interface HeaderProps {
  readonly state: ReadyState;
  readonly headingRef: Ref<HTMLHeadingElement>;
  readonly onEdit: () => void;
  readonly onNewPlan: () => void;
  readonly onClearData: () => void;
}

/** Event name, facts and actions. */
export function Header({
  state,
  headingRef,
  onEdit,
  onNewPlan,
  onClearData,
}: HeaderProps): ReactElement {
  const { brief, plan, today } = state;
  return (
    <header className="ws-header">
      <h1
        className="ws-header__title"
        id={PLAN_HEADING_ID}
        dir="auto"
        tabIndex={-1}
        ref={headingRef}
      >
        {brief.name}
      </h1>
      <ul className="ws-meta" aria-label="Event facts">
        <li className="ws-meta__chip">
          {KIND_LABELS[brief.kind]} · {SUBTYPE_LABELS[brief.subtype]}
        </li>
        <li>{showDate(plan.eventDate)}</li>
        <li className="ws-meta__countdown">{countdown(daysBetween(today, plan.eventDate))}</li>
        <li>{countOf(brief.guests, 'guest', 'guests')}</li>
        <li>{formatMoney(plan.budget.total, brief.currency)} budget</li>
      </ul>
      <div className="ws-header__actions">
        <button className="button button--secondary" type="button" onClick={onEdit}>
          Edit details
        </button>
        <button className="button button--secondary" type="button" onClick={onNewPlan}>
          New plan
        </button>
        <button className="button button--quiet" type="button" onClick={onClearData}>
          Clear my data
        </button>
      </div>
    </header>
  );
}
