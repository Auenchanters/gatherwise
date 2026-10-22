/**
 * The four sections of the brief form: your event, people and money, preferences, and community
 * extras. Each is a fieldset whose legend is also a heading.
 * Does: lays out the fields of one section and edits the draft through `DraftApi` (draft.ts), whose
 * updates are all functional, so quick successive changes never overwrite each other.
 * Never does: own state, validate, or decide when a section shows (the form does).
 */
import { useId, type ReactElement, type ReactNode } from 'react';
import { addDays, type IsoDate } from '../../domain/dates.js';
import { LIMITS } from '../../shared/limits.js';
import {
  ACCESSIBILITY_OPTIONS,
  CURRENCIES,
  DIETARY_OPTIONS,
  EVENT_KINDS,
  LANGUAGES,
  SUBTYPES,
  VENUES,
} from '../../shared/options.js';
import { toggleOption, withKind, type BriefDraft, type DraftApi } from './draft.js';
import {
  ChoiceGroup,
  choiceId,
  Field,
  idOf,
  InputField,
  NumberField,
  SelectField,
  TextField,
} from './fields.js';
import {
  ACCESSIBILITY_LABELS,
  CURRENCY_LABELS,
  currencySymbol,
  DIETARY_LABELS,
  KIND_LABELS,
  LANGUAGE_LABELS,
  SUBTYPE_LABELS,
  VENUE_LABELS,
} from './labels.js';

const caps = LIMITS.brief;
const MONEY_HINT = 'Digits only, like 150000.';
type IncomeKey = keyof BriefDraft['income'];

function Section(props: {
  readonly title: string;
  readonly hint?: string;
  readonly children: ReactNode;
}): ReactElement {
  const hintId = useId();
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

/** Kind, subtype, name, date, time, length, city and venue. */
export function EventSection({
  api,
  today,
}: {
  readonly api: DraftApi;
  readonly today: IsoDate;
}): ReactElement {
  const { draft, errorOf, bind, update } = api;
  return (
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
            update((current) => withKind(current, kind));
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
            update((current) => ({ ...current, subtype }));
          },
        }))}
      />
      <TextField {...bind('name')} label="Event name" max={caps.nameMax} counter required />
      <div className="brief__row">
        <InputField
          {...bind('date')}
          label="Date"
          type="date"
          min={today}
          max={addDays(today, caps.horizonDays)}
        />
        <InputField {...bind('startTime')} label="Start time" type="time" />
        <NumberField
          {...bind('durationHours')}
          label="Duration (hours)"
          min={caps.durationHoursMin}
          max={caps.durationHoursMax}
          required
        />
      </div>
      <div className="brief__row">
        <TextField
          {...bind('city')}
          label="City or town (optional)"
          max={caps.cityMax}
          autoComplete="address-level2"
        />
        <SelectField {...bind('venue')} label="Venue" options={VENUES} labels={VENUE_LABELS} />
      </div>
    </Section>
  );
}

/** Guests, budget (with a currency prefix) and currency. */
export function MoneySection({ api }: { readonly api: DraftApi }): ReactElement {
  const { draft, bind } = api;
  return (
    <Section title="People and money">
      <div className="brief__row">
        <NumberField
          {...bind('guests')}
          label="Guests"
          hint="Your best estimate is fine."
          min={caps.guestsMin}
          max={caps.guestsMax}
          required
        />
        <NumberField
          {...bind('budget')}
          label="Total budget"
          hint={`${MONEY_HINT} In ${draft.currency}, for everything.`}
          min={caps.budgetMin}
          max={caps.budgetMax}
          prefix={currencySymbol(draft.currency)}
          required
        />
        <SelectField
          {...bind('currency')}
          label="Currency"
          options={CURRENCIES}
          labels={CURRENCY_LABELS}
        />
      </div>
    </Section>
  );
}

const FLAGS = [
  ['amplifiedSound', 'Amplified sound'],
  ['servesFood', 'Serving food'],
  ['servesAlcohol', 'Serving alcohol'],
] as const;

