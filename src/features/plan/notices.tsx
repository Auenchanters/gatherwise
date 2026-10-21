/**
 * The workspace's two live regions: a polite one for progress and notices (the AI at work, an AI
 * failure, a restore or storage problem, cleared data) and an assertive one for an edit the plan
 * refused. It stays mounted while the plan opens and closes, so changes are always announced.
 * Never does: decide what a notice says (the store does), or start anything.
 */
import type { ReactElement } from 'react';
import type { PlanStateError } from '../../domain/reducer.js';
import { LIMITS } from '../../shared/limits.js';
import { formatCount } from './format.js';
import type { Notice, PlannerSnapshot } from './planner-store.js';

const { guestsMin, guestsMax, budgetMin, budgetMax } = LIMITS.brief;

/** Human copy for every refused edit; the plan keeps the last good value, and says so. */
const ERROR_COPY: Record<
  | Exclude<PlanStateError['kind'], 'invalid_date'>
  | Extract<PlanStateError, { kind: 'invalid_date' }>['reason'],
  string
> = {
  invalid_guests: `Guests must be a whole number from ${formatCount(guestsMin)} to ${formatCount(guestsMax)} — the plan still uses the last valid number.`,
  invalid_budget: `The budget must be a whole number from ${formatCount(budgetMin)} to ${formatCount(budgetMax)} — the plan still uses the last valid budget.`,
  invalid:
    'Enter the event date as a real calendar date — the plan still uses the last valid date.',
  past: 'Choose a date from today onwards — the plan still uses the last valid date.',
  too_far: 'Choose a date within the next two years — the plan still uses the last valid date.',
};

const errorText = (error: PlanStateError): string =>
  ERROR_COPY[error.kind === 'invalid_date' ? error.reason : error.kind];

const TONE_ICONS: Record<Notice['tone'], string> = { info: 'ℹ', warning: '⚠︎', error: '✕' };

/** Props for {@link Notices}. */
export interface NoticesProps {
  readonly snapshot: PlannerSnapshot;
  readonly onDismiss: (id: string) => void;
}

/** Progress and notices (polite) and refused edits (assertive). */
export function Notices({ snapshot, onDismiss }: NoticesProps): ReactElement {
  const { plan, notices, aiView } = snapshot;
  const status = plan.phase === 'ready' ? plan.ai.status : 'idle';
  // An answer that arrived this session is announced; the AI panel already shows it on screen.
  const landed = status === 'applied' && aiView.sentBrief !== undefined;
  return (
    <div className="notices">
      <div className="notices__region" role="status">
        {status === 'pending' && (
          <p className="notice notice--info">
            <span className="spinner" aria-hidden="true" />
            <span className="notice__text">Gemini is personalizing your plan…</span>
          </p>
        )}
        {landed && (
          <span className="visually-hidden">
            {aiView.cached
              ? 'Reused the AI ideas for this brief — no new AI call.'
              : 'Gemini has personalized your plan.'}
          </span>
        )}
        {notices.map((notice) => (
          <p className={`notice notice--${notice.tone}`} key={notice.id}>
            <span className="notice__icon" aria-hidden="true">
              {TONE_ICONS[notice.tone]}
            </span>
            <span className="notice__text">{notice.text}</span>
            <button
              className="notice__dismiss"
              type="button"
              onClick={() => {
                onDismiss(notice.id);
              }}
            >
              <span aria-hidden="true">×</span>
              <span className="visually-hidden">Dismiss this notice</span>
            </button>
          </p>
        ))}
      </div>
      <div className="notices__region" role="alert">
        {plan.error && (
          <p className="notice notice--error">
            <span className="notice__icon" aria-hidden="true">
              {TONE_ICONS.error}
            </span>
            <span className="notice__text">{errorText(plan.error)}</span>
          </p>
        )}
      </div>
    </div>
  );
}
