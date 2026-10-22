/**
 * Submit-time validation for the brief form, in the GOV.UK error-summary style.
 * Does: parses the draft with `eventBriefSchema`, checks the date window with `eventDateOf`, and
 * turns every problem into one short, specific message per field, listed in the order the form
 * shows the fields. A past date is reported together with any other errors, not after them. A
 * number the browser could not read (`validity.badInput`) is reported as such, even where a blank
 * would count as 0, and an issue no message covers still fails visibly.
 * Never does: show the schema's own wording to people, read the clock (`today` is a parameter), or
 * touch the DOM.
 */
import type { z } from 'zod';
import type { IsoDate } from '../../domain/dates.js';
import { eventDateOf } from '../../domain/schedule.js';
import { LIMITS } from '../../shared/limits.js';
import { eventBriefSchema, type EventBrief } from '../../shared/schema.js';
import { formatCount } from '../plan/format.js';
import { draftToCandidate, type BriefDraft } from './draft.js';
import { DATE_COPY } from './labels.js';

/** A form field that can carry an error: a draft key, or `income.<key>` for an income field. */
export type FieldKey = Exclude<keyof BriefDraft, 'income'> | `income.${keyof BriefDraft['income']}`;

/** One problem to show: in the error summary, and inline beside the field. */
export interface FieldError {
  readonly field: FieldKey;
  readonly message: string;
}

/** The outcome of a submit: the validated brief, or the errors in form order. */
export type BriefValidation =
  | { readonly ok: true; readonly brief: EventBrief }
  | { readonly ok: false; readonly errors: readonly FieldError[] };

/**
 * A field's messages: `empty` when it was left blank, `tooSmall` under its minimum, `digits` when
 * the browser could not read what was typed as a number, else `invalid`.
 */
interface Copy {
  readonly invalid: string;
  readonly empty?: string;
  readonly tooSmall?: string;
  readonly digits?: string;
}

const { brief: caps } = LIMITS;
const whole = (label: string, min: number, max: number): string =>
  `${label} must be a whole number from ${formatCount(min)} to ${formatCount(max)}`;
const longest = (label: string, max: number): string =>
  `${label} must be ${formatCount(max)} characters or fewer`;
const MONEY_DIGITS = 'Enter the amount as digits only, like 150000';
const COUNT_DIGITS = 'Enter digits only, like 12';
/** Shown when the schema rejects something no message covers, so a submit never fails silently. */
const FALLBACK = 'Check the highlighted details';