/** Dietary and accessibility needs, sound, food and alcohol, vibe, notes and the plan language. */
export function PreferencesSection({ api }: { readonly api: DraftApi }): ReactElement {
  const { draft, errorOf, bind, update } = api;
  const checkboxes = <T extends string>(
    field: 'dietary' | 'accessibility',
    options: readonly T[],
    labels: Readonly<Record<T, string>>,
  ) =>
    options.map((option, i) => ({
      id: choiceId(field, i, option),
      value: option,
      label: labels[option],
      checked: draft[field].includes(option),
      onChange: (on: boolean) => {
        update((current) => ({
          ...current,
          [field]: toggleOption(current[field], options, option, on),
        }));
      },
    }));
  return (
    <Section title="Preferences">
      <ChoiceGroup
        legend="Dietary needs"
        hint="Select all that apply."
        type="checkbox"
        name="dietary"
        field="dietary"
        error={errorOf('dietary')}
        choices={checkboxes('dietary', DIETARY_OPTIONS, DIETARY_LABELS)}
      />
      <ChoiceGroup
        legend="Accessibility needs"
        hint="Select all that apply."
        type="checkbox"
        name="accessibility"
        field="accessibility"
        error={errorOf('accessibility')}
        choices={checkboxes('accessibility', ACCESSIBILITY_OPTIONS, ACCESSIBILITY_LABELS)}
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
            update((current) => ({ ...current, [key]: on }));
          },
        }))}
      />
      <TextField
        {...bind('vibe')}
        label="Vibe (optional)"
        hint="A few words, like “warm, family-friendly, lantern-lit”."
        max={caps.vibeMax}
        counter
      />
      <Field
        field="notes"
        label="Notes (optional)"
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
              const notes = event.currentTarget.value;
              update((current) => ({ ...current, notes }));
            }}
          />
        )}
      </Field>
      <SelectField
        {...bind('language')}
        label="Language for AI suggestions"
        hint="Gemini writes the summary, ideas, extra tasks and vendor questions in this language. The app's own labels stay in English."
        options={LANGUAGES}
        labels={LANGUAGE_LABELS}
      />
    </Section>
  );
}

const INCOME_FIELDS: readonly (readonly [IncomeKey, string, number, string?])[] = [
  ['ticketPrice', 'Ticket price', caps.budgetMax, MONEY_HINT],
  ['expectedPaidAttendance', 'Expected paid attendance', caps.guestsMax],
  ['sponsors', 'Sponsorship', caps.budgetMax, MONEY_HINT],
  ['donations', 'Donations', caps.budgetMax, MONEY_HINT],
  ['stallCount', 'Number of stalls', caps.guestsMax],
  ['stallFee', 'Fee per stall', caps.budgetMax, MONEY_HINT],
];

/** Volunteers and expected income, for community events only. Both are optional. */
export function CommunitySection({ api }: { readonly api: DraftApi }): ReactElement {
  const { bind, bindIncome } = api;
  const incomeHintId = useId();
  return (
    <Section
      title="Community extras"
      hint="Used for volunteer shifts and to check whether the event breaks even."
    >
      <NumberField
        {...bind('volunteersAvailable')}
        label="Volunteers available (optional)"
        hint="Leave blank if none yet."
        min={0}
        max={caps.volunteersMax}
      />
      <fieldset className="choices" aria-describedby={incomeHintId}>
        <legend className="choices__legend">Expected income (optional)</legend>
        <p className="field__hint" id={incomeHintId}>
          Leave blank what you don&apos;t expect; blanks count as 0.
        </p>
        <div className="brief__grid">
          {INCOME_FIELDS.map(([key, label, max, hint]) => (
            <NumberField
              key={key}
              {...bindIncome(key)}
              label={label}
              hint={hint}
              min={0}
              max={max}
            />
          ))}
        </div>
      </fieldset>
    </Section>
  );
}
