/**
 * The Ideas tab: a card for each idea with its category, estimated cost, whether the cost fits that
 * category's budget, and who wrote it, plus the one button in the workspace that asks the AI for
 * new ideas.
 * Does: call `store.refreshIdeas()` from that button's click, disabled while a request is pending;
 * say plainly that edits never call the AI; label every idea "AI · personalized" (with why it was
 * chosen) or "Standard suggestion"; when no AI ideas are showing, say why, honestly.
 * Never does: call the AI from anywhere else, compute a fit (the engine did), or show AI text
 * unlabelled.
 */
import { useId, useState, type ReactElement } from 'react';
import { formatMoney } from '../../domain/money.js';
import type { Plan } from '../../domain/plan.js';
import type { AiState, ReadyState } from '../../domain/reducer.js';
import { AiBadge, StandardBadge, StatusChip } from './chips.js';
import { categoryLabel, formatCount } from './format.js';
import type { PlannerStore } from './planner-store.js';

type AiStatus = AiState['status'];

/** The look of the two fits: an icon and a status colour, as everywhere else. */
const FIT_UI = {
  fits: { icon: '✓', className: 'status--ok' },
  over: { icon: '▲', className: 'status--risk' },
} as const;

/** Why standard suggestions are showing, by where the AI stands. Only used when none are AI's. */
const STANDARD_NOTICE: Readonly<Record<AiStatus, string>> = {
  idle: "These ideas are standard suggestions: they haven't been personalized yet. Ask Gemini with the button above (1 AI call).",
  pending: 'Showing standard suggestions for now while Gemini works on yours.',
  failed:
    "Gemini couldn't personalize these ideas, so you're seeing standard suggestions. You can try again with the button above.",
  applied: "Gemini's answer had no usable ideas, so you're seeing standard suggestions.",
};

/** What the refresh just did, as one polite sentence. */
function refreshMessage(status: AiStatus, calls: number): string {
  const messages: Readonly<Record<AiStatus, string>> = {
    idle: '',
    pending: 'Asking Gemini for fresh ideas… this uses 1 AI call.',
    applied: `Fresh ideas are in. AI calls this session: ${formatCount(calls)}.`,
    failed: "The refresh didn't go through, so your ideas are unchanged.",
  };
  return messages[status];
}

/** One idea. */
function IdeaCard({
  idea,
  plan,
}: {
  readonly idea: Plan['ideas'][number];
  readonly plan: Plan;
}): ReactElement {
  const { currency } = plan.budget;
  const category = categoryLabel(plan.budget, idea.categoryId);
  const fit = idea.fit.fits
    ? { ui: FIT_UI.fits, label: `Fits ${category} budget` }
    : {
        ui: FIT_UI.over,
        label: `Over ${category} budget by ${formatMoney(idea.fit.overBy, currency)}`,
      };
  return (
    <li className="idea">
      <div className="idea__head">
        <h3 className="idea__title" dir="auto">
          {idea.title}
        </h3>
        {idea.source === 'ai' ? <AiBadge /> : <StandardBadge />}
      </div>
      <p className="idea__description" dir="auto">
        {idea.description}
      </p>
      {idea.source === 'ai' && idea.personalization !== undefined && (
        <p className="idea__why">
          <span className="idea__why-label">Why:</span>{' '}
          <span dir="auto">{idea.personalization}</span>
        </p>
      )}
      <dl className="idea__facts">
        <div>
          <dt>Category</dt>
          <dd>{category}</dd>
        </div>
        <div>
          <dt>Estimated cost</dt>
          <dd className="num">{formatMoney(idea.estimatedCost, currency)}</dd>
        </div>
      </dl>
      <p className="idea__fit">
        <StatusChip ui={fit.ui} label={fit.label} />
      </p>
    </li>
  );
}

/** Props for {@link Ideas}. */
export interface IdeasProps {
  readonly state: ReadyState;
  /** Real AI calls this session, for the refresh's announcement. */
  readonly calls: number;
  readonly store: PlannerStore;
}

/** The idea cards and the refresh button. */
export function Ideas({ state, calls, store }: IdeasProps): ReactElement {
  const titleId = useId();
  const [requested, setRequested] = useState(false);
  const { ideas } = state.plan;
  const { status } = state.ai;
  const hasAi = ideas.some((idea) => idea.source === 'ai');
  return (
    <section className="ideas" aria-labelledby={titleId}>
      <h2 className="panel-title" id={titleId}>
        Ideas
      </h2>
      <div className="ideas__bar">
        <button
          className="button button--primary"
          type="button"
          disabled={status === 'pending'}
          onClick={() => {
            setRequested(true);
            void store.refreshIdeas();
          }}
        >
          Refresh ideas (1 AI call)
        </button>
        <p className="ideas__note">Edits never call the AI; only this button does.</p>
      </div>
      <p className="visually-hidden" role="status">
        {requested ? refreshMessage(status, calls) : ''}
      </p>
      {requested && status === 'pending' && (
        <p className="ideas__pending" aria-hidden="true">
          <span className="spinner" /> Asking Gemini for fresh ideas…
        </p>
      )}
      {!hasAi && <p className="callout callout--info">{STANDARD_NOTICE[status]}</p>}
      <ul className="cards cards--ideas">
        {ideas.map((idea) => (
          <IdeaCard key={idea.id} idea={idea} plan={state.plan} />
        ))}
      </ul>
    </section>
  );
}
