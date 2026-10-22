/**
 * The brief form's draft: every field as the browser holds it (text inputs give strings), plus the
 * conversions to and from an `EventBrief`.
 * Does: turns a brief into strings for the inputs, and turns a draft into a plain candidate object
 * for `eventBriefSchema` to validate. Numbers must be plain decimals (no hex, exponents or
 * grouping) and go through `Number`; a blank required number, date or time becomes a missing value
 * so the schema reports it. Volunteers and income are optional (blank means 0) and count only for
 * community events.
 * Also builds `DraftApi`, the typed, functional-update bindings the form's sections edit through.
 * Never does: validate (that is validate.ts and the schema), read the clock, or touch the DOM.
 */
import { SUBTYPES } from '../../shared/options.js';
import type { EventBrief } from '../../shared/schema.js';
import type { FieldError, FieldKey } from './validate.js';

type EventKind = EventBrief['kind'];
type Income = NonNullable<Extract<EventBrief, { kind: 'community' }>['income']>;

/** The form's working copy of a brief. Free-form values stay strings until submit. */
export interface BriefDraft {
  readonly kind: EventKind;
  readonly subtype: string;
  readonly name: string;
  readonly date: string;
  readonly startTime: string;
  readonly durationHours: string;
  readonly city: string;
  readonly venue: string;
  readonly guests: string;
  readonly budget: string;
  readonly currency: string;
  readonly dietary: readonly string[];
  readonly accessibility: readonly string[];
  readonly amplifiedSound: boolean;
  readonly servesFood: boolean;
  readonly servesAlcohol: boolean;
  readonly volunteersAvailable: string;
  readonly vibe: string;
  readonly notes: string;
  readonly language: string;
  readonly income: Readonly<Record<keyof Income, string>>;
}

/** Draft keys holding free text, which a text, number, date or select input edits directly. */
type TextKey = {
  [K in keyof BriefDraft]: string extends BriefDraft[K] ? K : never;
}[keyof BriefDraft];

/** Applies `f` to each of the six income fields, keeping their names. */
const mapIncome = <T, U>(
  income: Readonly<Record<keyof Income, T>>,
  f: (value: T) => U,
): Record<keyof Income, U> => ({
  ticketPrice: f(income.ticketPrice),
  expectedPaidAttendance: f(income.expectedPaidAttendance),
  sponsors: f(income.sponsors),
  donations: f(income.donations),
  stallCount: f(income.stallCount),
  stallFee: f(income.stallFee),
});

const isBlank = (s: string): boolean => s.trim() === '';
/** A plain decimal: optional minus, digits, optional point. `Number` alone would accept `0x10`. */
const DECIMAL = /^-?(?:\d+\.?\d*|\.\d+)$/u;
/**
 * A blank string becomes `undefined` (missing), a plain decimal its number (with -0 as 0), and
 * anything else `NaN`, which the schema rejects.
 */
function toNumber(s: string): number | undefined {
  const text = s.trim();
  if (text === '') return undefined;
  if (!DECIMAL.test(text)) return Number.NaN;
  const n = Number(text);
  return n === 0 ? 0 : n; // -0 === 0, so this also turns -0 into 0
}
const orMissing = (s: string): string | undefined => (isBlank(s) ? undefined : s);

const BLANK_INCOME: BriefDraft['income'] = {
  ticketPrice: '',
  expectedPaidAttendance: '',
  sponsors: '',
  donations: '',
  stallCount: '',
  stallFee: '',
};

/** A fresh form: a community festival with defaults for time and length, the rest left blank. */
export const EMPTY_DRAFT: BriefDraft = {
  kind: 'community',
  subtype: SUBTYPES.community[0],
  name: '',
  date: '',
  startTime: '18:00',
  durationHours: '4',
  city: '',
  venue: 'indoor_hall',
  guests: '',
  budget: '',
  currency: 'INR',
  dietary: [],
  accessibility: [],
  amplifiedSound: false,
  servesFood: false,
  servesAlcohol: false,
  volunteersAvailable: '',
  vibe: '',
  notes: '',
  language: 'English',
  income: BLANK_INCOME,
};

