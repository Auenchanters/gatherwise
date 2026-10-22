/**
 * The "AI at work" panel: the one model call made visible. It shows the exact prompt (rebuilt in
 * the browser by the same `buildPrompt` the server runs, from the brief that was sent), the
 * validated answer, every change the engine made to it, and the call's model, latency, tokens and
 * the session's AI-call count.
 * Does: offer the only button here that may call the AI ("Personalize with AI", then "Try again"
 * after a failure); it goes through the store's command. The button stays mounted and
 * `aria-disabled` while the request is pending, so it keeps keyboard focus; when the answer lands
 * and the button goes away, focus moves to the line that reports the answer.
 * Never does: call the AI on render or in an effect (the effect only moves focus), or show AI text
 * without saying so.
 */
import { useEffect, useId, useMemo, useRef, type ReactElement } from 'react';
import type { IsoDate } from '../../domain/dates.js';
import type { Adjustment } from '../../domain/merge.js';
import { buildPlan } from '../../domain/plan.js';
import type { ReadyState } from '../../domain/reducer.js';
import { buildPrompt } from '../../shared/prompt.js';
import type { AdjustRequest, EventBrief } from '../../shared/schema.js';
import { callCount, formatCount } from './format.js';
import type { AiView } from './planner-store.js';
import './ai-panel.css';

const ADJUSTMENT_LABELS: Record<Adjustment['kind'], string> = {
  clamped: 'Clamped',
  dropped: 'Dropped',
  truncated: 'Shortened',
};

const IDLE_TEXT =
  'This plan uses standard suggestions so far. Gemini can personalize the ideas, add tasks and suggest questions for your vendors.';
const FAILED_FALLBACK = "The AI request didn't go through.";

/**
 * The prompt for `brief` (and `adjust`, when it was an adjustment) as the server builds it: the
 * fixed system instruction, then the JSON data block pretty-printed. Undefined when the brief can
 * no longer be planned (its date passed).
 */
function promptText(
  brief: EventBrief,
  today: IsoDate,
  adjust: AdjustRequest | undefined,
): string | undefined {
  const plan = buildPlan(brief, today);
  if (!plan.ok) return undefined;
  const { system, user } = buildPrompt(plan.value, adjust);
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

/** What happened with the AI for this plan, and the button to ask it. */
function AiStatus({ state, aiView, onPersonalize }: Omit<AiPanelProps, 'calls'>): ReactElement {
  const { status, meta } = state.ai;
  const answer = useRef<HTMLParagraphElement>(null);
  /** Whether the button last held focus. Removing a focused element fires no blur, so this stays set. */
  const hadFocus = useRef(false);

  // The button is gone once an answer lands; focus it held moves to the line that reports it.
  useEffect(() => {
    if (status === 'applied' && hadFocus.current) {
      hadFocus.current = false;
      answer.current?.focus();
    }
  }, [status]);

  if (status === 'applied') {
    let source = `Personalized by ${meta?.model ?? 'Gemini'} in one call.`;
    if (aiView.cached) source = 'Reused the answer for this exact brief — no new AI call.';
    else if (aiView.sentBrief === undefined) {
      source = 'Restored with your saved plan — no new AI call.';
    }
    return (
      <p className="ai-panel__status ai-panel__status--done" tabIndex={-1} ref={answer}>
        <span aria-hidden="true">✓</span>
        {source}
      </p>
    );
  }
  const pending = status === 'pending';
  const failed = status === 'failed';
  let label = 'Personalize with AI (1 call)';
  if (pending) label = 'Personalizing…';
  else if (failed) label = 'Try again';
  // One element tree for idle, pending and failed, so the button a click lands on is the same
  // button while it waits. `aria-disabled`, not `disabled`: it keeps focus (as Adjust with AI does).
  return (
    <div className={failed ? 'ai-panel__status ai-panel__status--failed' : 'ai-panel__status'}>
      {pending ? (
        <p className="ai-panel__progress">
          <span className="spinner" aria-hidden="true" />
          Gemini is personalizing your plan…
        </p>
      ) : (
        <p>{failed ? (aiView.failure ?? FAILED_FALLBACK) : IDLE_TEXT}</p>
      )}
      <button
        className={`button ${failed ? 'button--secondary' : 'button--primary'}`}
        type="button"
        aria-disabled={pending}
        onFocus={() => {
          hadFocus.current = true;
        }}
        onBlur={() => {
          hadFocus.current = false;
        }}
        onClick={() => {
          if (!pending) onPersonalize();
        }}
      >
        {label}
      </button>
    </div>
  );
}

/** The engine's changes to the answer, each as a kind badge and one sentence. */
function Adjustments({ items }: { readonly items: readonly Adjustment[] }): ReactElement {
  if (items.length === 0) {
    return <p>No adjustments needed — every AI value was within range.</p>;
  }
  return (
    <ul className="adjustments">
      {/* The list is rebuilt whole from each answer and never reordered, so the index is a stable key. */}
      {items.map((item, index) => (
        <li className="adjustments__item" key={index}>
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
  // Keyed on the brief the prompt is for: once one was sent, edits do not rebuild it.
  const source = sent ?? state.brief;
  const { adjust } = aiView;
  const prompt = useMemo(
    () => promptText(source, state.today, adjust),
    [source, state.today, adjust],
  );
  const answerJson = useMemo(
    () => (suggestions ? JSON.stringify(suggestions, null, 2) : undefined),
    [suggestions],
  );
  return (
    <details className="ai-panel" open>
      <summary className="ai-panel__summary">
        <span className="ai-panel__icon" aria-hidden="true">
          ✦
        </span>
        AI at work
      </summary>
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
            <dd>{callCount(calls, state.ai.status === 'pending')}</dd>
          </div>
        </dl>

        {/* Each receipt is a named, focusable region, so keyboard users can find and scroll it. */}
        {prompt !== undefined && (
          <section className="ai-panel__section">
            <h3 className="ai-panel__heading" id={`${ids}-prompt`}>
              {sent ? 'What we sent to Gemini' : 'What we would send to Gemini'}
            </h3>
            <p className="ai-panel__hint">
              Rebuilt in your browser by the same code the server runs. Your notes travel as data in
              a separate message. Your total budget figure is not sent: each category&apos;s share
              of it is, and together they make the budget minus the 10% contingency. Income is never
              sent.
            </p>
            <pre
              className="receipt"
              role="region"
              tabIndex={0}
              aria-labelledby={`${ids}-prompt`}
              dir="auto"
            >
              {prompt}
            </pre>
          </section>
        )}

        {answerJson !== undefined && (
          <>
            <section className="ai-panel__section">
              <h3 className="ai-panel__heading" id={`${ids}-answer`}>
                What came back (validated)
              </h3>
              <p className="ai-panel__hint">
                Checked against this plan&apos;s response schema before the engine used it.
              </p>
              <pre
                className="receipt"
                role="region"
                tabIndex={0}
                aria-labelledby={`${ids}-answer`}
                dir="auto"
              >
                {answerJson}
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
      </div>
    </details>
  );
}
