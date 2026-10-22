/**
 * Ready-made briefs behind the landing's "Try a sample" buttons, so a first-time visitor sees a
 * full plan in one click.
 * Does: builds a community festival 75 days out, a wedding 240 days out and a kids' birthday 40
 * days out, all relative to the `today` passed in, so they always fall inside the planning window.
 * Each is dated so every lead time fits and the first plan opens calm (weddings need the longest
 * runway, so theirs is the furthest out).
 * Never does: read the clock, or share objects between calls (each call returns fresh data).
 */
import { addDays, type IsoDate } from '../../domain/dates.js';
import type { EventKind } from '../../domain/templates/types.js';
import type { EventBrief } from '../../shared/schema.js';

/** The event kinds that have a sample: every kind has one. */
export type SampleKind = EventKind;

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
      language: 'English',
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
  if (kind === 'wedding') {
    return {
      kind: 'wedding',
      subtype: 'ceremony_reception',
      name: "Meera & Rohan's Wedding",
      date: addDays(today, 240),
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
      language: 'English',
    };
  }
  return {
    kind: 'birthday',
    subtype: 'kids',
    name: "Aarav's 8th — space adventure",
    date: addDays(today, 40),
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
    language: 'English',
  };
}
