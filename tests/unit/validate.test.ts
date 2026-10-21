/**
 * Tests for src/features/brief/validate.ts, the brief form's submit-time validation.
 *
 * Does: walks every field's human message (blank, too small, out of range, too long), every date
 * reason from `eventDateOf`, the one-error-per-field rule and the form-order listing, and checks a
 * valid draft comes back as the schema's (trimmed) brief.
 * Never does: render anything or read the clock; `today` is fixed. Casts appear only to forge
 * values the typed draft cannot hold, so the defensive messages are covered too.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addDays, isoDate } from '../../src/domain/dates.js';
import { draftFromBrief, type BriefDraft } from '../../src/features/brief/draft.js';
import { sampleBrief } from '../../src/features/brief/samples.js';
import { validateBrief, type FieldError } from '../../src/features/brief/validate.js';
import { LIMITS } from '../../src/shared/limits.js';
import { eventBriefSchema } from '../../src/shared/schema.js';

const today = isoDate('2026-10-21');
const valid = draftFromBrief(sampleBrief('community', today));
const blankIncome = draftFromBrief(sampleBrief('birthday', today)).income;
const draftWith = (overrides: Partial<BriefDraft>): BriefDraft => ({ ...valid, ...overrides });
const income = (key: keyof BriefDraft['income'], value: string): Partial<BriefDraft> => ({
  income: { ...valid.income, [key]: value },
});
/** A value the typed draft cannot hold, forged to reach a defensive branch. */
const forge = (value: unknown): never => value as never;

const errorsOf = (draft: BriefDraft): readonly FieldError[] => {
  const result = validateBrief(draft, today);
  return result.ok ? [] : result.errors;
};

describe('validateBrief: valid drafts', () => {
  it('returns the schema-parsed brief for each sample', () => {
    for (const kind of ['community', 'birthday'] as const) {
      const sample = sampleBrief(kind, today);
      expect(validateBrief(draftFromBrief(sample), today)).toEqual({ ok: true, brief: sample });
    }
  });

  it('trims text the way the schema does', () => {
    const result = validateBrief(draftWith({ name: '  Mela  ', city: ' Delhi ' }), today);
    expect(result.ok && [result.brief.name, result.brief.city]).toEqual(['Mela', 'Delhi']);
  });

  it('accepts today and the last day of the two-year horizon', () => {
    for (const date of [today, addDays(today, LIMITS.brief.horizonDays)]) {
      expect(validateBrief(draftWith({ date }), today).ok).toBe(true);
    }
  });
});

describe('validateBrief: one human message per field', () => {
  const huge = '100000001';
  it.each<[string, Partial<BriefDraft>, string]>([
    ['kind', { kind: forge('party') }, 'Choose the kind of event'],
    ['subtype', { subtype: 'kids' }, 'Choose the type of event'],
    ['name', { name: '' }, 'Enter the event name'],
    ['name', { name: '   ' }, 'Enter the event name'],
    ['name', { name: 'x'.repeat(81) }, 'Event name must be 80 characters or fewer'],
    ['date', { date: '' }, 'Enter the event date'],
    ['date', { date: '30/11/2026' }, 'Enter the event date'],
    ['startTime', { startTime: '' }, 'Enter a start time, like 18:00'],
    ['startTime', { startTime: '25:00' }, 'Enter a start time, like 18:00'],
    ['durationHours', { durationHours: '' }, 'Enter how many hours the event lasts'],
    [
      'durationHours',
      { durationHours: '0' },
      'Duration must be a whole number of hours from 1 to 16',
    ],
    [
      'durationHours',
      { durationHours: '17' },
      'Duration must be a whole number of hours from 1 to 16',
    ],
    ['city', { city: 'x'.repeat(61) }, 'City must be 60 characters or fewer'],
    ['venue', { venue: 'castle' }, 'Choose a type of venue'],
    ['guests', { guests: '' }, 'Enter the number of guests'],
    ['guests', { guests: '0' }, 'Guests must be a whole number from 1 to 5,000'],
    ['guests', { guests: '5001' }, 'Guests must be a whole number from 1 to 5,000'],
    ['guests', { guests: '12.5' }, 'Guests must be a whole number from 1 to 5,000'],
    ['guests', { guests: 'many' }, 'Guests must be a whole number from 1 to 5,000'],
    ['budget', { budget: '' }, 'Enter a budget of at least 1'],
    ['budget', { budget: '0' }, 'Enter a budget of at least 1'],
    ['budget', { budget: '-5' }, 'Enter a budget of at least 1'],
    ['budget', { budget: huge }, 'Budget must be a whole number from 1 to 10,00,00,000'],
    ['budget', { budget: '999.99' }, 'Budget must be a whole number from 1 to 10,00,00,000'],
    ['currency', { currency: 'XYZ' }, 'Choose a currency'],
    ['dietary', { dietary: ['vegan', 'vegan'] }, 'Choose each dietary need once, up to 6'],
    ['dietary', { dietary: ['pizza'] }, 'Choose each dietary need once, up to 6'],
    ['accessibility', { accessibility: ['ramp'] }, 'Choose each accessibility need once, up to 6'],
    [
      'amplifiedSound',
      { amplifiedSound: forge('yes') },
      'Say whether there will be amplified sound',
    ],
    ['servesFood', { servesFood: forge('yes') }, 'Say whether you will serve food'],
    ['servesAlcohol', { servesAlcohol: forge('no') }, 'Say whether you will serve alcohol'],
    ['vibe', { vibe: 'x'.repeat(121) }, 'Vibe must be 120 characters or fewer'],
    ['notes', { notes: 'x'.repeat(501) }, 'Notes must be 500 characters or fewer'],
    [
      'volunteersAvailable',
      { volunteersAvailable: '501' },
      'Volunteers must be a whole number from 0 to 500',
    ],
    [
      'income.ticketPrice',
      income('ticketPrice', '-1'),
      'Ticket price must be a whole number from 0 to 10,00,00,000',
    ],
    [
      'income.expectedPaidAttendance',
      income('expectedPaidAttendance', '5001'),
      'Paid attendance must be a whole number from 0 to 5,000',
    ],
    [
      'income.sponsors',
      income('sponsors', huge),
      'Sponsorship must be a whole number from 0 to 10,00,00,000',
    ],
    [
      'income.donations',
      income('donations', '0.5'),
      'Donations must be a whole number from 0 to 10,00,00,000',
    ],
    [
      'income.stallCount',
      income('stallCount', '5001'),
      'Number of stalls must be a whole number from 0 to 5,000',
    ],
    [
      'income.stallFee',
      income('stallFee', '-1'),
      'Fee per stall must be a whole number from 0 to 10,00,00,000',
    ],
  ])('%s: %j → %s', (field, overrides, message) => {
    expect(errorsOf(draftWith(overrides))).toEqual([{ field, message }]);
  });

  it('reports one message per field even when the schema finds several problems there', () => {
    const tooMany = ['vegan', 'vegan', 'jain', 'halal', 'gluten_free', 'nut_free', 'vegetarian'];
    expect(errorsOf(draftWith({ dietary: tooMany }))).toHaveLength(1);
  });

  it('counts blank volunteers as 0 (R68)', () => {
    const result = validateBrief(draftWith({ volunteersAvailable: '' }), today);
    expect(result.ok && result.brief.volunteersAvailable).toBe(0);
  });

  it('never asks about income or volunteers outside community events', () => {
    const birthday = draftFromBrief(sampleBrief('birthday', today));
    const draft = {
      ...birthday,
      volunteersAvailable: '',
      income: { ...blankIncome, sponsors: '-1' },
    };
    expect(validateBrief(draft, today).ok).toBe(true);
  });
});

