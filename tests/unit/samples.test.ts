/**
 * Tests for src/features/brief/samples.ts, the demo briefs behind the landing's sample buttons.
 *
 * Does: proves both samples are schema-valid and inside the planning window for any `today`, and
 * pins the demo content the video and judges rely on.
 * Never does: read the clock; `today` is a parameter.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addDays, isoDate } from '../../src/domain/dates.js';
import { eventDateOf } from '../../src/domain/schedule.js';
import { sampleBrief } from '../../src/features/brief/samples.js';
import { eventBriefSchema } from '../../src/shared/schema.js';

const today = isoDate('2026-10-21');
const todayArb = fc.integer({ min: 0, max: 30_000 }).map((n) => addDays(isoDate('2000-01-01'), n));

describe('sampleBrief', () => {
  it.each(['community', 'birthday'] as const)(
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

  it('the community sample is a lantern-lit Diwali mela with stalls and sponsors', () => {
    expect(sampleBrief('community', today)).toEqual({
      kind: 'community',
      subtype: 'festival',
      name: 'Green Park Diwali Mela',
      date: '2026-11-30',
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
      date: '2026-11-11',
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
