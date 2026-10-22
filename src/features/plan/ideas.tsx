/**
 * The Ideas tab: a card for each idea with its category, estimated cost, whether the cost fits that
 * category's budget, and who wrote it, plus the one button in the workspace that asks the AI for
 * new ideas.
 * Does: call `store.refreshIdeas()` from that button's click; mark the button `aria-disabled` while
 * a request is pending (it keeps keyboard focus, and a click does nothing); say plainly that edits
 * never call the AI; announce what a refresh brought, truthfully (fresh, the same as before, or
 * nothing usable), and say nothing while it waits (the Notices region does); label every idea "AI · personalized" (with why it was chosen) or "Standard
 * suggestion"; when no AI ideas are showing, say why.
 * Never does: call the AI from anywhere else, compute a fit (the engine did), or show AI text
 * unlabelled.
 */
import { useState, type ReactElement } from 'react';
import { formatMoney } from '../../domain/money.js';
import type { Plan } from '../../domain/plan.js';
import type { AiState, ReadyState } from '../../domain/reducer.js';
import { AiBadge, StandardBadge, StatusChip } from './chips.js';
import { categoryLabel, formatCount } from './format.js';
import { LiveRegion, Panel } from './panel.js';
import type { PlannerStore } from './planner-store.js';
import { STATUS_UI } from './status-ui.js';
import './ideas.css';

type AiStatus = AiState['status'];

/** Why standard suggestions are showing, by where the AI stands. Only used when none are AI's. */
const STANDARD_NOTICE: Readonly<Record<AiStatus, string>> = {
  idle: "These ideas are standard suggestions: they haven't been personalized yet. Ask Gemini with the button above (1 AI call).",
  pending: 'Showing standard suggestions for now while Gemini works on yours.',
  failed:
    "Gemini couldn't personalize these ideas, so you're seeing standard suggestions. You can try again with the button above.",
  applied: "Gemini's answer had no usable ideas, so you're seeing standard suggestions.",
};

/**
 * What the refresh the user asked for has done, as one polite sentence. Silent while the request
 * is pending (and before any): the Notices region already announces the wait.
 */
function refreshMessage(
  status: AiStatus,
  answer: { readonly hasAiIdeas: boolean; readonly cached: boolean; readonly calls: number },
): string {
  if (status === 'failed') return "The refresh didn't go through, so your ideas are unchanged.";
  if (status === 'idle' || status === 'pending') return '';
  if (!answer.hasAiIdeas) return STANDARD_NOTICE.applied;
  if (answer.cached) return 'Same ideas as before — reused from this session, no new AI call.';
  return `Fresh ideas are in. AI calls this session: ${formatCount(answer.calls)}.`;
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
    ? { ui: STATUS_UI.fit.fits, label: `Fits ${category} budget` }
    : {
        ui: STATUS_UI.fit.over,
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
  /** True when the latest answer was reused from this session's cache rather than fetched. */
  readonly cached: boolean;
  readonly store: PlannerStore;
}

/** The idea cards and the refresh button. */
export function Ideas({ state, calls, cached, store }: IdeasProps): ReactElement {
  // The generation the user refreshed for: a new plan is a new generation, so it starts unasked.
  const [askedFor, setAskedFor] = useState<number | undefined>(undefined);
  const { ideas } = state.plan;
  const { status } = state.ai;
  const hasAiIdeas = ideas.some((idea) => idea.source === 'ai');
  const pending = status === 'pending';
  const asked = askedFor === state.generation;
  return (
    <Panel title="Ideas">
      <div className="ideas__bar">
        {/* aria-disabled, not disabled: the button keeps keyboard focus while it waits. */}
        <button
          className="button button--primary"
          type="button"
          aria-disabled={pending}
          onClick={() => {
            if (pending) return;
            setAskedFor(state.generation);
            void store.refreshIdeas();
          }}
        >
          Refresh ideas (1 AI call)
        </button>
        <p className="ideas__note">Edits never call the AI; only this button does.</p>
      </div>
      <LiveRegion message={asked ? refreshMessage(status, { hasAiIdeas, cached, calls }) : ''} />
      {asked && pending && (
        <p className="ideas__pending" aria-hidden="true">
          <span className="spinner" /> Asking Gemini for fresh ideas…
        </p>
      )}
      {!hasAiIdeas && <p className="callout callout--info">{STANDARD_NOTICE[status]}</p>}
      <ul className="cards">
        {ideas.map((idea) => (
          <IdeaCard key={idea.id} idea={idea} plan={state.plan} />
        ))}
      </ul>
    </Panel>
  );
}
