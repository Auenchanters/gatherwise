/**
 * The event brief form: one page in four fieldsets (your event, people and money, preferences,
 * community extras), built from native controls only.
 * Does: holds a string draft; shows character counts that a polite live region announces only at
 * 20, 10 and 0 left; validates on submit with a GOV.UK error summary (focused, one link per error)
 * plus an inline message on each field, tied to it with aria-invalid and aria-describedby; and hands
 * a schema-valid brief to `onSubmit`.
 * Never does: validate while typing, call the API, read the clock (`today` is a prop), or use inline
 * styles (the CSP forbids them).
 */
import {
  useRef,
  useState,
  type SubmitEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';
import { flushSync } from 'react-dom';
import { addDays, type IsoDate } from '../../domain/dates.js';
import { LIMITS } from '../../shared/limits.js';
import {
  ACCESSIBILITY_OPTIONS,
  CURRENCIES,
  DIETARY_OPTIONS,
  EVENT_KINDS,
  SUBTYPES,
  VENUES,
  type EventBrief,
} from '../../shared/schema.js';
import './brief.css';
import { draftFromBrief, EMPTY_DRAFT, toggleOption, withKind, type BriefDraft } from './draft.js';
import {
  ACCESSIBILITY_LABELS,
  CURRENCY_LABELS,
  DIETARY_LABELS,
  KIND_LABELS,
  SUBTYPE_LABELS,
  VENUE_LABELS,
} from './labels.js';
import { validateBrief, type FieldError, type FieldKey } from './validate.js';

const caps = LIMITS.brief;
/** Counts that are announced to screen readers; every other count is only shown. */
const ANNOUNCE_AT: ReadonlySet<number> = new Set([20, 10, 0]);

/** The DOM id of a field's control; error summary links point here. */
const idOf = (field: FieldKey): string => `brief-${field.replace('.', '-')}`;
const charactersLeft = (left: number): string =>
  `${left} ${left === 1 ? 'character' : 'characters'} left`;
/** The symbol shown before the budget, e.g. ₹ for INR. */
const symbolOf = (currency: string): string =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency })
    .formatToParts(0)
    .find((part) => part.type === 'currency')?.value ?? currency;
/** Joins the ids that describe a control, or `undefined` when there are none. */
const describedBy = (ids: readonly (string | false)[]): string | undefined =>
  ids.filter((id) => id !== false).join(' ') || undefined;

/** The accessibility attributes a field hands to its control. */
interface ControlProps {
  readonly id: string;
  readonly 'aria-describedby': string | undefined;
  readonly 'aria-invalid': true | undefined;
}

interface FieldProps {
  readonly field: FieldKey;
  readonly label: string;
  readonly hint?: string | undefined;
  readonly error: string | undefined;
  /** Characters left, for text with a counter. */
  readonly left?: number | undefined;
  readonly children: (control: ControlProps) => ReactElement;
}

function ErrorMessage(props: { readonly id: string; readonly message: string }): ReactElement {
  return (
    <p className="field__error" id={props.id}>
      <span className="visually-hidden">Error: </span>
      {props.message}
    </p>
  );
}

