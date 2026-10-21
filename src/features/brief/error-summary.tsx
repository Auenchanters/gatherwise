/**
 * The GOV.UK error summary at the top of the brief form: a focusable alert headed "There's a
 * problem", with one link per error that moves focus to the field it names.
 * Never does: decide what is wrong (validate.ts does) or take focus by itself (the form focuses it
 * once it has rendered).
 */
import { useId, type ReactElement, type Ref } from 'react';
import { idOf } from './fields.js';
import type { FieldError } from './validate.js';

interface ErrorSummaryProps {
  readonly errors: readonly FieldError[];
  readonly ref: Ref<HTMLDivElement>;
}

/** Lists every error as a link to its field; render it only when there are errors. */
export function ErrorSummary({ errors, ref }: ErrorSummaryProps): ReactElement {
  const titleId = useId();
  return (
    <div className="error-summary" role="alert" tabIndex={-1} ref={ref} aria-labelledby={titleId}>
      <h3 className="error-summary__title" id={titleId}>
        There&apos;s a problem
      </h3>
      <ul className="error-summary__list">
        {errors.map((error) => (
          <li key={error.field}>
            <a
              href={`#${idOf(error.field)}`}
              onClick={(event) => {
                event.preventDefault();
                document.getElementById(idOf(error.field))?.focus();
              }}
            >
              {error.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
