/**
 * Bounding of the model's answer before it leaves the server.
 * Does: checks that every string is cleaned and capped, every number clamped and every list cut,
 * while ids pass through untouched. The text rules themselves are pinned in sanitize-text.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { sanitizeSuggestions } from '../../server/sanitize.js';
import { LIMITS } from '../../src/shared/limits.js';
import type { AiSuggestions } from '../../src/shared/schema.js';

describe('sanitizeSuggestions', () => {
  const idea: AiSuggestions['ideas'][number] = {
    title: '<script>alert(1)</script>Lantern walk',
    description: 'x'.repeat(400),
    categoryId: 'decor',
    estimatedCost: 1e12,
    personalization: 'vibe <i>family</i>',
  };
  const task: AiSuggestions['extraTasks'][number] = {
    title: 'Book <u>drums</u>',
    categoryId: 'decor',
    durationDays: -3,
    leadDays: 999,
    after: [],
  };
  const dirty: AiSuggestions = {
    summary: '<b>Bold</b> plan',
    ideas: [idea],
    extraTasks: [task],
    vendorQuestions: [{ vendorId: 'generator', questions: ['Fuel\u0000 included?', '<a>x</a>'] }],
  };

  it('cleans and caps every string and leaves ids alone', () => {
    const clean = sanitizeSuggestions(dirty);
    expect(clean.summary).toBe('Bold plan');
    expect(clean.ideas[0]?.title).toBe('alert(1) Lantern walk');
    expect(clean.ideas[0]?.description).toHaveLength(LIMITS.ai.ideaDescriptionMax);
    expect(clean.ideas[0]?.personalization).toBe('vibe family');
    expect(clean.ideas[0]?.categoryId).toBe('decor');
    expect(clean.extraTasks[0]?.title).toBe('Book drums');
    expect(clean.vendorQuestions[0]).toEqual({
      vendorId: 'generator',
      questions: ['Fuel included?', 'x'],
    });
  });

  it('clamps every number into its range without rounding it', () => {
    const clean = sanitizeSuggestions(dirty);
    expect(clean.ideas[0]?.estimatedCost).toBe(LIMITS.brief.budgetMax);
    expect(clean.extraTasks[0]).toMatchObject({
      durationDays: LIMITS.ai.durationMin,
      leadDays: LIMITS.ai.leadMax,
    });
    const negative = sanitizeSuggestions({
      ...dirty,
      ideas: [{ ...idea, estimatedCost: -5 }],
      extraTasks: [{ ...task, durationDays: 2.5, leadDays: -30 }],
    });
    expect(negative.ideas[0]?.estimatedCost).toBe(0);
    expect(negative.extraTasks[0]).toMatchObject({
      durationDays: 2.5,
      leadDays: LIMITS.ai.leadMin,
    });
  });

  it('keeps only the first items of every list', () => {
    const ai = LIMITS.ai;
    const many = <T>(n: number, item: T): T[] => Array.from({ length: n }, () => item);
    const clean = sanitizeSuggestions({
      summary: '',
      ideas: many(ai.ideasMax + 3, idea),
      extraTasks: many(ai.extraTasksMax + 3, { ...task, after: many(ai.afterMax + 2, 'x') }),
      vendorQuestions: many(ai.vendorQuestionsMax + 3, {
        vendorId: 'generator',
        questions: many(ai.questionsPerVendorMax + 2, 'Fuel?'),
      }),
    });
    expect(clean.ideas).toHaveLength(ai.ideasMax);
    expect(clean.extraTasks).toHaveLength(ai.extraTasksMax);
    expect(clean.extraTasks[0]?.after).toHaveLength(ai.afterMax);
    expect(clean.vendorQuestions).toHaveLength(ai.vendorQuestionsMax);
    expect(clean.vendorQuestions[0]?.questions).toHaveLength(ai.questionsPerVendorMax);
  });
});