/** The draft that shows `brief` in the form, e.g. to edit it or to load a sample. */
export function draftFromBrief(brief: EventBrief): BriefDraft {
  return {
    ...brief,
    durationHours: String(brief.durationHours),
    guests: String(brief.guests),
    budget: String(brief.budget),
    volunteersAvailable: String(brief.volunteersAvailable),
    income:
      brief.kind === 'community' && brief.income
        ? mapIncome(brief.income, (n) => String(n))
        : BLANK_INCOME,
  };
}

/**
 * The object the schema validates. Weddings and birthdays get 0 volunteers and no income (the
 * form hides those fields). Blank volunteers count as 0. Income is left out when all six
 * fields are blank; once any is filled, a blank one counts as 0.
 */
export function draftToCandidate(draft: BriefDraft): Record<string, unknown> {
  const community = draft.kind === 'community';
  const hasIncome = community && Object.values(draft.income).some((value) => !isBlank(value));
  return {
    kind: draft.kind,
    subtype: draft.subtype,
    name: draft.name,
    date: orMissing(draft.date),
    startTime: orMissing(draft.startTime),
    durationHours: toNumber(draft.durationHours),
    city: draft.city,
    venue: draft.venue,
    guests: toNumber(draft.guests),
    budget: toNumber(draft.budget),
    currency: draft.currency,
    dietary: draft.dietary,
    accessibility: draft.accessibility,
    amplifiedSound: draft.amplifiedSound,
    servesFood: draft.servesFood,
    servesAlcohol: draft.servesAlcohol,
    volunteersAvailable: community ? (toNumber(draft.volunteersAvailable) ?? 0) : 0,
    vibe: draft.vibe,
    notes: draft.notes,
    language: draft.language,
    ...(hasIncome ? { income: mapIncome(draft.income, (value) => toNumber(value) ?? 0) } : {}),
  };
}

/** The draft with a new kind; the subtype resets to that kind's first, since none are shared. */
export function withKind(draft: BriefDraft, kind: EventKind): BriefDraft {
  return { ...draft, kind, subtype: SUBTYPES[kind][0] };
}

/**
 * The ticked options after ticking (`on`) or unticking `value`, always in `options` order, so the
 * same choices make the same brief (and the same AI cache key) whatever order they were ticked in.
 */
export function toggleOption(
  selected: readonly string[],
  options: readonly string[],
  value: string,
  on: boolean,
): string[] {
  return options.filter((option) => (option === value ? on : selected.includes(option)));
}

/** What a form hands every bound field: its key, its error, its value and how to change it. */
export interface Bound {
  readonly field: FieldKey;
  readonly error: string | undefined;
  readonly value: string;
  readonly onChange: (value: string) => void;
}

/** What a section needs from the form: the draft, its errors and typed ways to change it. */
export interface DraftApi {
  readonly draft: BriefDraft;
  readonly errorOf: (field: FieldKey) => string | undefined;
  /** Props that bind a text, number, date or select field to a free-text draft key. */
  readonly bind: (key: TextKey) => Bound;
  readonly bindIncome: (key: keyof BriefDraft['income']) => Bound;
  readonly update: (change: (draft: BriefDraft) => BriefDraft) => void;
}

/** Builds the {@link DraftApi} for a draft held in state, with its current errors. */
export function draftApi(
  draft: BriefDraft,
  setDraft: (change: (draft: BriefDraft) => BriefDraft) => void,
  errors: readonly FieldError[],
): DraftApi {
  const errorOf = (field: FieldKey): string | undefined =>
    errors.find((error) => error.field === field)?.message;
  return {
    draft,
    errorOf,
    update: setDraft,
    bind: (key) => ({
      field: key,
      error: errorOf(key),
      value: draft[key],
      onChange: (value) => {
        setDraft((current) => ({ ...current, [key]: value }));
      },
    }),
    bindIncome: (key) => ({
      field: `income.${key}`,
      error: errorOf(`income.${key}`),
      value: draft.income[key],
      onChange: (value) => {
        setDraft((current) => ({ ...current, income: { ...current.income, [key]: value } }));
      },
    }),
  };
}
