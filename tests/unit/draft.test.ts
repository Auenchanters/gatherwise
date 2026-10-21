/**
 * Tests for src/features/brief/draft.ts, the string-based model behind the brief form.
 *
 * Does: round-trips every schema-valid brief through the draft (a property), pins how blanks,
 * decimals and padding turn into numbers, how income and volunteers depend on the kind, how a kind
 * switch resets the subtype, and that ticked options keep the options' order.
 * Never does: render anything or read the clock.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  draftFromBrief,
  draftToCandidate,
  EMPTY_DRAFT,
  toggleOption,
  withKind,
  type BriefDraft,
} from '../../src/features/brief/draft.js';
import {
  DIETARY_OPTIONS,
  EVENT_KINDS,
  eventBriefSchema,
  SUBTYPES,
} from '../../src/shared/schema.js';
import { brief, briefArb } from '../support/fixtures.js';

const SEED = { seed: 20_261_021, numRuns: 200 };

const community = (overrides: Partial<BriefDraft> = {}): BriefDraft => ({
  ...draftFromBrief(brief('community')),
  ...overrides,
});

describe('draftFromBrief and draftToCandidate', () => {
  it('round-trips any valid brief, dropping volunteers outside community events', () => {
    fc.assert(
      fc.property(briefArb, (b) => {
        const expected = {
          ...b,
          volunteersAvailable: b.kind === 'community' ? b.volunteersAvailable : 0,
        };
        expect(eventBriefSchema.parse(draftToCandidate(draftFromBrief(b)))).toEqual(expected);
      }),
      SEED,
    );
  });

  it('writes numbers as plain strings and leaves income blank when there is none', () => {
    const draft = draftFromBrief(brief('birthday', { guests: 30, budget: 50_000 }));
    expect(draft.guests).toBe('30');
    expect(draft.budget).toBe('50000');
    expect(Object.values(draft.income)).toEqual(['', '', '', '', '', '']);
  });

  it('writes income as strings when the brief has it', () => {
    const income = {
      ticketPrice: 0,
      expectedPaidAttendance: 0,
      sponsors: 40_000,
      donations: 0,
      stallCount: 20,
      stallFee: 1500,
    };
    expect(draftFromBrief(brief('community', { income })).income).toEqual({
      ticketPrice: '0',
      expectedPaidAttendance: '0',
      sponsors: '40000',
      donations: '0',
      stallCount: '20',
      stallFee: '1500',
    });
  });
});

describe('draftToCandidate number parsing', () => {
  it('turns a blank number, date or time into a missing value so the schema reports it', () => {
    const candidate = draftToCandidate(
      community({ guests: '  ', budget: '', durationHours: '', date: '', startTime: '' }),
    );
    expect(candidate.guests).toBeUndefined();
    expect(candidate.budget).toBeUndefined();
    expect(candidate.durationHours).toBeUndefined();
    expect(candidate.date).toBeUndefined();
    expect(candidate.startTime).toBeUndefined();
  });

  it('parses with Number, so padding is ignored and decimals reach the schema as decimals', () => {
    const candidate = draftToCandidate(community({ guests: ' 12 ', budget: '12.5' }));
    expect(candidate.guests).toBe(12);
    expect(candidate.budget).toBe(12.5);
  });

  it('keeps blank text as an empty string, which the schema accepts for optional text', () => {
    const candidate = draftToCandidate(community({ city: '', vibe: '', notes: '' }));
    expect(candidate).toMatchObject({ city: '', vibe: '', notes: '' });
  });
});

describe('draftToCandidate community extras', () => {
  const blankIncome = draftFromBrief(brief('community')).income;

  it('leaves income out when every income field is blank', () => {
    expect(draftToCandidate(community({ income: blankIncome }))).not.toHaveProperty('income');
  });

  it('counts blank income fields as 0 once any income is entered', () => {
    const candidate = draftToCandidate(
      community({ income: { ...blankIncome, sponsors: '40000' } }),
    );
    expect(candidate.income).toEqual({
      ticketPrice: 0,
      expectedPaidAttendance: 0,
      sponsors: 40_000,
      donations: 0,
      stallCount: 0,
      stallFee: 0,
    });
  });

  it('ignores income and volunteers for weddings and birthdays', () => {
    const draft = {
      ...draftFromBrief(brief('wedding')),
      volunteersAvailable: '40',
      income: { ...blankIncome, sponsors: '5' },
    };
    const candidate = draftToCandidate(draft);
    expect(candidate).not.toHaveProperty('income');
    expect(candidate.volunteersAvailable).toBe(0);
  });

  it('reports blank volunteers on a community event as missing', () => {
    expect(draftToCandidate(community({ volunteersAvailable: '' })).volunteersAvailable).toBe(
      undefined,
    );
  });
});

describe('EMPTY_DRAFT', () => {
  it('starts a community festival with everything the user must decide left blank', () => {
    expect(EMPTY_DRAFT).toMatchObject({
      kind: 'community',
      subtype: 'festival',
      name: '',
      date: '',
      guests: '',
      budget: '',
      currency: 'INR',
    });
    const parsed = eventBriefSchema.safeParse(draftToCandidate(EMPTY_DRAFT));
    expect(parsed.success).toBe(false);
  });
});

describe('withKind', () => {
  it.each(EVENT_KINDS)('switching to %s picks its first subtype and keeps the rest', (kind) => {
    const draft = draftFromBrief(brief('birthday', { subtype: 'milestone' }));
    const next = withKind(draft, kind);
    expect(next).toEqual({ ...draft, kind, subtype: SUBTYPES[kind][0] });
  });
});

describe('toggleOption', () => {
  it('adds and removes a value, always in the options order', () => {
    const ticked = toggleOption(['nut_free'], DIETARY_OPTIONS, 'vegetarian', true);
    expect(ticked).toEqual(['vegetarian', 'nut_free']);
    expect(toggleOption(ticked, DIETARY_OPTIONS, 'nut_free', false)).toEqual(['vegetarian']);
  });

  it('is idempotent and ignores values that are not options', () => {
    expect(toggleOption(['vegan'], DIETARY_OPTIONS, 'vegan', true)).toEqual(['vegan']);
    expect(toggleOption(['vegan'], DIETARY_OPTIONS, 'pizza', true)).toEqual(['vegan']);
  });
});
