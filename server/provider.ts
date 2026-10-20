/**
 * The Gemini adapter: one `generateContent` call per prompt through the official SDK.
 * Does: build the SDK client once, ask for schema-constrained JSON with bounded output and minimal
 * thinking, pass the request's abort signal through, and report token usage.
 * Never does: retry (SDK attempts = 1, and no re-call here), log model text, or interpret errors;
 * the handler classifies them without ever echoing their messages.
 */
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import type { Prompt } from '../src/shared/prompt.js';

/** What one model call returns. */
export interface Generation {
  readonly text: string;
  readonly inputTokens: number;
  /** Response tokens plus any thinking tokens, since both are billed as output. */
  readonly outputTokens: number;
}

/** One model call; injectable so every handler test runs offline. */
export type Generate = (prompt: Prompt, signal: AbortSignal) => Promise<Generation>;

const TIMEOUT_MS = 20_000;
const MAX_OUTPUT_TOKENS = 2048;
const TEMPERATURE = 0.7;

/**
 * A generator for `model`. The client is created here, once, and reused by every call.
 * Minimal thinking is `thinkingLevel: MINIMAL`; `gemini-3.5-flash-lite` rejects `thinkingBudget: 0`
 * with 400 INVALID_ARGUMENT (checked live on 2026-10-21).
 */
export function createGeminiGenerator(apiKey: string, model: string): Generate {
  const client = new GoogleGenAI({
    apiKey,
    httpOptions: { timeout: TIMEOUT_MS, retryOptions: { attempts: 1 } },
  });
  return async (prompt, signal) => {
    const response = await client.models.generateContent({
      model,
      contents: prompt.user,
      config: {
        systemInstruction: prompt.system,
        responseMimeType: 'application/json',
        responseJsonSchema: prompt.schema,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        temperature: TEMPERATURE,
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
        abortSignal: signal,
      },
    });
    const usage = response.usageMetadata;
    return {
      text: response.text ?? '',
      inputTokens: usage?.promptTokenCount ?? 0,
      outputTokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
    };
  };
}
