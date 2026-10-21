/**
 * The "AI at work" panel: the one model call made visible. It shows the exact prompt (rebuilt in
 * the browser by the same `buildPrompt` the server runs, from the brief that was sent), the
 * validated answer, every change the engine made to it, and the call's model, latency, tokens and
 * the session's AI-call count.
 * Does: offer the only buttons here that may call the AI ("Personalize with AI", "Try again");
 * both go through the store's commands.
 * Never does: call the AI on render or in an effect, or show AI text without saying so.
 */
import { useId, useMemo, type ReactElement } from 'react';
import type { IsoDate } from '../../domain/dates.js';
import type { Adjustment } from '../../domain/merge.js';
import { buildPlan } from '../../domain/plan.js';
import type { ReadyState } from '../../domain/reducer.js';
import { buildPrompt } from '../../shared/prompt.js';
import type { EventBrief } from '../../shared/schema.js';
import { countOf, formatCount } from './format.js';
import type { AiView } from './planner-store.js';

const ADJUSTMENT_LABELS: Record<Adjustment['kind'], string> = {
  clamped: 'Clamped',
  dropped: 'Dropped',
  truncated: 'Shortened',
};

/**
 * The prompt for `brief` as the server builds it: the fixed system instruction, then the JSON
 * data block pretty-printed. Undefined when the brief can no longer be planned (its date passed).
 */
function promptText(brief: EventBrief, today: IsoDate): string | undefined {
  const plan = buildPlan(brief, today);
  if (!plan.ok) return undefined;
  const { system, user } = buildPrompt(plan.value);
  const data: unknown = JSON.parse(user);
  return [
    '// System instruction (fixed for every request)',
    system,
    '',
    '// User message: your event as JSON data, never as instructions',
    JSON.stringify(data, null, 2),
  ].join('\n');
}

/** Props for {@link AiPanel}. */
export interface AiPanelProps {
  readonly state: ReadyState;
  readonly aiView: AiView;
  /** Real AI calls this session. */
  readonly calls: number;
  /** Asks the AI for the current brief: the store's `personalize` command. */
  readonly onPersonalize: () => void;
}

/** What happened with the AI for this plan, and the controls to ask it. */
function AiStatus({ state, aiView, onPersonalize }: Omit<AiPanelProps, 'calls'>): ReactElement {
  const { status, meta } = state.ai;
  if (status === 'pending') {
    return (
      <p className="ai-panel__status">
        <span className="spinner" aria-hidden="true" />
        Gemini is personalizing your plan…
      </p>
    );
  }
  if (status === 'failed') {
    return (
      <div className="ai-panel__status ai-panel__status--failed">
        <p>{aiView.failure ?? "The AI request didn't go through."}</p>
        <button className="button button--secondary" type="button" onClick={onPersonalize}>
          Try again
        </button>
      </div>
    );
  }
  if (status === 'idle') {
    return (
      <div className="ai-panel__status">
        <p>
          This plan uses standard suggestions so far. Gemini can personalize the ideas, add tasks
          and suggest questions for your vendors.
        </p>
        <button className="button button--primary" type="button" onClick={onPersonalize}>
          Personalize with AI (1 call)
        </button>
      </div>
    );
  }
  let source = `Personalized by ${meta?.model ?? 'Gemini'} in one call.`;
  if (aiView.cached) source = 'Reused from this session — no new AI call.';
  else if (aiView.sentBrief === undefined) {
    source = 'Restored with your saved plan — no new AI call.';
  }
  return (
    <p className="ai-panel__status ai-panel__status--done">
      <span className="ai-panel__tick" aria-hidden="true">
        ✓
      </span>
      {source}
    </p>
  );
}

/** The engine's changes to the answer, each as a kind badge and one sentence. */
function Adjustments({ items }: { readonly items: readonly Adjustment[] }): ReactElement {
  if (items.length === 0) {
    return <p>No adjustments needed — every AI value was within range.</p>;
  }
  return (
    <ul className="adjustments">
      {items.map((item) => (
        <li className="adjustments__item" key={`${item.target}:${item.kind}`}>
          <span className={`badge badge--${item.kind}`}>{ADJUSTMENT_LABELS[item.kind]}</span>
          <span dir="auto">{item.detail}</span>
        </li>
      ))}
    </ul>
  );
}

/** The transparent receipt of the plan's AI call. */
export function AiPanel({ state, aiView, calls, onPersonalize }: AiPanelProps): ReactElement {
  const ids = useId();
  const { suggestions, meta } = state.ai;
  const sent = aiView.sentBrief;
  const prompt = useMemo(
    () => promptText(sent ?? state.brief, state.today),
    [sent, state.brief, state.today],
  );
  return (
    <details className="ai-panel" open>
      <summary className="ai-panel__summary">AI at work</summary>
      <div className="ai-panel__body">
        <AiStatus state={state} aiView={aiView} onPersonalize={onPersonalize} />
        <dl className="ai-panel__meta">
          {meta && (
            <>
              <div>
                <dt>Model</dt>
                <dd>{meta.model}</dd>
              </div>
              <div>
                <dt>Latency</dt>
                <dd>{(meta.latencyMs / 1000).toFixed(1)} s</dd>
              </div>
              <div>
                <dt>Tokens in / out</dt>
                <dd>
                  {formatCount(meta.inputTokens)} / {formatCount(meta.outputTokens)}
                </dd>
              </div>
            </>
          )}
          <div className="ai-panel__calls">
            <dt>AI calls this session</dt>
            <dd>{calls}</dd>
          </div>
        </dl>

        {prompt !== undefined && (
          <section className="ai-panel__section" aria-labelledby={`${ids}-prompt`}>
            <h3 className="ai-panel__heading" id={`${ids}-prompt`}>
              {sent ? 'What we sent to Gemini' : 'What we would send to Gemini'}
            </h3>
            <p className="ai-panel__hint">
              Rebuilt in your browser by the same code the server runs. Your notes travel as data in
              a separate message, and the plan&apos;s totals are never sent.
            </p>
            <pre className="receipt" tabIndex={0} aria-labelledby={`${ids}-prompt`} dir="auto">
              {prompt}
            </pre>
          </section>
        )}

        {suggestions && (
          <>
            <section className="ai-panel__section" aria-labelledby={`${ids}-answer`}>
              <h3 className="ai-panel__heading" id={`${ids}-answer`}>
                What came back (validated)
              </h3>
              <p className="ai-panel__hint">
                Checked against this plan&apos;s response schema before the engine used it.
              </p>
              <pre className="receipt" tabIndex={0} aria-labelledby={`${ids}-answer`} dir="auto">
                {JSON.stringify(suggestions, null, 2)}
              </pre>
            </section>
            <section className="ai-panel__section" aria-labelledby={`${ids}-adjust`}>
              <h3 className="ai-panel__heading" id={`${ids}-adjust`}>
                Engine adjustments
              </h3>
              <p className="ai-panel__hint">
                The engine owns every number: AI values outside safe ranges are clamped or dropped,
                and each change is listed here. Your total budget never changes.
              </p>
              <Adjustments items={state.adjustments} />
            </section>
          </>
        )}
        <p className="ai-panel__footnote">
          {countOf(calls, 'AI call', 'AI calls')} this session. Editing guests, budget or dates
          never calls the AI.
        </p>
      </div>
    </details>
  );
}
