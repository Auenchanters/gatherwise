/**
 * The Gemini adapter, with the SDK mocked so no test touches the network.
 * Does: pins the request config (structured JSON, fixed instruction, bounded output, minimal
 * thinking, abort propagation), the one-time client construction and the token mapping.
 */
import { ThinkingLevel } from '@google/genai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGeminiGenerator } from '../../server/provider.js';
import type { Prompt } from '../../src/shared/prompt.js';

const mocks = vi.hoisted(() => ({ construct: vi.fn(), generateContent: vi.fn() }));
vi.mock('@google/genai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@google/genai')>()),
  GoogleGenAI: class {
    models = { generateContent: mocks.generateContent };
    constructor(options: unknown) {
      mocks.construct(options);
    }
  },
}));

const prompt: Prompt = {
  system: 'fixed instruction',
  user: '{"brief":{}}',
  schema: { type: 'object' },
};

describe('createGeminiGenerator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.generateContent.mockResolvedValue({
      text: '{"summary":""}',
      usageMetadata: { promptTokenCount: 271, candidatesTokenCount: 424, thoughtsTokenCount: 6 },
    });
  });

  it('builds the client once, with a 20 s timeout and no SDK retries', async () => {
    const generate = createGeminiGenerator('test-key-not-a-secret', 'gemini-3.5-flash-lite');
    const signal = new AbortController().signal;
    await generate(prompt, signal);
    await generate(prompt, signal);
    expect(mocks.construct).toHaveBeenCalledOnce();
    expect(mocks.construct).toHaveBeenCalledWith({
      apiKey: 'test-key-not-a-secret',
      httpOptions: { timeout: 20_000, retryOptions: { attempts: 1 } },
    });
    expect(mocks.generateContent).toHaveBeenCalledTimes(2);
  });

  it('asks for schema-constrained JSON with bounded output, minimal thinking and the caller signal', async () => {
    const signal = new AbortController().signal;
    await createGeminiGenerator('test-key-not-a-secret', 'gemini-3.5-flash-lite')(prompt, signal);
    expect(mocks.generateContent).toHaveBeenCalledWith({
      model: 'gemini-3.5-flash-lite',
      contents: prompt.user,
      config: {
        systemInstruction: prompt.system,
        responseMimeType: 'application/json',
        responseJsonSchema: prompt.schema,
        maxOutputTokens: 2048,
        temperature: 0.7,
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
        abortSignal: signal,
      },
    });
  });

  it('returns the text and maps usage, counting thinking tokens as output', async () => {
    const generate = createGeminiGenerator('test-key-not-a-secret', 'm');
    await expect(generate(prompt, new AbortController().signal)).resolves.toEqual({
      text: '{"summary":""}',
      inputTokens: 271,
      outputTokens: 430,
    });
  });

  it('defaults missing text and usage to empty and zero', async () => {
    mocks.generateContent.mockResolvedValue({});
    const generate = createGeminiGenerator('test-key-not-a-secret', 'm');
    await expect(generate(prompt, new AbortController().signal)).resolves.toEqual({
      text: '',
      inputTokens: 0,
      outputTokens: 0,
    });
  });

  it('lets SDK errors through untouched for the handler to classify', async () => {
    const failure = Object.assign(new Error('quota detail'), { status: 429 });
    mocks.generateContent.mockRejectedValue(failure);
    const generate = createGeminiGenerator('test-key-not-a-secret', 'm');
    await expect(generate(prompt, new AbortController().signal)).rejects.toBe(failure);
  });
});
