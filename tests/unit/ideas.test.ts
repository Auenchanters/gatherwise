/**
 * Tests for src/domain/ideas.ts and the data in src/domain/templates/standard-ideas.ts.
 *
 * Does: pins the fit rule (the brief's "over by ₹12,000" case, the exact boundary, a category the
 * budget lacks) and guards the standard ideas: counts, known categories, cost shares, copy rules,
 * their conditions, and that every standard idea fits for any brief, rescaled or not.
 * Never does: read the clock; the property test is seeded.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildBudget, rescaleGuests, type Budget } from '../../src/domain/budget';
import { ideaFit, standardIdeas, type Idea } from '../../src/domain/ideas';
import { minor, toMinor, type Minor } from '../../src/domain/money';
import { templateFor } from '../../src/domain/templates';
import { STANDARD_IDEAS } from '../../src/domain/templates/standard-ideas';
import { LIMITS } from '../../src/shared/limits';
import { EVENT_KINDS, type EventBrief } from '../../src/shared/schema';
import { brief, briefArb } from '../support/fixtures';

const SEED = { seed: 20_261_022, numRuns: 200 };

const allocatedTo = (budget: Budget, categoryId: string): Minor => {
  const line = budget.lines.find((l) => l.categoryId === categoryId);
  if (!line) throw new Error(`no budget line for ${categoryId}`);
  return line.allocated;
};

const budgetOf = (b: EventBrief): Budget => buildBudget(b, templateFor(b.kind));
const ideaIds = (b: EventBrief): string[] =>
  standardIdeas(templateFor(b.kind), b, budgetOf(b)).map((i) => i.id);

describe('ideaFit', () => {
  const budget = budgetOf(brief('community'));
  const decorAlloc = allocatedTo(budget, 'decor');
  const idea: Idea = {
    id: 'ai-idea-1',
    title: 'Diya-lined paths',
    description: 'Line the walkways with clay diyas made by local potters.',
    categoryId: 'decor',
    estimatedCost: minor(0),
    source: 'ai',
  };

  it('is over by ₹12,000 when the cost is the décor allocation plus ₹12,000', () => {
    const estimatedCost = minor(decorAlloc + toMinor(12000, 'INR'));
    expect(ideaFit({ ...idea, categoryId: 'decor', estimatedCost }, budget)).toEqual({
      fits: false,
      overBy: toMinor(12000, 'INR'),
    });
  });

  it('fits exactly at the allocation and is over by one paisa above it', () => {
    expect(ideaFit({ ...idea, estimatedCost: decorAlloc }, budget)).toEqual({
      fits: true,
      overBy: 0,
    });
    expect(ideaFit({ ...idea, estimatedCost: minor(decorAlloc + 1) }, budget)).toEqual({
      fits: false,
      overBy: 1,
    });
  });

  it('fits a free idea', () => {
    expect(ideaFit(idea, budget)).toEqual({ fits: true, overBy: 0 });
  });

  it('treats a category the budget lacks as having nothing allocated', () => {
    expect(ideaFit({ ...idea, categoryId: 'catering', estimatedCost: minor(500) }, budget)).toEqual(
      { fits: false, overBy: 500 },
    );
    expect(ideaFit({ ...idea, categoryId: 'catering' }, budget)).toEqual({
      fits: true,
      overBy: 0,
    });
  });
});

describe('standard idea data', () => {
  it.each(EVENT_KINDS)('gives %s 5 to 8 ideas with unique ids in its own categories', (kind) => {
    const defs = STANDARD_IDEAS[kind];
    const categories = new Set(templateFor(kind).categories.map((c) => c.id));
    expect(defs.length).toBeGreaterThanOrEqual(5);
    expect(defs.length).toBeLessThanOrEqual(8);
    expect(new Set(defs.map((d) => d.id)).size).toBe(defs.length);
    for (const def of defs) expect(categories.has(def.categoryId), def.id).toBe(true);
  });

  it.each(EVENT_KINDS)('prices every %s idea as a share in (0, 1] of its category', (kind) => {
    for (const def of STANDARD_IDEAS[kind]) {
      expect(def.costShare, def.id).toBeGreaterThan(0);
      expect(def.costShare, def.id).toBeLessThanOrEqual(1);
    }
  });

  it.each(EVENT_KINDS)(
    'keeps %s copy within the AI caps and free of tax or legal claims',
    (kind) => {
      for (const def of STANDARD_IDEAS[kind]) {
        expect(Array.from(def.title).length, def.id).toBeLessThanOrEqual(LIMITS.ai.ideaTitleMax);
        expect(Array.from(def.description).length, def.id).toBeLessThanOrEqual(
          LIMITS.ai.ideaDescriptionMax,
        );
        expect(def.title.trim(), def.id).toBe(def.title);
        expect(def.description, def.id).toMatch(/\.$/u);
        expect(`${def.title} ${def.description}`, def.id).not.toMatch(
          /GST|legal|permit|licen[cs]e/iu,
        );
      }
    },
  );
});

describe('standardIdeas', () => {
  it('labels ideas as standard, with std- ids and no personalization', () => {
    const b = brief('wedding');
    const ideas = standardIdeas(templateFor('wedding'), b, budgetOf(b));
    expect(ideas.length).toBeGreaterThan(0);
    for (const i of ideas) {
      expect(i.source).toBe('template');
      expect(i.id).toMatch(/^std-/u);
      expect('personalization' in i).toBe(false);
    }
  });

  it('prices an idea at the floor of its share of the category', () => {
    const b = brief('community');
    const budget = budgetOf(b);
    const [first] = standardIdeas(templateFor('community'), b, budget);
    const def = STANDARD_IDEAS.community.find((d) => `std-${d.id}` === first?.id);
    if (!first || !def) throw new Error('expected a standard community idea');
    expect(first.estimatedCost).toBe(
      Math.floor(allocatedTo(budget, def.categoryId) * def.costShare),
    );
  });

  it('adds accessible seating only when guests have access needs', () => {
    expect(ideaIds(brief('community', { accessibility: [] }))).not.toContain(
      'std-accessible_seating',
    );
    expect(ideaIds(brief('community', { accessibility: ['wheelchair'] }))).toContain(
      'std-accessible_seating',
    );
  });

  it('adds the sponsor thank-you wall only when sponsors are expected', () => {
    const noSponsors = brief('community');
    const sponsors = brief('community', {
      income: {
        ticketPrice: 0,
        expectedPaidAttendance: 0,
        sponsors: 20_000,
        donations: 0,
        stallCount: 0,
        stallFee: 0,
      },
    });
    expect(ideaIds(noSponsors)).not.toContain('std-sponsor_wall');
    expect(ideaIds(sponsors)).toContain('std-sponsor_wall');
  });

  it('follows the brief for food, sound, kids, milestones and infants', () => {
    expect(ideaIds(brief('community', { servesFood: false }))).not.toContain('std-zero_waste_food');
    expect(ideaIds(brief('community'))).toContain('std-zero_waste_food');
    expect(ideaIds(brief('community', { amplifiedSound: false }))).not.toContain('std-quiet_zone');
    expect(ideaIds(brief('birthday'))).toContain('std-activity_stations');
    expect(ideaIds(brief('birthday', { subtype: 'adult' }))).not.toContain('std-activity_stations');
    expect(ideaIds(brief('birthday', { subtype: 'milestone' }))).toContain('std-photo_slideshow');
    expect(ideaIds(brief('birthday'))).toContain('std-baby_care_corner');
    expect(ideaIds(brief('birthday', { accessibility: [] }))).not.toContain('std-baby_care_corner');
    expect(ideaIds(brief('wedding'))).toContain('std-labelled_counters');
    expect(ideaIds(brief('wedding', { dietary: [] }))).not.toContain('std-labelled_counters');
  });

  it('includes exactly the ideas whose condition holds, and every one fits (property)', () => {
    const guestsArb = fc.integer({ min: LIMITS.brief.guestsMin, max: LIMITS.brief.guestsMax });
    fc.assert(
      fc.property(briefArb, guestsArb, (b, planned) => {
        const template = templateFor(b.kind);
        const budget = rescaleGuests(buildBudget({ ...b, guests: planned }, template), b.guests);
        const ideas = standardIdeas(template, b, budget);
        const expected = STANDARD_IDEAS[b.kind]
          .filter((d) => d.when === undefined || d.when(b))
          .map((d) => `std-${d.id}`);
        expect(ideas.map((i) => i.id)).toEqual(expected);
        for (const i of ideas) {
          expect(Number.isSafeInteger(i.estimatedCost)).toBe(true);
          expect(i.estimatedCost).toBeGreaterThanOrEqual(0);
          expect(ideaFit(i, budget).fits).toBe(true);
        }
      }),
      SEED,
    );
  });
});
