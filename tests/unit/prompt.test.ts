/**
 * The model contract: one fixed instruction, one JSON data block, one per-template schema (the
 * shared builder in src/shared/prompt.ts) and the reader for the answer (server/prompt.ts).
 * Does: checks the user prompt carries only engine numbers, active ids and sanitized brief text,
 * runs the injection corpus through every free-text field, and checks the response reader.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError } from '../../server/errors.js';
import { parseSuggestions } from '../../server/prompt.js';
import { buildPlan, type Plan } from '../../src/domain/plan.js';
import { templateFor } from '../../src/domain/templates/index.js';
import { LIMITS } from '../../src/shared/limits.js';
import { buildPrompt, buildUserPrompt, SYSTEM_INSTRUCTION } from '../../src/shared/prompt.js';
import { sanitizeText } from '../../src/shared/sanitize-text.js';
import { eventBriefSchema, type EventBrief } from '../../src/shared/schema.js';
import { brief, TODAY } from '../support/fixtures.js';

function planOf(b: EventBrief): Plan {
  const plan = buildPlan(eventBriefSchema.parse(b), TODAY);
  if (!plan.ok) throw new Error('fixture brief must plan');
  return plan.value;
}

const promptShape = z.strictObject({
  brief: z.record(z.string(), z.unknown()),
  currency: z.string(),
  categories: z.array(z.strictObject({ id: z.string(), label: z.string(), allocated: z.number() })),
  tasks: z.array(z.strictObject({ id: z.string(), title: z.string() })),
  vendors: z.array(z.strictObject({ id: z.string(), label: z.string() })),
});
const readPrompt = (plan: Plan) => promptShape.parse(JSON.parse(buildUserPrompt(plan)));

const corpus = z
  .array(z.strictObject({ name: z.string(), text: z.string() }))
  .min(12)
  .parse(JSON.parse(readFileSync('tests/fixtures/injection.json', 'utf8')));

const FREE_TEXT = [
  ['name', LIMITS.brief.nameMax],
  ['city', LIMITS.brief.cityMax],
  ['vibe', LIMITS.brief.vibeMax],
  ['notes', LIMITS.brief.notesMax],
] as const;

describe('SYSTEM_INSTRUCTION', () => {
  it('states the role, the data-not-instructions rule and the safety limits', () => {
    for (const phrase of [
      'Gatherwise',
      'community events, weddings and birthdays',
      'UNTRUSTED DATA',
      'reveal',
      'only the category, task and vendor ids',
      'whole major units',
      'allocated',
      'Never compute totals',
      'dietary, accessibility, subtype, guests, venue',
      'servesAlcohol',
      'check with your local authority',
    ]) {
      expect(SYSTEM_INSTRUCTION).toContain(phrase);
    }
  });
});

describe('buildUserPrompt', () => {
  it('sends engine allocations in whole major units and nothing the model should compute', () => {
    const plan = planOf(brief('community'));
    const sent = readPrompt(plan);
    expect(sent.currency).toBe('INR');
    expect(sent.categories.map((c) => c.id)).toEqual(plan.budget.lines.map((l) => l.categoryId));
    for (const [i, line] of plan.budget.lines.entries()) {
      expect(sent.categories[i]?.allocated).toBe(Math.floor(line.allocated / 100));
    }
    expect(sent.brief).not.toHaveProperty('budget');
    expect(sent.brief).not.toHaveProperty('income');
    expect(sent.brief).toMatchObject({ kind: 'community', guests: 250, venue: 'outdoor_public' });
  });

  it('lists only the tasks and vendors active for this brief', () => {
    const outdoor = readPrompt(planOf(brief('community')));
    const indoor = readPrompt(
      planOf(brief('community', { venue: 'indoor_hall', amplifiedSound: false })),
    );
    const ids = (items: readonly { id: string }[]) => items.map((item) => item.id);
    expect(ids(outdoor.tasks)).toContain('public_space_permission');
    expect(ids(indoor.tasks)).not.toContain('public_space_permission');
    expect(ids(indoor.tasks)).not.toContain('sound_permission');
    expect(ids(outdoor.vendors)).toContain('tent_shamiana');
    expect(ids(indoor.vendors)).not.toContain('tent_shamiana');
    const template = templateFor('community');
    expect(indoor.tasks.length).toBeLessThan(template.tasks.length);
  });

  it('builds the full prompt from the fixed instruction and the kind-specific schema', () => {
    const wedding = buildPrompt(planOf(brief('wedding')));
    expect(wedding.system).toBe(SYSTEM_INSTRUCTION);
    expect(JSON.stringify(wedding.schema)).toContain('"catering"');
    expect(JSON.stringify(wedding.schema)).not.toContain('"stage_av"');
    // Schemas are built once per kind at load, never per request.
    expect(buildPrompt(planOf(brief('wedding'))).schema).toBe(wedding.schema);
  });
});

/** The longest prefix of `text` within `cap` UTF-16 units (the schema's measure), whole code points only. */
function fit(text: string, cap: number): string {
  let out = '';
  for (const char of text) {
    if (out.length + char.length > cap) break;
    out += char;
  }
  return out.trim() || 'x';
}

