/**
 * Contract test for tests/support/fixtures.ts.
 *
 * Does: proves every fixture brief and every brief the arbitrary generates is accepted by
 * `eventBriefSchema`, so a schema change cannot leave the shared fixtures quietly invalid.
 * Never does: depend on the clock; the arbitrary is seeded.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { EVENT_KINDS, eventBriefSchema } from '../../src/shared/schema.js';
import { brief, briefArb } from '../support/fixtures.js';

describe('brief', () => {
  it.each(EVENT_KINDS)('builds a schema-valid %s brief', (kind) => {
    const result = eventBriefSchema.safeParse(brief(kind));
    expect(result.success).toBe(true);
    expect(result.data?.kind).toBe(kind);
  });

  it('is a 250-guest outdoor festival on a 1,50,000 INR budget for community', () => {
    expect(brief('community')).toMatchObject({
      guests: 250,
      budget: 150_000,
      currency: 'INR',
      venue: 'outdoor_public',
    });
  });

  it('applies overrides without changing the base', () => {
    const tiny = brief('community', { budget: 1000, guests: 5000 });
    expect(tiny).toMatchObject({ budget: 1000, guests: 5000, kind: 'community' });
    expect(brief('community').guests).toBe(250);
    expect(eventBriefSchema.safeParse(tiny).success).toBe(true);
  });

  it('accepts community income', () => {
    const income = {
      ticketPrice: 100,
      expectedPaidAttendance: 200,
      sponsors: 5000,
      donations: 0,
      stallCount: 4,
      stallFee: 500,
    };
    expect(eventBriefSchema.safeParse(brief('community', { income })).success).toBe(true);
  });
});

describe('briefArb', () => {
  it('only generates briefs the schema accepts, across all three kinds', () => {
    const kinds = new Set<string>();
    fc.assert(
      fc.property(briefArb, (generated) => {
        kinds.add(generated.kind);
        return eventBriefSchema.safeParse(generated).success;
      }),
      { seed: 20261020, numRuns: 500 },
    );
    expect([...kinds].sort()).toEqual([...EVENT_KINDS].sort());
  });
});
