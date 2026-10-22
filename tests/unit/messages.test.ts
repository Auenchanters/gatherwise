/**
 * The client's error copy: one honest sentence per failure that says the deterministic plan still
 * works.
 * Does: checks every code has a message, that a wait is quoted in whole minutes (rounded up so
 * nobody retries early) with correct plurals, and that the wait is ignored where it means nothing.
 */
import { describe, expect, it } from 'vitest';
import type { ClientError } from '../../src/features/client/api-client.js';
import { clientErrorMessage } from '../../src/features/client/messages.js';

const CODES = ['network', 'timeout', 'rate_limited', 'unavailable', 'invalid'] as const;

describe('clientErrorMessage', () => {
  it.each(CODES)('has a non-empty message for %s that says the plan still works', (code) => {
    const message = clientErrorMessage({ code });
    expect(message.length).toBeGreaterThan(20);
    expect(message).toMatch(/standard suggestions|budget, timeline and vendors/u);
  });

  it('gives each code its own message', () => {
    const messages = CODES.map((code) => clientErrorMessage({ code }));
    expect(new Set(messages).size).toBe(CODES.length);
  });

  it('says what happened in plain words', () => {
    expect(clientErrorMessage({ code: 'rate_limited' })).toBe(
      'The AI service is busy right now \u2014 your plan is ready with standard suggestions. Try \u201CAdjust with AI\u201D in a minute.',
    );
    expect(clientErrorMessage({ code: 'unavailable' })).toBe(
      "AI ideas aren't available right now \u2014 the budget, timeline and vendors are fully usable.",
    );
  });

  it.each([
    [120, 'in 2 minutes'],
    [60, 'in 1 minute.'],
    [61, 'in 2 minutes'],
    [90, 'in 2 minutes'],
    [30, 'in 1 minute.'],
    [1, 'in 1 minute.'],
    [3600, 'in 60 minutes'],
  ])('quotes a wait of %i seconds as %j', (retryAfterSeconds, phrase) => {
    const message = clientErrorMessage({ code: 'rate_limited', retryAfterSeconds });
    expect(message).toContain(phrase);
    expect(message).not.toContain('in a minute');
  });

  it('words the timeout and the unusable reply neutrally, and never tells the user to retry the latter', () => {
    const invalid = clientErrorMessage({ code: 'invalid' });
    expect(invalid).toBe(
      "We couldn't get usable AI ideas for this plan \u2014 your budget, timeline and vendors are unaffected.",
    );
    expect(invalid).not.toMatch(/try|again|refresh|retry/iu);
    expect(clientErrorMessage({ code: 'timeout' })).toBe(
      'The AI took too long to reply \u2014 your plan is ready with standard suggestions. You can try again.',
    );
  });

  it('says the current ideas are unchanged, never "standard suggestions", when earlier AI ideas stay', () => {
    expect(clientErrorMessage({ code: 'network' }, true)).toBe(
      "Can't reach the AI service — check your connection. Your current ideas are unchanged; try “Adjust with AI” once you're back online.",
    );
    expect(clientErrorMessage({ code: 'timeout' }, true)).toBe(
      'The AI took too long to reply — your current ideas are unchanged. You can try again.',
    );
    expect(clientErrorMessage({ code: 'rate_limited', retryAfterSeconds: 120 }, true)).toBe(
      'The AI service is busy right now — your current ideas are unchanged. Try “Adjust with AI” in 2 minutes.',
    );
    for (const code of CODES) expect(clientErrorMessage({ code }, true)).not.toMatch(/standard/u);
  });

  it('leaves the two messages that never mention the ideas as they are', () => {
    for (const code of ['unavailable', 'invalid'] as const) {
      expect(clientErrorMessage({ code }, true)).toBe(clientErrorMessage({ code }));
    }
  });

  it('ignores a wait on errors where waiting is not the advice', () => {
    for (const code of ['network', 'timeout', 'unavailable', 'invalid'] as const) {
      const error: ClientError = { code, retryAfterSeconds: 120 };
      expect(clientErrorMessage(error)).toBe(clientErrorMessage({ code }));
    }
  });
});