describe('validateBrief: the event date window', () => {
  it.each([
    ['past', addDays(today, -1), 'Choose a date from today onwards'],
    [
      'too_far',
      addDays(today, LIMITS.brief.horizonDays + 1),
      'Choose a date within the next two years',
    ],
    ['invalid', '2026-02-30', 'Enter a real calendar date'],
  ])('maps %s to a human message', (_reason, date, message) => {
    expect(errorsOf(draftWith({ date }))).toEqual([{ field: 'date', message }]);
  });

  it('reports a date out of range alongside other errors, not after they are fixed', () => {
    const errors = errorsOf(draftWith({ date: addDays(today, -3), budget: '0' }));
    expect(errors.map((e) => e.field)).toEqual(['date', 'budget']);
  });
});

describe('validateBrief: error order', () => {
  it('lists errors in the order the form shows the fields', () => {
    const draft = draftWith({
      name: '',
      date: '',
      guests: '0',
      budget: '0',
      notes: 'x'.repeat(501),
      volunteersAvailable: '501',
      ...income('stallFee', '-1'),
    });
    expect(errorsOf(draft).map((e) => e.field)).toEqual([
      'name',
      'date',
      'guests',
      'budget',
      'notes',
      'volunteersAvailable',
      'income.stallFee',
    ]);
  });
});

describe('validateBrief: numbers the browser could not read', () => {
  const MONEY = 'Enter the amount as digits only, like 150000';
  const COUNT = 'Enter digits only, like 12';

  it.each<[string, Partial<BriefDraft>, string]>([
    ['budget', { budget: '' }, MONEY],
    ['income.sponsors', income('sponsors', ''), MONEY],
    ['income.stallFee', income('stallFee', ''), MONEY],
    ['guests', { guests: '' }, COUNT],
    ['volunteersAvailable', { volunteersAvailable: '' }, COUNT],
    ['income.stallCount', income('stallCount', ''), COUNT],
  ])('%s says to use digits, even where a blank would count as 0', (field, overrides, message) => {
    expect(validateBrief(draftWith(overrides), today, [field])).toEqual({
      ok: false,
      errors: [{ field, message }],
    });
  });

  it('ignores names that are not number fields', () => {
    expect(validateBrief(valid, today, ['name', 'nonsense']).ok).toBe(true);
  });
});

describe('validateBrief: an issue no message knows about', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('still fails visibly, pointing at the first field', () => {
    vi.spyOn(eventBriefSchema, 'safeParse').mockReturnValue(
      forge({
        success: false,
        error: { issues: [{ code: 'custom', path: ['future'], message: 'x', input: 1 }] },
      }),
    );
    expect(validateBrief(valid, today)).toEqual({
      ok: false,
      errors: [{ field: 'kind', message: 'Check the highlighted details' }],
    });
  });
});
