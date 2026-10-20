/**
 * Sanitizing of the model's answer before it leaves the server.
 * Does: checks that every string in a model response is cleaned and capped while ids and numbers
 * pass through untouched. The text rules themselves are pinned in sanitize-text.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { sanitizeSuggestions } from '../../server/sanitize.js';
import { LIMITS } from '../../src/shared/limits.js';
import type { AiSuggestions } from '../../src/shared/schema.js';

describe('sanitizeSuggestions', () => {
  const dirty: AiSuggestions = {
    summary: '<b>Bold</b> plan\u0007',
    ideas: [
      {
        title: '<script>alert(1)</script>Lantern walk',
        description: 'x'.repeat(400),
        categoryId: 'decor',
        estimatedCost: 1e12,
        personalization: 'vibe <i>family</i>',
      },
    ],
    weightHints: [{ categoryId: 'decor', factor: 9 }],
    extraTasks: [
      {
        title: 'Book <u>drums</u>',
        categoryId: 'decor',
        durationDays: -3,
        leadDays: 999,
        after: [],
      },
    ],
    vendorQuestions: [{ vendorId: 'generator', questions: ['Fuel\u0000 included?', '<a>x</a>'] }],
  };

  it('cleans and caps every string while leaving ids and numbers for the engine', () => {
    const clean = sanitizeSuggestions(dirty);
    expect(clean.summary).toBe('Bold plan');
    expect(clean.ideas[0]?.title).toBe('alert(1) Lantern walk');
    expect(clean.ideas[0]?.description).toHaveLength(LIMITS.ai.ideaDescriptionMax);
    expect(clean.ideas[0]?.personalization).toBe('vibe family');
    expect(clean.ideas[0]?.estimatedCost).toBe(1e12);
    expect(clean.weightHints).toEqual(dirty.weightHints);
    expect(clean.extraTasks[0]).toEqual({ ...dirty.extraTasks[0], title: 'Book drums' });
    expect(clean.vendorQuestions[0]).toEqual({
      vendorId: 'generator',
      questions: ['Fuel included?', 'x'],
    });
  });
});