// Written in the order the form shows the fields; FIELD_KEYS reads the order back from here.
const COPY = {
  kind: { invalid: 'Choose the kind of event' },
  subtype: { invalid: 'Choose the type of event' },
  name: { empty: 'Enter the event name', invalid: longest('Event name', caps.nameMax) },
  date: { invalid: 'Enter the event date' },
  startTime: { invalid: 'Enter a start time, like 18:00' },
  durationHours: {
    digits: COUNT_DIGITS,
    empty: 'Enter how many hours the event lasts',
    invalid: `Duration must be a whole number of hours from ${formatCount(caps.durationHoursMin)} to ${formatCount(caps.durationHoursMax)}`,
  },
  city: { invalid: longest('City', caps.cityMax) },
  venue: { invalid: 'Choose a type of venue' },
  guests: {
    digits: COUNT_DIGITS,
    empty: 'Enter the number of guests',
    invalid: whole('Guests', caps.guestsMin, caps.guestsMax),
  },
  budget: {
    digits: MONEY_DIGITS,
    empty: `Enter a budget of at least ${formatCount(caps.budgetMin)}`,
    tooSmall: `Enter a budget of at least ${formatCount(caps.budgetMin)}`,
    invalid: whole('Budget', caps.budgetMin, caps.budgetMax),
  },
  currency: { invalid: 'Choose a currency' },
  dietary: { invalid: `Choose each dietary need once, up to ${formatCount(caps.listMax)}` },
  accessibility: {
    invalid: `Choose each accessibility need once, up to ${formatCount(caps.listMax)}`,
  },
  amplifiedSound: { invalid: 'Say whether there will be amplified sound' },
  servesFood: { invalid: 'Say whether you will serve food' },
  servesAlcohol: { invalid: 'Say whether you will serve alcohol' },
  vibe: { invalid: longest('Vibe', caps.vibeMax) },
  notes: { invalid: longest('Notes', caps.notesMax) },
  language: { invalid: 'Choose a language for the plan' },
  volunteersAvailable: {
    digits: COUNT_DIGITS,
    invalid: whole('Volunteers', 0, caps.volunteersMax),
  },
  'income.ticketPrice': {
    digits: MONEY_DIGITS,
    invalid: whole('Ticket price', 0, caps.budgetMax),
  },
  'income.expectedPaidAttendance': {
    digits: COUNT_DIGITS,
    invalid: whole('Paid attendance', 0, caps.guestsMax),
  },
  'income.sponsors': { digits: MONEY_DIGITS, invalid: whole('Sponsorship', 0, caps.budgetMax) },
  'income.donations': { digits: MONEY_DIGITS, invalid: whole('Donations', 0, caps.budgetMax) },
  'income.stallCount': {
    digits: COUNT_DIGITS,
    invalid: whole('Number of stalls', 0, caps.guestsMax),
  },
  'income.stallFee': { digits: MONEY_DIGITS, invalid: whole('Fee per stall', 0, caps.budgetMax) },
} satisfies Record<FieldKey, Copy>;

const isFieldKey = (key: string): key is FieldKey => Object.hasOwn(COPY, key);
/** Every field, in form order; errors are listed in this order. */
const FIELD_KEYS: readonly FieldKey[] = Object.keys(COPY).filter(isFieldKey);

/** The field an issue belongs to, as a FieldKey-shaped string (`income.sponsors`, `dietary`...). */
const keyOf = (path: readonly PropertyKey[]): string =>
  path[0] === 'income' ? `income.${String(path[1])}` : String(path[0]);

const isBlank = (input: unknown): boolean =>
  input === undefined || (typeof input === 'string' && input.trim() === '');

function messageFor(copy: Copy, issue: z.core.$ZodIssue): string {
  if (isBlank(issue.input)) return copy.empty ?? copy.invalid;
  if (issue.code === 'too_small') return copy.tooSmall ?? copy.invalid;
  return copy.invalid;
}

/**
 * Validates a draft on submit. Success carries the schema's parsed brief (text trimmed); failure
 * carries one message per invalid field, in form order. The date window is checked even when other
 * fields fail, so every problem shows at once. `unreadable` names the number inputs whose
 * `validity.badInput` was set: the browser saw text it could not read as a number and reported
 * an empty value instead.
 */
export function validateBrief(
  draft: BriefDraft,
  today: IsoDate,
  unreadable: readonly string[] = [],
): BriefValidation {
  const parsed = eventBriefSchema.safeParse(draftToCandidate(draft), { reportInput: true });
  const issues = parsed.error?.issues ?? [];
  const dateCheck = eventDateOf({ date: draft.date }, today);
  const errors = FIELD_KEYS.flatMap((field): FieldError[] => {
    const copy: Copy = COPY[field];
    if (copy.digits !== undefined && unreadable.includes(field)) {
      return [{ field, message: copy.digits }];
    }
    const issue = issues.find((candidate) => keyOf(candidate.path) === field);
    if (issue) return [{ field, message: messageFor(copy, issue) }];
    if (field === 'date' && !dateCheck.ok) return [{ field, message: DATE_COPY[dateCheck.error] }];
    return [];
  });
  if (parsed.success && errors.length === 0) return { ok: true, brief: parsed.data };
  // 'kind' is the form's first field, so the fallback points somewhere visible.
  return { ok: false, errors: errors.length > 0 ? errors : [{ field: 'kind', message: FALLBACK }] };
}
