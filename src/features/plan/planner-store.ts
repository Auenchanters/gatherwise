/**
 * The planner store: the plan, its notices and the AI-call count, held outside React.
 * Does: runs every user action through `planReducer`, saves after each change (warning once if the
 * browser refuses), restores a saved plan, and is the ONLY place the UI's AI calls start: the
 * `submit`, `personalize` and `adjust` commands. Each call carries the plan's generation and
 * its own AbortController, so a superseded answer is dropped twice over: aborted and ignored here,
 * and ignored again by the reducer's generation guard.
 * Never does: call the AI from an edit, a restore or a subscription; change a snapshot after
 * handing it out; set timers; read the clock except through the injected `today`.
 */
import type { IsoDate } from '../../domain/dates.js';
import {
  initialPlanState,
  planReducer,
  type PlanAction,
  type PlanState,
} from '../../domain/reducer.js';
import type { TaskId } from '../../domain/templates/types.js';
import type { VendorStatus } from '../../domain/vendors.js';
import type { AdjustRequest, EventBrief } from '../../shared/schema.js';
import type { PlanClient } from '../client/api-client.js';
import { clientErrorMessage } from '../client/messages.js';
import { loadPlan, savePlan } from './persist.js';
import { STORAGE_KEY } from './storage-key.js';

/** The part of `localStorage` the store uses. */
export type PlannerStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** One line in the workspace's polite status region. At most one notice per `id`. */
export interface Notice {
  readonly id: 'restore' | 'storage' | 'ai' | 'cleared';
  readonly tone: 'info' | 'warning' | 'error';
  readonly text: string;
}

/**
 * What the store knows about the latest AI request beyond the reducer's `ai` state (whose `AiMeta`
 * contract stays as it is).
 */
export interface AiView {
  /** The brief the latest request this session was for, so the panel shows exactly what was sent. */
  readonly sentBrief?: EventBrief;
  /** True when the applied answer was reused from this session's cache: no new call was made. */
  readonly cached: boolean;
  /**
   * Set when the latest request was an "Adjust with AI": the change and the earlier answer it sent,
   * so the AI panel rebuilds that exact prompt. The Ideas tab announces what it brought.
   */
  readonly adjust?: AdjustRequest;
  /** The sentence for the latest failure, while the plan's AI state is `failed`. */
  readonly failure?: string;
}

/** One immutable view of everything the workspace renders. */
export interface PlannerSnapshot {
  readonly plan: PlanState;
  readonly notices: readonly Notice[];
  /** Real AI requests this session: the client's own counter. */
  readonly calls: number;
  readonly aiView: AiView;
}

/** What the store needs from the outside world. */
export interface PlannerDeps {
  readonly client: PlanClient;
  /** `null` when the browser offers no storage (some private modes, sandboxed frames). */
  readonly storage: PlannerStorage | null;
  /** Today's local date; read once per action that needs it. */
  readonly today: () => IsoDate;
}

/** What `submit` did with a brief. */
interface Submission {
  /** False when the brief cannot be planned (its date); the state's `error` says why. */
  readonly accepted: boolean;
  /** Settles once the brief's AI request has (or, when refused, at once). Never rejects. */
  readonly settled: Promise<void>;
}

/** The planner's state and commands. Members are plain functions, safe to pass around unbound. */
export interface PlannerStore {
  readonly getState: () => PlannerSnapshot;
  /** Calls `listener` after every change; returns the unsubscribe function. */
  readonly subscribe: (listener: () => void) => () => void;
  /**
   * Restores the saved plan, if any, and hands its AI answer to the client's cache under the
   * restored brief, so submitting that brief again costs no call. Never calls the AI.
   */
  readonly hydrate: () => void;
  /** Starts a plan for `brief`, then asks the AI once. A refused brief changes nothing else. */
  readonly submit: (brief: EventBrief) => Submission;
  /** Asks the AI for the current brief (answered from the cache if it was asked before). */
  readonly personalize: () => Promise<void>;
  /**
   * Asks the AI to revise the current answer to satisfy `change` (empty asks for fresh ideas): always
   * one call, never answered from the cache. Ignored while a request is pending.
   */
  readonly adjust: (change: string) => Promise<void>;
  readonly changeGuests: (guests: number) => void;
  readonly changeBudget: (budget: number) => void;
  readonly changeDate: (date: string) => void;
  readonly toggleTask: (taskId: TaskId) => void;
  readonly setVendorStatus: (vendorId: string, status: VendorStatus) => void;
  readonly toggleChecklist: (itemId: string) => void;
  /** Aborts any request and empties the plan (the saved copy goes with it). */
  readonly reset: () => void;
  /** Resets, removes the saved copy and says so. */
  readonly clearData: () => void;
  /** Moves the plan to the new day if the date has changed since it was built. */
  readonly syncToday: () => void;
  readonly dismissNotice: (id: Notice['id']) => void;
  /** Aborts any request in flight; its answer is dropped. For when the planner goes away. */
  readonly dispose: () => void;
}

