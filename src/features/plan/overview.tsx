/**
 * The Overview tab: the plan in one paragraph, the figures that matter as stat tiles, and the
 * "AI at work" panel with the session's AI-call counter.
 * Does: label the AI summary "AI · personalized"; fall back to a sentence built from the engine's
 * figures when there is none.
 * Never does: compute a figure (each one is the engine's) or call the AI except through the panel's
 * buttons.
 */
import type { ReactElement } from 'react';
import { formatMoney, minor } from '../../domain/money.js';
import { vendorView, type ReadyState } from '../../domain/reducer.js';
import type { Status } from '../../domain/schedule.js';
import { KIND_LABELS, SUBTYPE_LABELS } from '../brief/labels.js';
import { AiPanel } from './ai-panel.js';
import { AiBadge } from './chips.js';
import { countOf, formatCount, showDate } from './format.js';
import { Panel } from './panel.js';
import type { PlannerSnapshot } from './planner-store.js';

/** Task statuses that need the organizer's attention. */
const NEEDS_ATTENTION: ReadonlySet<Status> = new Set(['at_risk', 'infeasible', 'overdue']);

/** Props for {@link Overview}. */
export interface OverviewProps {
  readonly state: ReadyState;
  readonly snapshot: PlannerSnapshot;
  readonly onPersonalize: () => void;
}

/** One stat tile: a label, a big tabular value and a short note. */
function Tile(props: {
  readonly label: string;
  readonly value: string;
  readonly note: string;
  readonly tone?: 'bad' | 'risk' | 'accent' | undefined;
}): ReactElement {
  return (
    <div className={props.tone ? `tile tile--${props.tone}` : 'tile'}>
      <dt className="tile__label">{props.label}</dt>
      <dd className="tile__value">{props.value}</dd>
      <dd className="tile__note">{props.note}</dd>
    </div>
  );
}

/** Summary, stat tiles and the AI panel. */
export function Overview({ state, snapshot, onPersonalize }: OverviewProps): ReactElement {
  const { brief, plan } = state;
  const { budget, breakEven, schedule } = plan;
  const money = (amount: number): string => formatMoney(minor(amount), brief.currency);
  const summary = plan.addenda?.summary;
  const attention = schedule.tasks.filter((t) => NEEDS_ATTENTION.has(t.status)).length;
  const vendors = vendorView(state);
  const toBook = vendors.filter((v) => v.status !== 'booked').length;
  const shortfall = breakEven.surplus < 0;

  return (
    <Panel title="Your plan at a glance">
      {summary ? (
        <p className="summary">
          <AiBadge /> <span dir="auto">{summary}</span>
        </p>
      ) : (
        <p className="summary">
          A {KIND_LABELS[brief.kind].toLowerCase()} ({SUBTYPE_LABELS[brief.subtype].toLowerCase()})
          for {countOf(brief.guests, 'guest', 'guests')} on {showDate(plan.eventDate)} with a budget
          of {money(budget.total)}, including a {money(budget.contingency)} contingency.
        </p>
      )}
      <dl className="tiles">
        <Tile
          label="Total budget"
          value={money(budget.total)}
          note={`${money(budget.perGuest)} per guest`}
        />
        <Tile
          label="Contingency"
          value={money(budget.contingency)}
          note={
            budget.overBy === undefined
              ? 'Held back for surprises'
              : `Used up — over by ${money(budget.overBy)}`
          }
          tone={budget.overBy === undefined ? undefined : 'risk'}
        />
        {brief.kind === 'community' && (
          <Tile
            label="Break-even"
            value={`${shortfall ? 'Shortfall' : 'Surplus'} ${money(Math.abs(breakEven.surplus))}`}
            note={`Income ${money(breakEven.income)} against costs ${money(breakEven.costs)}`}
            tone={shortfall ? 'bad' : undefined}
          />
        )}
        <Tile
          label="Tasks needing attention"
          value={formatCount(attention)}
          note={`At risk, overdue or can't be done in time, of ${countOf(schedule.tasks.length, 'task', 'tasks')}`}
          tone={attention > 0 ? 'risk' : undefined}
        />
        <Tile
          label="Vendors to book"
          value={formatCount(toBook)}
          note={`Of ${countOf(vendors.length, 'recommended vendor', 'recommended vendors')}`}
        />
        <Tile
          label="AI calls this session"
          value={formatCount(snapshot.calls)}
          note={
            state.ai.status === 'pending'
              ? '1 call in progress'
              : 'Edits recompute instantly with no AI call'
          }
          tone="accent"
        />
      </dl>
      <AiPanel
        state={state}
        aiView={snapshot.aiView}
        calls={snapshot.calls}
        onPersonalize={onPersonalize}
      />
    </Panel>
  );
}
