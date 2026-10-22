/**
 * Tests for src/features/brief/samples.ts, the demo briefs behind the landing's sample buttons.
 *
 * Does: proves every sample is schema-valid and inside the planning window for any `today`, that
 * none opens with a task that is overdue or cannot be done in time, and pins the demo content that
 * the demo video relies on.
 * Never does: read the clock; `today` is a parameter.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addDays, isoDate } from '../../src/domain/dates.js';
import { buildPlan } from '../../src/domain/plan.js';
import { eventDateOf } from '../../src/domain/schedule.js';
import { sampleBrief } from '../../src/features/brief/samples.js';
import { eventBriefSchema } from '../../src/shared/schema.js';
import { TODAY as today } from '../support/fixtures.js';

const todayArb = fc.integer({ min: 0, max: 30_000 }).map((n) => addDays(isoDate('2000-01-01'), n));

const KINDS = ['community', 'wedding', 'birthday'] as const;

describe('sampleBrief', () => {
  it.each(KINDS)(
    'the %s sample parses unchanged and its date is in range for any today',
    (kind) => {
      fc.assert(
        fc.property(todayArb, (day) => {
          const sample = sampleBrief(kind, day);
          expect(eventBriefSchema.parse(sample)).toEqual(sample);
          expect(eventDateOf(sample, day).ok).toBe(true);
        }),
        { seed: 20_261_021, numRuns: 100 },
      );
    },
  );

  it.each(KINDS)(
    'the %s sample leaves time for every task, so its first plan opens calm',
    (kind) => {
      const plan = buildPlan(sampleBrief(kind, today), today);
      if (!plan.ok) throw new Error('the sample must plan');
      const { schedule } = plan.value;
      expect(schedule.infeasibleCount).toBe(0);
      expect(schedule.overdueCount).toBe(0);
      expect(
        schedule.tasks.filter((t) => t.status === 'infeasible' || t.status === 'overdue'),
      ).toEqual([]);
    },
  );

  it('the wedding sample is a vegetarian reception that serves alcohol, so the bar vendor appears', () => {
    expect(sampleBrief('wedding', today)).toEqual({
      kind: 'wedding',
      subtype: 'ceremony_reception',
      name: "Meera & Rohan's Wedding",
      date: '2027-06-18',
      startTime: '19:00',
      durationHours: 5,
      city: 'Jaipur',
      venue: 'indoor_hall',
      guests: 150,
      budget: 1_200_000,
      currency: 'INR',
      dietary: ['vegetarian'],
      accessibility: ['elderly'],
      amplifiedSound: true,
      servesFood: true,
      servesAlcohol: true,
      volunteersAvailable: 0,
      vibe: 'traditional, marigold garlands and candlelight',
      notes: 'Ceremony first, then a reception dinner with music',
    });
    const plan = buildPlan(sampleBrief('wedding', today), today);
    if (!plan.ok) throw new Error('the sample must plan');
    expect(plan.value.vendors.map((v) => v.label)).toEqual([
      'Photographer & videographer',
      'Caterer',
      'Decorator & florist',
      'DJ or band',
      'Bar service',
    ]);
  });

  it('the community sample is a lantern-lit Diwali mela with stalls and sponsors', () => {
    expect(sampleBrief('community', today)).toEqual({
      kind: 'community',
      subtype: 'festival',
      name: 'Green Park Diwali Mela',
      date: '2027-01-04',
      startTime: '18:00',
      durationHours: 5,
      city: 'New Delhi',
      venue: 'outdoor_public',
      guests: 250,
      budget: 150_000,
      currency: 'INR',
      dietary: ['vegetarian', 'jain'],
      accessibility: ['wheelchair', 'elderly'],
      amplifiedSound: true,
      servesFood: true,
      servesAlcohol: false,
      volunteersAvailable: 18,
      vibe: 'warm, family-friendly, lantern-lit',
      notes: "Residents' association event; first time with food stalls",
      income: {
        ticketPrice: 0,
        expectedPaidAttendance: 0,
        sponsors: 40_000,
        donations: 0,
        stallCount: 20,
        stallFee: 1500,
      },
    });
  });

  it("the birthday sample is Aarav's space-themed 8th at home", () => {
    expect(sampleBrief('birthday', today)).toEqual({
      kind: 'birthday',
      subtype: 'kids',
      name: "Aarav's 8th — space adventure",
      date: '2026-11-30',
      startTime: '16:00',
      durationHours: 3,
      city: 'Pune',
      venue: 'home',
      guests: 20,
      budget: 15_000,
      currency: 'INR',
      dietary: ['nut_free'],
      accessibility: [],
      amplifiedSound: false,
      servesFood: true,
      servesAlcohol: false,
      volunteersAvailable: 0,
      vibe: 'rockets, stars, glow-in-the-dark',
      notes: '',
    });
  });

  it('returns fresh objects, so editing one sample cannot leak into the next', () => {
    expect(sampleBrief('community', today)).not.toBe(sampleBrief('community', today));
  });
});
