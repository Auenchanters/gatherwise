/**
 * The workspace's two live regions: a polite one for progress and notices (the AI at work, an AI
 * failure, a restore or storage problem, cleared data) and an assertive one for a brief or an edit
 * the plan refused. It stays mounted while the plan opens and closes, so changes are always
 * announced. Also the one catalog of refused-value copy, which the Budget fields repeat inline.
 * Never does: decide what a notice says (the store does), or start anything.
 */
import type { ReactElement } from 'react';
import type { PlanStateError } from '../../domain/reducer.js';
import { LIMITS } from '../../shared/limits.js';
import { formatCount } from './format.js';
import type { Notice, PlannerSnapshot } from './planner-store.js';
import { PLAN_ERROR_ID } from './storage-key.js';

const { guestsMin, guestsMax, budgetMin, budgetMax } = LIMITS.brief;

type DateReason = Extract<PlanStateError, { kind: 'invalid_date' }>['reason'];

/** Human copy for every refused value. */
const ERROR_COPY: Record<Exclude<PlanStateError['kind'], 'invalid_date'> | DateReason, string> = {
  invalid_guests: `Guests must be a whole number from ${formatCount(guestsMin)} to ${formatCount(guestsMax)}`,
  invalid_budget: `The budget must be a whole number from ${formatCount(budgetMin)} to ${formatCount(budgetMax)}`,
  invalid: 'Enter the event date as a real calendar date',
  past: 'Choose a date from today onwards',
  too_far: 'Choose a date within the next two years',
};

/** What a plan keeps instead of the refused value. */
const KEPT: Record<PlanStateError['kind'], string> = {
  invalid_guests: 'number',
  invalid_budget: 'budget',
  invalid_date: 'date',
};

/**
 * Why a value was refused; with a plan open, also that the plan kept its last valid one.
 * The Budget fields show this same text beside the refused input.
 */
export function errorText(error: PlanStateError, hasPlan: boolean): string {
  const why = ERROR_COPY[error.kind === 'invalid_date' ? error.reason : error.kind];
  return hasPlan ? `${why} — the plan still uses the last valid ${KEPT[error.kind]}.` : `${why}.`;
}

const TONE_ICONS: Record<Notice['tone'], string> = { info: 'ℹ', warning: '⚠︎', error: '✕' };

/** Props for {@link Notices}. */
export interface NoticesProps {
  readonly snapshot: PlannerSnapshot;
  readonly onDismiss: (id: string) => void;
}

/** Progress and notices (polite) and refused values (assertive). */
export function Notices({ snapshot, onDismiss }: NoticesProps): ReactElement {
  const { plan, notices, aiView } = snapshot;
  const status = plan.phase === 'ready' ? plan.ai.status : 'idle';
  // An answer that arrived this session is announced; the AI panel already shows it on screen.
  const landed = status === 'applied' && aiView.sentBrief !== undefined;
  return (
    <div className="notices">
      {/* Not atomic: a new notice is read on its own, not with every notice already showing. */}
      <div className="notices__region" role="status" aria-atomic="false">
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
              aria-label={`Dismiss: ${notice.text}`}
              onClick={() => {
                onDismiss(notice.id);
              }}
            >
              <span aria-hidden="true">×</span>
            </button>
          </p>
        ))}
      </div>
      <div className="notices__region" role="alert">
        {plan.error && (
          <p className="notice notice--error" id={PLAN_ERROR_ID} tabIndex={-1}>
            <span className="notice__icon" aria-hidden="true">
              {TONE_ICONS.error}
            </span>
            <span className="notice__text">{errorText(plan.error, plan.phase === 'ready')}</span>
          </p>
        )}
      </div>
    </div>
  );
}