describe('injection corpus', () => {
  it.each(corpus)('$name stays an inert value inside brief', ({ text }) => {
    for (const [field, cap] of FREE_TEXT) {
      const hostile = brief('community');
      hostile[field] = fit(text, cap);
      const plan = planOf(hostile);
      const prompt = buildPrompt(plan);
      expect(prompt.system).toBe(SYSTEM_INSTRUCTION);

      const sent = readPrompt(plan);
      const expected = sanitizeText(plan.brief[field], cap);
      expect(sent.brief[field]).toBe(expected);
      const { brief: sentBrief, ...rest } = sent;
      if (expected.length > 3) {
        expect(JSON.stringify(rest)).not.toContain(expected);
        expect(prompt.system).not.toContain(expected);
      }
      for (const value of Object.values(sentBrief)) {
        expect(JSON.stringify(value)).not.toMatch(/[<>]/u);
        if (typeof value === 'string') expect(value).not.toMatch(/(?!\n)\p{Cc}/u);
      }
      expect(prompt.user).not.toMatch(/(?!\n)\p{Cc}|[\u202A-\u202E\u2066-\u2069]/u);
    }
  });
});

describe('parseSuggestions', () => {
  const valid = {
    summary: 'A bright <b>festival</b>',
    ideas: [
      {
        title: '<script>alert(1)</script>Lantern walk',
        description: 'Paper lanterns along the path.',
        categoryId: 'decor',
        estimatedCost: 5000,
        personalization: 'vibe',
      },
    ],
    weightHints: [],
    extraTasks: [],
    vendorQuestions: [],
  };

  it('returns schema-valid suggestions with every string sanitized', () => {
    const parsed = parseSuggestions(JSON.stringify(valid), 'community');
    expect(parsed.summary).toBe('A bright festival');
    expect(parsed.ideas[0]?.title).toBe('alert(1) Lantern walk');
  });

  it.each([
    ['text that is not JSON', 'Sure! Here are some ideas'],
    ['an empty response', ''],
    [
      'an unknown category id',
      JSON.stringify({ ...valid, ideas: [{ ...valid.ideas[0], categoryId: 'yacht' }] }),
    ],
    [
      'a category from another template',
      JSON.stringify({ ...valid, ideas: [{ ...valid.ideas[0], categoryId: 'catering' }] }),
    ],
    ['an extra key', JSON.stringify({ ...valid, apiKey: 'leak' })],
  ])('rejects %s as INVALID_RESPONSE', (_name, text) => {
    let caught: unknown;
    try {
      parseSuggestions(text, 'community');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect(caught).toMatchObject({ code: 'INVALID_RESPONSE', status: 502 });
  });
});
