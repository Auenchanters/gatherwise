/**
 * Ready-made briefs behind the landing's "Try a sample" buttons, so a judge or a first-time visitor
 * sees a full plan in one click.
 * Does: builds a community festival 75 days out (every lead time fits, so the first plan is calm)
 * and a kids' birthday 21 days out, both relative to the `today` passed in, so they always fall
 * inside the planning window.
 * Never does: read the clock, or share objects between calls (each call returns fresh data).
 */
import { addDays, type IsoDate } from '../../domain/dates.js';
import type { EventBrief } from '../../shared/schema.js';

/** The event kinds that have a sample. */
export type SampleKind = 'community' | 'birthday';

/** A schema-valid, demo-ready brief of the given kind, dated relative to `today`. */
export function sampleBrief(kind: SampleKind, today: IsoDate): EventBrief {
  if (kind === 'community') {
    return {
      kind: 'community',
      subtype: 'festival',
      name: 'Green Park Diwali Mela',
      date: addDays(today, 75),
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
    };
  }
  return {
    kind: 'birthday',
    subtype: 'kids',
    name: "Aarav's 8th — space adventure",
    date: addDays(today, 21),
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
  };
}
