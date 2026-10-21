/**
 * The brief form's building blocks: a labelled field with hint, inline error and character counter;
 * text, number, date, time and select inputs; and radio and checkbox groups.
 * Does: wires every label, hint, count and error to its control by id, so aria-describedby and
 * aria-invalid always agree with what is on screen. Counts are announced politely only at 20, 10
 * and 0 characters left.
 * Never does: hold form state, validate, or use inline styles.
 */
import { useId, type ReactElement } from 'react';
import type { Bound } from './draft.js';
import type { FieldKey } from './validate.js';

/** Counts that are announced to screen readers; every other count is only shown. */
const ANNOUNCE_AT: ReadonlySet<number> = new Set([20, 10, 0]);

/** The DOM id of a field's control; error summary links point here. */
export const idOf = (field: FieldKey): string => `brief-${field.replace('.', '-')}`;

/** The first choice of a group carries the field's id, so an error link lands on the group. */
export const choiceId = (field: FieldKey, index: number, value: string): string =>
  index === 0 ? idOf(field) : `${idOf(field)}-${value}`;

const charactersLeft = (left: number): string =>
  `${left} ${left === 1 ? 'character' : 'characters'} left`;

/** Joins the ids that describe a control, or `undefined` when there are none. */
const describedBy = (ids: readonly (string | false)[]): string | undefined =>
  ids.filter((id) => id !== false).join(' ') || undefined;

/** The accessibility attributes a field hands to its control. */
interface ControlProps {
  readonly id: string;
  readonly 'aria-describedby': string | undefined;
  readonly 'aria-invalid': true | undefined;
}

function ErrorMessage(props: { readonly id: string; readonly message: string }): ReactElement {
  return (
    <p className="field__error" id={props.id}>
      <span className="visually-hidden">Error: </span>
      {props.message}
    </p>
  );
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

/** A label, optional hint, inline error and counter around one control, all wired up by id. */
export function Field({ field, label, hint, error, left, children }: FieldProps): ReactElement {
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
          <p className="visually-hidden" id={`${id}-announce`} aria-live="polite">
            {ANNOUNCE_AT.has(left) ? charactersLeft(left) : ''}
          </p>
        </>
      )}
    </div>
  );
}

interface TextFieldProps extends Bound {
  readonly label: string;
  readonly max: number;
  readonly hint?: string | undefined;
  readonly counter?: boolean;
  readonly required?: boolean;
  readonly autoComplete?: string;
}

/** Free text from the user, so `dir="auto"` lets Hindi, Arabic or emoji lay out correctly. */
export function TextField(props: TextFieldProps): ReactElement {
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

interface NumberFieldProps extends Bound {
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly hint?: string | undefined;
  readonly required?: boolean;
  /** Text shown before the input, such as a currency symbol; hidden from screen readers. */
  readonly prefix?: string;
}

/** A whole-number input bounded by the schema's limits. Its `name` is the field key. */
export function NumberField(props: NumberFieldProps): ReactElement {
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

interface InputFieldProps extends Bound {
  readonly label: string;
  readonly type: 'date' | 'time';
  readonly min?: string;
  readonly max?: string;
}

/** A native date or time picker; the browser supplies the calendar or clock. */
export function InputField(props: InputFieldProps): ReactElement {
  const { field, label, error, value, onChange, type } = props;
  return (
    <Field field={field} label={label} error={error}>
      {(control) => (
        <input
          {...control}
          className="field__input"
          name={field}
          type={type}
          required
          min={props.min}
          max={props.max}
          value={value}
          onChange={(event) => {
            onChange(event.currentTarget.value);
          }}
        />
      )}
    </Field>
  );
}

interface SelectFieldProps<T extends string> extends Bound {
  readonly label: string;
  readonly options: readonly T[];
  readonly labels: Readonly<Record<T, string>>;
}

/** A native select over a fixed option list, showing each option's label. */
export function SelectField<T extends string>(props: SelectFieldProps<T>): ReactElement {
  const { field, label, error, value, onChange, options, labels } = props;
  return (
    <Field field={field} label={label} error={error}>
      {(control) => (
        <select
          {...control}
          className="field__input"
          name={field}
          value={value}
          onChange={(event) => {
            onChange(event.currentTarget.value);
          }}
        >
          {options.map((option) => (
            <option key={option} value={option}>
              {labels[option]}
            </option>
          ))}
        </select>
      )}
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
export function ChoiceGroup(props: ChoiceGroupProps): ReactElement {
  const { legend, type, name, choices, hint, field, error } = props;
  const generated = useId();
  const base = field === undefined ? generated : idOf(field);
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