/** A label, optional hint, inline error and counter around one control, all wired up by id. */
function Field({ field, label, hint, error, left, children }: FieldProps): ReactElement {
  const id = idOf(field);
  return (
    <div className={error === undefined ? 'field' : 'field field--error'}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {hint !== undefined && (
        <p className="field__hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {error !== undefined && <ErrorMessage id={`${id}-error`} message={error} />}
      {children({
        id,
        'aria-describedby': describedBy([
          hint !== undefined && `${id}-hint`,
          left !== undefined && `${id}-count`,
          error !== undefined && `${id}-error`,
        ]),
        'aria-invalid': error === undefined ? undefined : true,
      })}
      {left !== undefined && (
        <>
          <p className="field__count" id={`${id}-count`}>
            {charactersLeft(left)}
          </p>
          <p className="visually-hidden" aria-live="polite">
            {ANNOUNCE_AT.has(left) ? charactersLeft(left) : ''}
          </p>
        </>
      )}
    </div>
  );
}

interface TextFieldProps {
  readonly field: FieldKey;
  readonly label: string;
  readonly hint?: string;
  readonly error: string | undefined;
  readonly value: string;
  readonly max: number;
  readonly onChange: (value: string) => void;
  readonly counter?: boolean;
  readonly required?: boolean;
  readonly autoComplete?: string;
}

/** Free text from the user, so `dir="auto"` lets Hindi, Arabic or emoji lay out correctly. */
function TextField(props: TextFieldProps): ReactElement {
  const { field, label, hint, error, value, max, onChange } = props;
  return (
    <Field
      field={field}
      label={label}
      hint={hint}
      error={error}
      left={props.counter === true ? max - value.length : undefined}
    >
      {(control) => (
        <input
          {...control}
          className="field__input"
          name={field}
          type="text"
          dir="auto"
          autoComplete={props.autoComplete ?? 'off'}
          required={props.required}
          maxLength={max}
          value={value}
          onChange={(event) => {
            onChange(event.currentTarget.value);
          }}
        />
      )}
    </Field>
  );
}

interface NumberFieldProps {
  readonly field: FieldKey;
  readonly label: string;
  readonly hint?: string;
  readonly error: string | undefined;
  readonly value: string;
  readonly min: number;
  readonly max: number;
  readonly onChange: (value: string) => void;
  readonly required?: boolean;
  /** Text shown before the input, such as a currency symbol; hidden from screen readers. */
  readonly prefix?: string;
}

/** A whole-number input bounded by the schema's limits. */
function NumberField(props: NumberFieldProps): ReactElement {
  const { field, label, hint, error, value, min, max, onChange, prefix } = props;
  return (
    <Field field={field} label={label} hint={hint} error={error}>
      {(control) => {
        const input = (
          <input
            {...control}
            className="field__input field__input--number"
            name={field}
            type="number"
            inputMode="numeric"
            step={1}
            min={min}
            max={max}
            required={props.required}
            value={value}
            onChange={(event) => {
              onChange(event.currentTarget.value);
            }}
          />
        );
        if (prefix === undefined) return input;
        return (
          <div className="field__prefixed">
            <span className="field__prefix" aria-hidden="true">
              {prefix}
            </span>
            {input}
          </div>
        );
      }}
    </Field>
  );
}

/** One radio or checkbox; `onChange` gets the new checked state. */
interface Choice {
  readonly id: string;
  readonly value: string;
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}

interface ChoiceGroupProps {
  readonly legend: string;
  readonly type: 'radio' | 'checkbox';
  readonly name: string;
  readonly choices: readonly Choice[];
  readonly hint?: string;
  /** The field whose error shows inside this group; its first choice carries the field's id. */
  readonly field?: FieldKey;
  readonly error?: string | undefined;
}

/** A fieldset of native radios or checkboxes, with a hint and an error tied to the group. */
function ChoiceGroup(props: ChoiceGroupProps): ReactElement {
  const { legend, type, name, choices, hint, field, error } = props;
  const base = field === undefined ? `brief-${name}` : idOf(field);
  return (
    <fieldset
      className={error === undefined ? 'choices' : 'choices field--error'}
      aria-describedby={describedBy([
        hint !== undefined && `${base}-hint`,
        error !== undefined && `${base}-error`,
      ])}
    >
      <legend className="choices__legend">{legend}</legend>
      {hint !== undefined && (
        <p className="field__hint" id={`${base}-hint`}>
          {hint}
        </p>
      )}
      {error !== undefined && <ErrorMessage id={`${base}-error`} message={error} />}
      <div className={`choices__list choices__list--${type}`}>
        {choices.map((choice) => (
          <div className="choice" key={choice.value}>
            <input
              className="choice__input"
              id={choice.id}
              type={type}
              name={name}
              value={choice.value}
              checked={choice.checked}
              onChange={(event) => {
                choice.onChange(event.currentTarget.checked);
              }}
            />
            <label className="choice__label" htmlFor={choice.id}>
              {choice.label}
            </label>
          </div>
        ))}
      </div>
    </fieldset>
  );
}

/** A form section: a fieldset whose legend is also a heading, for heading navigation. */
function Section(props: {
  readonly title: string;
  readonly hint?: string;
  readonly children: ReactNode;
}): ReactElement {
  const hintId = `brief-${props.title.toLowerCase().replaceAll(' ', '-')}-hint`;
  return (
    <fieldset
      className="brief__section"
      aria-describedby={props.hint === undefined ? undefined : hintId}
    >
      <legend className="brief__legend">
        <h3 className="brief__section-title">{props.title}</h3>
      </legend>
      {props.hint !== undefined && (
        <p className="brief__section-hint" id={hintId}>
          {props.hint}
        </p>
      )}
      {props.children}
    </fieldset>
  );
}

/** The first choice of a group carries the field's id, so an error link lands on the group. */
const choiceId = (field: FieldKey, index: number, value: string): string =>
  index === 0 ? idOf(field) : `${idOf(field)}-${value}`;

const INCOME_FIELDS = [
  ['ticketPrice', 'Ticket price', caps.budgetMax],
  ['expectedPaidAttendance', 'Expected paid attendance', caps.guestsMax],
  ['sponsors', 'Sponsorship', caps.budgetMax],
  ['donations', 'Donations', caps.budgetMax],
  ['stallCount', 'Number of stalls', caps.guestsMax],
  ['stallFee', 'Fee per stall', caps.budgetMax],
] as const;

const FLAGS = [
  ['amplifiedSound', 'Amplified sound'],
  ['servesFood', 'Serving food'],
  ['servesAlcohol', 'Serving alcohol'],
] as const;

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
  const summaryRef = useRef<HTMLDivElement>(null);

  const set = <K extends keyof BriefDraft>(key: K, value: BriefDraft[K]): void => {
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const setIncome = (key: keyof BriefDraft['income'], value: string): void => {
    setDraft((current) => ({ ...current, income: { ...current.income, [key]: value } }));
  };
  const errorOf = (field: FieldKey): string | undefined =>
    errors.find((error) => error.field === field)?.message;

  const submit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const result = validateBrief(draft, today);
    if (result.ok) {
      setErrors([]);
      onSubmit(result.brief);
      return;
    }
    // Render the summary now, so it exists to take focus (the GOV.UK pattern).
    flushSync(() => {
      setErrors(result.errors);
    });
    summaryRef.current?.focus();
  };

  return (
    <form className="brief" noValidate aria-labelledby="brief-heading" onSubmit={submit}>
      <h2 className="brief__title" id="brief-heading" tabIndex={-1} ref={headingRef}>
        Tell us about your event
      </h2>
      <p className="brief__intro">
        A couple of minutes is enough. Gatherwise builds the budget, timeline and vendor checklist
        straight away, then Google Gemini adds ideas made for your event.
      </p>

      {errors.length > 0 && (
        <div
          className="error-summary"
          role="alert"
          tabIndex={-1}
          ref={summaryRef}
          aria-labelledby="brief-error-title"
        >
          <h3 className="error-summary__title" id="brief-error-title">
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
      )}

      <Section title="Your event">
        <ChoiceGroup
          legend="Kind of event"
          type="radio"
          name="kind"
          field="kind"
          error={errorOf('kind')}
          choices={EVENT_KINDS.map((kind, i) => ({
            id: choiceId('kind', i, kind),
            value: kind,
            label: KIND_LABELS[kind],
            checked: draft.kind === kind,
            onChange: () => {
              setDraft((current) => withKind(current, kind));
            },
          }))}
        />
        <ChoiceGroup
          legend="Type of event"
          type="radio"
          name="subtype"
          field="subtype"
          error={errorOf('subtype')}
          choices={SUBTYPES[draft.kind].map((subtype, i) => ({
            id: choiceId('subtype', i, subtype),
            value: subtype,
            label: SUBTYPE_LABELS[subtype],
            checked: draft.subtype === subtype,
            onChange: () => {
              set('subtype', subtype);
            },
          }))}
        />
        <TextField
          field="name"
          label="Event name"
          error={errorOf('name')}
          value={draft.name}
          max={caps.nameMax}
          counter
          required
          onChange={(value) => {
            set('name', value);
          }}
        />
        <div className="brief__row">
          <Field field="date" label="Date" error={errorOf('date')}>
            {(control) => (
              <input
                {...control}
                className="field__input"
                name="date"
                type="date"
                required
                min={today}
                max={addDays(today, caps.horizonDays)}
                value={draft.date}
                onChange={(event) => {
                  set('date', event.currentTarget.value);
                }}
              />
            )}
          </Field>
          <Field field="startTime" label="Start time" error={errorOf('startTime')}>
            {(control) => (
              <input
                {...control}
                className="field__input"
                name="startTime"
                type="time"
                required
                value={draft.startTime}
                onChange={(event) => {
                  set('startTime', event.currentTarget.value);
                }}
              />
            )}
          </Field>
          <NumberField
            field="durationHours"
            label="Duration (hours)"
            error={errorOf('durationHours')}
            value={draft.durationHours}
            min={caps.durationHoursMin}
            max={caps.durationHoursMax}
            required
            onChange={(value) => {
              set('durationHours', value);
            }}
          />
        </div>
        <div className="brief__row">
          <TextField
            field="city"
            label="City or town"
            error={errorOf('city')}
            value={draft.city}
            max={caps.cityMax}
            autoComplete="address-level2"
            onChange={(value) => {
              set('city', value);
            }}
          />
          <Field field="venue" label="Venue" error={errorOf('venue')}>
            {(control) => (
              <select
                {...control}
                className="field__input"
                name="venue"
                value={draft.venue}
                onChange={(event) => {
                  set('venue', event.currentTarget.value);
                }}
              >
                {VENUES.map((venue) => (
                  <option key={venue} value={venue}>
                    {VENUE_LABELS[venue]}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
      </Section>

      <Section title="People and money">
        <div className="brief__row">
          <NumberField
            field="guests"
            label="Guests"
            hint="Your best estimate is fine."
            error={errorOf('guests')}
            value={draft.guests}
            min={caps.guestsMin}
            max={caps.guestsMax}
            required
            onChange={(value) => {
              set('guests', value);
            }}
          />
          <NumberField
            field="budget"
            label="Total budget"
            hint={`In ${draft.currency}, for everything.`}
            error={errorOf('budget')}
            value={draft.budget}
            min={caps.budgetMin}
            max={caps.budgetMax}
            prefix={symbolOf(draft.currency)}
            required
            onChange={(value) => {
              set('budget', value);
            }}
          />
          <Field field="currency" label="Currency" error={errorOf('currency')}>
            {(control) => (
              <select
                {...control}
                className="field__input"
                name="currency"
                value={draft.currency}
                onChange={(event) => {
                  set('currency', event.currentTarget.value);
                }}
              >
                {CURRENCIES.map((currency) => (
                  <option key={currency} value={currency}>
                    {CURRENCY_LABELS[currency]}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
      </Section>

      <Section title="Preferences">
        <ChoiceGroup
          legend="Dietary needs"
          hint="Select all that apply."
          type="checkbox"
          name="dietary"
          field="dietary"
          error={errorOf('dietary')}
          choices={DIETARY_OPTIONS.map((option, i) => ({
            id: choiceId('dietary', i, option),
            value: option,
            label: DIETARY_LABELS[option],
            checked: draft.dietary.includes(option),
            onChange: (on) => {
              set('dietary', toggleOption(draft.dietary, DIETARY_OPTIONS, option, on));
            },
          }))}
        />
        <ChoiceGroup
          legend="Accessibility needs"
          hint="Select all that apply."
          type="checkbox"
          name="accessibility"
          field="accessibility"
          error={errorOf('accessibility')}
          choices={ACCESSIBILITY_OPTIONS.map((option, i) => ({
            id: choiceId('accessibility', i, option),
            value: option,
            label: ACCESSIBILITY_LABELS[option],
            checked: draft.accessibility.includes(option),
            onChange: (on) => {
              set(
                'accessibility',
                toggleOption(draft.accessibility, ACCESSIBILITY_OPTIONS, option, on),
              );
            },
          }))}
        />
        <ChoiceGroup
          legend="At the event"
          hint="Select all that apply."
          type="checkbox"
          name="flags"
          choices={FLAGS.map(([key, label]) => ({
            id: idOf(key),
            value: key,
            label,
            checked: draft[key],
            onChange: (on) => {
              set(key, on);
            },
          }))}
        />
        <TextField
          field="vibe"
          label="Vibe"
          hint="A few words, like “warm, family-friendly, lantern-lit”."
          error={errorOf('vibe')}
          value={draft.vibe}
          max={caps.vibeMax}
          counter
          onChange={(value) => {
            set('vibe', value);
          }}
        />
        <Field
          field="notes"
          label="Notes"
          hint="Anything else the plan should know. Please leave out personal details."
          error={errorOf('notes')}
          left={caps.notesMax - draft.notes.length}
        >
          {(control) => (
            <textarea
              {...control}
              className="field__input field__textarea"
              name="notes"
              dir="auto"
              rows={4}
              maxLength={caps.notesMax}
              value={draft.notes}
              onChange={(event) => {
                set('notes', event.currentTarget.value);
              }}
            />
          )}
        </Field>
      </Section>

      {draft.kind === 'community' && (
        <Section
          title="Community extras"
          hint="Used for volunteer shifts and to check whether the event breaks even."
        >
          <NumberField
            field="volunteersAvailable"
            label="Volunteers available"
            error={errorOf('volunteersAvailable')}
            value={draft.volunteersAvailable}
            min={0}
            max={caps.volunteersMax}
            onChange={(value) => {
              set('volunteersAvailable', value);
            }}
          />
          <fieldset className="choices" aria-describedby="brief-income-hint">
            <legend className="choices__legend">Expected income</legend>
            <p className="field__hint" id="brief-income-hint">
              Leave blank what you don&apos;t expect; blanks count as 0.
            </p>
            <div className="brief__grid">
              {INCOME_FIELDS.map(([key, label, max]) => (
                <NumberField
                  key={key}
                  field={`income.${key}`}
                  label={label}
                  error={errorOf(`income.${key}`)}
                  value={draft.income[key]}
                  min={0}
                  max={max}
                  onChange={(value) => {
                    setIncome(key, value);
                  }}
                />
              ))}
            </div>
          </fieldset>
        </Section>
      )}

      <div className="brief__actions">
        <button className="button button--primary" type="submit">
          Generate my plan
        </button>
        <p className="brief__note">
          Creating the plan uses one AI call. Changing guests, budget or dates afterwards uses none.
        </p>
      </div>
    </form>
  );
}
