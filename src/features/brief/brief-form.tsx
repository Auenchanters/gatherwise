/**
 * The event brief form: one page of four sections (sections.tsx) built from native controls.
 * Does: holds the string draft and the errors; warms the checker chunk (use-checker.ts) when the
 * submit button is focused or pressed and awaits it on submit; then either hands a schema-valid
 * brief to `onSubmit` or shows the GOV.UK error summary and moves focus to it. Number inputs the
 * browser could not read (`validity.badInput`) are reported as such.
 * Never does: validate while typing, call the API, read the clock (`today` is a prop), or submit a
 * brief from a form that was replaced while the checker loaded.
 */
import { useId, useRef, useState, type ReactElement, type Ref, type SubmitEvent } from 'react';
import type { IsoDate } from '../../domain/dates.js';
import type { EventBrief } from '../../shared/schema.js';
import { focusAfter } from '../../ui/focus.js';
import './brief.css';
import { draftApi, draftFromBrief, EMPTY_DRAFT } from './draft.js';
import { ErrorSummary } from './error-summary.js';
import { CommunitySection, EventSection, MoneySection, PreferencesSection } from './sections.js';
import { useChecker, type CheckerNotice } from './use-checker.js';
import type { FieldError } from './validate.js';

const NOTICE_COPY: Record<CheckerNotice, string> = {
  none: '',
  checking: 'Checking your details…',
  failed:
    "We couldn't check your details — check your connection, then try again or reload the page.",
};

/** Names of number inputs holding text the browser could not read as a number. */
const unreadableNumbers = (form: HTMLFormElement): string[] =>
  [...form.elements].flatMap((element) =>
    element instanceof HTMLInputElement && element.validity.badInput ? [element.name] : [],
  );

/** Props for {@link BriefForm}. */
export interface BriefFormProps {
  /** A brief to start from (a sample, or the current plan when editing); blank when absent. */
  readonly initial?: EventBrief | undefined;
  /** The local date; it bounds the date picker and the date check. */
  readonly today: IsoDate;
  /** Called with the validated brief when the form is submitted without errors. */
  readonly onSubmit: (brief: EventBrief) => void;
  /** Receives the form heading, so the page can move focus to it after filling the form. */
  readonly headingRef?: Ref<HTMLHeadingElement>;
}

/** The single-page event brief form. Remount it (change its `key`) to load another `initial`. */
export function BriefForm({ initial, today, onSubmit, headingRef }: BriefFormProps): ReactElement {
  const [draft, setDraft] = useState(() =>
    initial === undefined ? EMPTY_DRAFT : draftFromBrief(initial),
  );
  const [errors, setErrors] = useState<readonly FieldError[]>([]);
  const { checking, notice, warm, withChecker } = useChecker();
  const summaryRef = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const api = draftApi(draft, setDraft, errors);

  const submit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (checking) return;
    const unreadable = unreadableNumbers(event.currentTarget);
    void withChecker(({ validateBrief }) => {
      const result = validateBrief(draft, today, unreadable);
      if (result.ok) {
        setErrors([]);
        onSubmit(result.brief);
        return;
      }
      // Render the summary now, so it exists to take focus (the GOV.UK pattern).
      focusAfter(
        () => {
          setErrors(result.errors);
        },
        () => summaryRef.current,
      );
    });
  };

  return (
    <form className="brief" noValidate aria-labelledby={headingId} onSubmit={submit}>
      <h2 className="brief__title" id={headingId} tabIndex={-1} ref={headingRef}>
        Tell us about your event
      </h2>
      <p className="brief__intro">
        A couple of minutes is enough. Gatherwise builds the budget, timeline and vendor checklist
        straight away, then Google Gemini adds ideas made for your event.
      </p>
      {errors.length > 0 && <ErrorSummary errors={errors} ref={summaryRef} />}

      <EventSection api={api} today={today} />
      <MoneySection api={api} />
      <PreferencesSection api={api} />
      {draft.kind === 'community' && <CommunitySection api={api} />}

      <div className="brief__actions">
        {/* aria-disabled, not disabled, so a keyboard user's focus stays on the button. */}
        <button
          className="button button--primary"
          type="submit"
          aria-disabled={checking ? true : undefined}
          onFocus={warm}
          onPointerDown={warm}
        >
          Generate my plan
        </button>
        <p className="brief__note">
          Creating the plan uses one AI call. Changing guests, budget or dates afterwards uses none.
        </p>
        <p
          className={notice === 'failed' ? 'brief__status brief__status--warning' : 'brief__status'}
          role="status"
        >
          {notice === 'failed' && (
            <span className="brief__status-icon" aria-hidden="true">
              ⚠︎
            </span>
          )}
          {NOTICE_COPY[notice]}
        </p>
      </div>
    </form>
  );
}
