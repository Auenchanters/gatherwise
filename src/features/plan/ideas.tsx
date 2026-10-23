/**
 * The Ideas tab: a card for each idea with its category, estimated cost, whether the cost fits that
 * category's budget, and who wrote it, plus "Adjust with AI": an optional "what should change" and
 * the one button in the workspace that asks the AI to revise its answer.
 * Does: call `store.adjust(change)` when that form is submitted (blank asks for fresh ideas); mark
 * the button `aria-disabled` while a request is pending (it keeps keyboard focus, and a submit does
 * nothing); say plainly that edits never call the AI; announce what an adjustment brought,
 * truthfully (updated ideas, or nothing usable), and say nothing while it waits (the Notices region
 * does); label every idea "AI · personalized" (with why it was chosen, tagged with the plan's language) or
 * "Standard suggestion";
 * when no AI ideas are showing, say why.
 * An adjustment is announced here and only here: the Notices region announces the answer to the
 * first request and to Personalize, and skips one that an adjustment asked for.
 * Never does: call the AI from anywhere else, compute a fit (the engine did), or show AI text
 * unlabelled.
 */
import { useId, useRef, useState, type ReactElement } from 'react';
import { formatMoney } from '../../domain/money.js';
import type { Plan } from '../../domain/plan.js';
import type { AiState, ReadyState } from '../../domain/reducer.js';
import { LIMITS } from '../../shared/limits.js';
import { LANGUAGE_TAGS } from '../../shared/options.js';
import { AiBadge, StandardBadge, StatusChip } from './chips.js';
import { categoryLabel, formatCount } from '../../ui/format.js';
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
 * What the adjustment the user asked for has done, as one polite sentence. Silent while the
 * request is pending (and before any): the Notices region already announces the wait. An
 * adjustment always makes a new call, so there is no reused answer to report.
 */
function adjustMessage(
  status: AiStatus,
  answer: { readonly hasAiIdeas: boolean; readonly calls: number },
): string {
  if (status === 'failed') return "The adjustment didn't go through, so your ideas are unchanged.";
  if (status === 'idle' || status === 'pending') return '';
  if (!answer.hasAiIdeas) return STANDARD_NOTICE.applied;
  return `Your ideas are updated. AI calls this session: ${formatCount(answer.calls)}.`;
}

/** One idea. */
function IdeaCard({
  idea,
  plan,
  aiLang,
}: {
  readonly idea: Plan['ideas'][number];
  readonly plan: Plan;
  /** The language tag for Gemini's words; a standard idea is the app's own English. */
  readonly aiLang: string;
}): ReactElement {
  const lang = idea.source === 'ai' ? aiLang : undefined;
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
        <h3 className="idea__title" dir="auto" lang={lang}>
          {idea.title}
        </h3>
        {idea.source === 'ai' ? <AiBadge /> : <StandardBadge />}
      </div>
      <p className="idea__description" dir="auto" lang={lang}>
        {idea.description}
      </p>
      {idea.source === 'ai' && idea.personalization !== undefined && (
        <p className="idea__why">
          <span className="idea__why-label">Why:</span>{' '}
          <span dir="auto" lang={lang}>
            {idea.personalization}
          </span>
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
  /** Real AI calls this session, for the adjustment's announcement. */
  readonly calls: number;
  readonly store: PlannerStore;
}

/** One-tap starting points for "What should change?": a chip fills the field, it never sends. */
const SUGGESTIONS = [
  'More eco-friendly',
  'Cheaper ideas',
  'Kid-friendly',
  'Add a rain plan',
  'More cultural touches',
] as const;

/** The idea cards and the Adjust with AI form. */
export function Ideas({ state, calls, store }: IdeasProps): ReactElement {
  // The generation the user adjusted for: a new plan is a new generation, so it starts unasked.
  const [askedFor, setAskedFor] = useState<number | undefined>(undefined);
  const [change, setChange] = useState('');
  const field = useRef<HTMLInputElement>(null);
  const ids = useId();
  const { ideas } = state.plan;
  const { status } = state.ai;
  const hasAiIdeas = ideas.some((idea) => idea.source === 'ai');
  const pending = status === 'pending';
  const asked = askedFor === state.generation;
  return (
    <Panel title="Ideas">
      <form
        className="ideas__bar"
        onSubmit={(event) => {
          event.preventDefault();
          if (pending) return;
          setAskedFor(state.generation);
          void store.adjust(change);
        }}
      >
        <div className="field ideas__change">
          <label className="field__label" htmlFor={`${ids}-change`}>
            What should change? (optional)
          </label>
          <p className="field__hint" id={`${ids}-hint`}>
            For example “cheaper”, “more for kids” or “an indoor backup”. Leave it blank for fresh
            ideas.
          </p>
          <input
            className="field__input"
            id={`${ids}-change`}
            ref={field}
            type="text"
            dir="auto"
            autoComplete="off"
            maxLength={LIMITS.ai.changeMax}
            aria-describedby={`${ids}-hint`}
            value={change}
            onChange={(event) => {
              setChange(event.currentTarget.value);
            }}
          />
          <div className="ideas__chips" role="group" aria-label="Suggestions">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                className="button button--secondary ideas__chip"
                type="button"
                onClick={() => {
                  setChange(suggestion);
                  field.current?.focus();
                }}
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
        {/* aria-disabled, not disabled: the button keeps keyboard focus while it waits. */}
        <button className="button button--primary" type="submit" aria-disabled={pending}>
          Adjust with AI (1 call)
        </button>
        <p className="ideas__note">Edits never call the AI; only this button does.</p>
      </form>
      <LiveRegion message={asked ? adjustMessage(status, { hasAiIdeas, calls }) : ''} />
      {asked && pending && (
        <p className="ideas__pending" aria-hidden="true">
          <span className="spinner" /> Asking Gemini to adjust your ideas…
        </p>
      )}
      {!hasAiIdeas && <p className="callout callout--info">{STANDARD_NOTICE[status]}</p>}
      <ul className="cards">
        {ideas.map((idea) => (
          <IdeaCard
            key={idea.id}
            idea={idea}
            plan={state.plan}
            aiLang={LANGUAGE_TAGS[state.brief.language]}
          />
        ))}
      </ul>
    </Panel>
  );
}