const UNREADABLE: Notice = {
  id: 'restore',
  tone: 'warning',
  text: "We couldn't read your saved plan, so we started fresh.",
};
const RESTORE_NOTICES = {
  corrupt: UNREADABLE,
  version: UNREADABLE,
  stale: {
    id: 'restore',
    tone: 'info',
    text: 'Your saved event date has passed — start a new plan.',
  },
} satisfies Record<string, Notice>;
const STORAGE_NOTICE: Notice = {
  id: 'storage',
  tone: 'warning',
  text: "Your browser isn't letting us save — the plan works but won't survive a reload.",
};
const CLEARED_NOTICE: Notice = {
  id: 'cleared',
  tone: 'info',
  text: 'Your saved plan was removed from this browser.',
};

const NO_AI: AiView = { cached: false };

/** `notices` with `notice` added, replacing any with the same id. */
const withNotice = (notices: readonly Notice[], notice: Notice): readonly Notice[] => [
  ...notices.filter((n) => n.id !== notice.id),
  notice,
];

/** Removes the saved plan; a refusal is fine, since `savePlan` has already tried too. */
function removeSaved(storage: PlannerStorage | null): void {
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {
    // Storage refused (private mode, a sandboxed frame): there is nothing more to do.
  }
}

/** Builds a store with no plan. Nothing is read from storage until `hydrate()`. */
export function createPlannerStore({ client, storage, today }: PlannerDeps): PlannerStore {
  let snapshot: PlannerSnapshot = {
    plan: initialPlanState,
    notices: [],
    calls: client.calls(),
    aiView: NO_AI,
  };
  const listeners = new Set<() => void>();
  let inFlight: AbortController | undefined;
  /** The client's count when the request in flight started; the UI shows that one as "in progress". */
  let callsBefore = client.calls();
  let storageWarned = false;

  /** Settled calls: the one in flight counts once it settles, whenever the client ticks. */
  const settledCalls = (): number => (inFlight ? callsBefore : client.calls());

  function set(patch: Partial<Omit<PlannerSnapshot, 'calls'>>): void {
    snapshot = { ...snapshot, ...patch, calls: settledCalls() };
    for (const listener of listeners) listener();
  }

  function abort(): void {
    inFlight?.abort();
    inFlight = undefined;
  }

  /** Moves to `plan` with `patch`, saves it, and adds the storage notice the first time saving fails. */
  function commit(plan: PlanState, patch: Partial<Omit<PlannerSnapshot, 'plan' | 'calls'>> = {}) {
    let notices = patch.notices ?? snapshot.notices;
    const saved = storage !== null && savePlan(storage, plan);
    if (!saved && !storageWarned) {
      storageWarned = true;
      notices = withNotice(notices, STORAGE_NOTICE);
    }
    set({ ...patch, plan, notices });
  }

  /** Applies `action`; when it changes nothing, nothing is saved or announced. */
  function dispatch(action: PlanAction, patch?: Partial<Omit<PlannerSnapshot, 'plan' | 'calls'>>) {
    const plan = planReducer(snapshot.plan, action);
    if (plan !== snapshot.plan) commit(plan, patch);
  }

  const withoutAiNotice = (): readonly Notice[] => snapshot.notices.filter((n) => n.id !== 'ai');

  /**
   * The one AI request path: for the current plan, aborting any request still in flight. With a
   * `change`, it is an adjustment that sends the plan's current answer, when it has one, to revise.
   */
  async function ask(change?: string): Promise<void> {
    const state = snapshot.plan;
    if (state.phase !== 'ready') return;
    abort();
    const controller = new AbortController();
    callsBefore = client.calls();
    inFlight = controller;
    const { brief, generation } = state;
    const previous = state.ai.suggestions;
    const adjust: AdjustRequest | undefined =
      change === undefined ? undefined : { change, ...(previous ? { previous } : {}) };
    const sent = { sentBrief: brief, ...(adjust ? { adjust } : {}) };
    dispatch(
      { type: 'ai/requested', generation },
      { aiView: { ...sent, cached: false }, notices: withoutAiNotice() },
    );
    const result = await client.suggest(brief, controller.signal, adjust ? { adjust } : undefined);
    if (inFlight === controller) inFlight = undefined;
    if (controller.signal.aborted) {
      // A newer submit, a reset or dispose took over; only the call count may have moved.
      if (settledCalls() !== snapshot.calls) set({});
      return;
    }
    if (result.ok) {
      const { suggestions, meta, cached } = result.value;
      dispatch(
        { type: 'ai/applied', generation, suggestions, meta },
        { aiView: { ...sent, cached } },
      );
      return;
    }
    // A failed request keeps an earlier answer's suggestions, so the notice must not say "standard".
    const failure = clientErrorMessage(result.error, state.ai.suggestions !== undefined);
    dispatch(
      { type: 'ai/failed', generation, error: result.error.code },
      {
        aiView: { ...sent, cached: false, failure },
        notices: withNotice(snapshot.notices, { id: 'ai', tone: 'warning', text: failure }),
      },
    );
  }

  const idle = (): Promise<void> => Promise.resolve();

  function reset(): void {
    abort();
    dispatch({ type: 'plan/reset' }, { aiView: NO_AI, notices: withoutAiNotice() });
  }

  return {
    getState: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    hydrate() {
      if (storage === null) return;
      const loaded = loadPlan(storage, today());
      if (loaded.ok) {
        const { brief, ai } = loaded.value;
        if (ai.suggestions && ai.meta) {
          void client.remember(brief, { suggestions: ai.suggestions, meta: ai.meta });
        }
        commit(loaded.value, { aiView: NO_AI });
      } else if (loaded.error !== 'missing') {
        removeSaved(storage);
        set({ notices: withNotice(snapshot.notices, RESTORE_NOTICES[loaded.error]) });
      }
    },
    submit(brief) {
      const before = snapshot.plan;
      const next = planReducer(before, { type: 'brief/submitted', brief, today: today() });
      const accepted = next.phase === 'ready' && next.generation !== before.generation;
      if (!accepted) {
        // The old plan (and any request for it) stays; the reducer has set why.
        commit(next);
        return { accepted, settled: idle() };
      }
      const kept = snapshot.notices.filter((n) => n.id === 'storage');
      commit(next, { aiView: NO_AI, notices: kept });
      return { accepted, settled: ask() };
    },
    personalize: () => (inFlight ? idle() : ask()),
    adjust: (change) => (inFlight ? idle() : ask(change)),
    changeGuests(guests) {
      dispatch({ type: 'guests/changed', guests });
    },
    changeBudget(budget) {
      dispatch({ type: 'budget/changed', budget });
    },
    changeDate(date) {
      dispatch({ type: 'date/changed', date });
    },
    toggleTask(taskId) {
      dispatch({ type: 'task/toggled', taskId });
    },
    setVendorStatus(vendorId, status) {
      dispatch({ type: 'vendor/status', vendorId, status });
    },
    toggleChecklist(itemId) {
      dispatch({ type: 'vendor/check', itemId });
    },
    reset,
    clearData() {
      reset();
      removeSaved(storage);
      set({ notices: withNotice(snapshot.notices, CLEARED_NOTICE) });
    },
    syncToday() {
      const state = snapshot.plan;
      if (state.phase !== 'ready') return;
      const now = today();
      if (now !== state.today) dispatch({ type: 'today/changed', today: now });
    },
    dismissNotice(id) {
      if (snapshot.notices.some((n) => n.id === id)) {
        set({ notices: snapshot.notices.filter((n) => n.id !== id) });
      }
    },
    dispose: abort,
  };
}
