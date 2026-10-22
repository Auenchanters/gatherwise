/**
 * Test doubles for the planner: an AI client that counts its calls and an in-memory storage.
 * Does: let unit and UI tests prove the model-call budget by counting `suggest` calls, and
 * exercise saving, refused writes and restores, without a network or a real localStorage; also
 * builds the plan states and saved copies those restore tests start from.
 * Never does: call `fetch` or read the clock.
 */
import { vi, type Mock } from 'vitest';
import { initialPlanState, planReducer, type PlanState } from '../../src/domain/reducer.js';
import type {
  ClientError,
  PlanClient,
  SuggestResponse,
} from '../../src/features/client/api-client.js';
import { savePlan } from '../../src/features/plan/persist.js';
import type { PlannerStorage } from '../../src/features/plan/planner-store.js';
import { STORAGE_KEY } from '../../src/features/plan/storage-key.js';
import { ok, type Result } from '../../src/shared/result.js';
import type { EventBrief } from '../../src/shared/schema.js';
import { aiMeta, aiSuggestions, TODAY } from './fixtures.js';

/** What the client's `suggest` resolves with. */
export type Answer = Result<SuggestResponse, ClientError>;

/** A fresh (not cached) success carrying the shared community answer. */
export const freshAnswer: Answer = ok({ suggestions: aiSuggestions, meta: aiMeta, cached: false });

/** A promise the test settles by hand. */
export function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/**
 * A client whose `calls()` counts `suggest` calls as they start, like the real one's network
 * requests; `counting: false` stands for answers served from its cache. `answer` decides each
 * reply; by default a fresh success. `remember` only records what it was given.
 */
export function fakeClient(
  answer: (brief: EventBrief) => Promise<Answer> = () => Promise.resolve(freshAnswer),
  { counting = true } = {},
): {
  suggest: Mock<PlanClient['suggest']>;
  remember: Mock<PlanClient['remember']>;
  calls: () => number;
} {
  let calls = 0;
  const suggest = vi.fn<PlanClient['suggest']>((b) => {
    if (counting) calls += 1;
    return answer(b);
  });
  const remember = vi.fn<PlanClient['remember']>(() => Promise.resolve());
  return { suggest, remember, calls: () => calls };
}

/** Browser storage held in memory; `removed` lists every key removed, in order. */
export type MemoryStorage = PlannerStorage & { readonly removed: string[] };

/** An in-memory store that records removals; `refuseWrites` makes `setItem` throw. */
export function memoryStorage(initial?: string, { refuseWrites = false } = {}): MemoryStorage {
  const data = new Map<string, string>(initial === undefined ? [] : [[STORAGE_KEY, initial]]);
  const removed: string[] = [];
  return {
    removed,
    getItem: (key: string): string | null => data.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      if (refuseWrites) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      data.set(key, value);
    },
    removeItem: (key: string): void => {
      removed.push(key);
      data.delete(key);
    },
  };
}

/**
 * The state of a plan just submitted for `brief` on `day`, with or without the shared AI answer
 * (`aiSuggestions`) already applied.
 */
export function planned(brief: EventBrief, { withAi = false, day = TODAY } = {}): PlanState {
  const submitted = planReducer(initialPlanState, { type: 'brief/submitted', brief, today: day });
  return withAi
    ? planReducer(submitted, {
        type: 'ai/applied',
        generation: 1,
        suggestions: aiSuggestions,
        meta: aiMeta,
      })
    : submitted;
}

/** Storage that already holds `state` as the app saves it, ready to be restored from. */
export function savedStorage(state: PlanState): MemoryStorage {
  const seed = memoryStorage();
  savePlan(seed, state);
  return memoryStorage(seed.getItem(STORAGE_KEY) ?? '');
}
