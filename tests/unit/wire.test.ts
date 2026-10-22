/**
 * The browser client and the server handler together, across the wire format, with only the model
 * faked: what `createPlanClient` sends must pass `createHandler`'s gate, and what the handler
 * answers must pass the client's own validation.
 * Never calls the network; the client's `fetch` hands each request straight to the handler.
 */
import { describe, expect, it, vi } from 'vitest';
import { createHandler } from '../../server/handler.js';
import type { Generate } from '../../server/provider.js';
import { createPlanClient, type SuggestResponse } from '../../src/features/client/api-client.js';
import type { Result } from '../../src/shared/result.js';
import { aiSuggestions, brief } from '../support/fixtures.js';

const ORIGIN = 'https://gatherwise.example';
const NOW = new Date('2026-10-21T10:00:00Z');

/** A client whose `fetch` is the handler, sending the `Origin` a browser would add. */
function wired(generate: Generate) {
  const handler = createHandler({ generate, now: () => NOW, model: 'test-model' });
  const fetchImpl = vi.fn<typeof fetch>((input, init) => {
    const headers = new Headers(init?.headers);
    headers.set('origin', ORIGIN);
    const url = new URL(input instanceof Request ? input.url : input, ORIGIN);
    return handler(new Request(url, { ...init, headers }));
  });
  return { client: createPlanClient({ fetchImpl }), fetchImpl };
}

function succeeded<E>(result: Result<SuggestResponse, E>): SuggestResponse {
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.error)}`);
  return result.value;
}

describe('client to handler round trip', () => {
  it('creates: one request through the real gate, answered and validated on both sides', async () => {
    const generate = vi.fn<Generate>(() =>
      Promise.resolve({ text: JSON.stringify(aiSuggestions), inputTokens: 10, outputTokens: 20 }),
    );
    const { client, fetchImpl } = wired(generate);
    const answer = succeeded(
      await client.suggest(brief('community'), new AbortController().signal),
    );
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(generate).toHaveBeenCalledOnce();
    expect(answer.cached).toBe(false);
    expect(answer.meta).toMatchObject({ model: 'test-model', inputTokens: 10, outputTokens: 20 });
    // The server clamps the absurd cost before it crosses the wire; the rest arrives as sent.
    expect(answer.suggestions.ideas.map((idea) => idea.title)).toEqual(
      aiSuggestions.ideas.map((idea) => idea.title),
    );
    expect(answer.suggestions.ideas[1]?.estimatedCost).toBe(100_000_000);
  });

  it('adjusts: the change and the earlier answer cross the wire and reach the model as data', async () => {
    const generate = vi.fn<Generate>(() =>
      Promise.resolve({ text: JSON.stringify(aiSuggestions), inputTokens: 10, outputTokens: 20 }),
    );
    const { client, fetchImpl } = wired(generate);
    const signal = new AbortController().signal;
    const first = succeeded(await client.suggest(brief('community'), signal));
    const adjust = { change: 'Make it cheaper', previous: first.suggestions };
    const second = succeeded(await client.suggest(brief('community'), signal, { adjust }));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(second.cached).toBe(false);
    const [prompt] = generate.mock.calls[1] ?? [];
    expect(prompt?.user).toContain('"change":"Make it cheaper"');
    expect(prompt?.user).toContain(JSON.stringify(first.suggestions.summary));
  });

  it('turns an unusable answer into the client error code for it', async () => {
    const generate = vi.fn<Generate>(() =>
      Promise.resolve({ text: 'not json', inputTokens: 1, outputTokens: 1 }),
    );
    const { client } = wired(generate);
    const result = await client.suggest(brief('community'), new AbortController().signal);
    expect(result).toEqual({ ok: false, error: { code: 'invalid' } });
  });
});
