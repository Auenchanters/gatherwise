/**
 * Tests for src/features/plan/planner-store.ts, the one place the UI's AI calls start.
 *
 * Does: drives the store through a fake client that counts `suggest` calls, so every claim in the
 * model-call budget is a count: a plan costs one call, edits cost none, an "Adjust with AI" costs
 * one and is ignored while one is pending, a restored plan never calls until asked. Also covers aborts and
 * stale answers, every restore outcome, the storage notice, clearing data and the day changing.
 * Never does: call the network, touch a real localStorage or read the clock.
 */
import { describe, expect, it, vi } from 'vitest';
import { addDays, type IsoDate } from '../../src/domain/dates.js';
import { initialPlanState, type ReadyState } from '../../src/domain/reducer.js';
import {
  createPlanClient,
  type ClientError,
  type PlanClient,
} from '../../src/features/client/api-client.js';
import { clientErrorMessage } from '../../src/features/client/messages.js';
import { createPlannerStore, type PlannerSnapshot } from '../../src/features/plan/planner-store.js';
import { STORAGE_KEY } from '../../src/features/plan/storage-key.js';
import { err, ok } from '../../src/shared/result.js';
import {
  deferred,
  fakeClient,
  freshAnswer as fresh,
  memoryStorage,
  planned,
  savedStorage,
  type Answer,
  type MemoryStorage,
} from '../support/fakes.js';
import { aiMeta, aiSuggestions, brief, TODAY as today } from '../support/fixtures.js';

const festival = brief('community', { date: addDays(today, 40) });

function setup({
  client = fakeClient(),
  storage = memoryStorage(),
  day = (): IsoDate => today,
}: {
  client?: ReturnType<typeof fakeClient>;
  storage?: MemoryStorage | null;
  day?: () => IsoDate;
} = {}) {
  const store = createPlannerStore({ client, storage, today: day });
  return { store, client, storage };
}

function ready(snapshot: PlannerSnapshot): ReadyState {
  if (snapshot.plan.phase !== 'ready') throw new Error('expected a ready plan');
  return snapshot.plan;
}

const texts = (snapshot: PlannerSnapshot): string[] => snapshot.notices.map((n) => n.text);

describe('submit', () => {
  it('builds the plan at once, then makes exactly one AI call and applies it', async () => {
    const { store, client } = setup();
    const submission = store.submit(festival);
    expect(submission.accepted).toBe(true);
    const pending = ready(store.getState());
    expect(pending.brief).toBe(festival);
    expect(pending.ai.status).toBe('pending');
    await submission.settled;
    const state = store.getState();
    expect(client.suggest).toHaveBeenCalledTimes(1);
    expect(client.suggest.mock.calls[0]?.[0]).toBe(festival);
    expect(client.suggest.mock.calls[0]?.[2]).toBeUndefined();
    expect(ready(state).ai.status).toBe('applied');
    expect(state.calls).toBe(1);
    expect(state.aiView).toEqual({ sentBrief: festival, cached: false });
  });

  it('keeps calls at one through every kind of edit', async () => {
    const { store, client } = setup();
    await store.submit(festival).settled;
    const { plan } = ready(store.getState());
    const task = plan.schedule.tasks[0]?.id ?? '';
    const vendor = plan.vendors[0];
    store.changeGuests(400);
    store.changeBudget(200_000);
    store.changeDate(addDays(today, 50));
    store.toggleTask(task);
    store.setVendorStatus(vendor?.id ?? '', 'booked');
    store.toggleChecklist(vendor?.checklist[0]?.id ?? '');
    const after = ready(store.getState());
    expect(after.brief).toMatchObject({ guests: 400, budget: 200_000, date: addDays(today, 50) });
    expect(after.progress.doneTasks).toEqual([task]);
    expect(after.progress.vendorStatus).toEqual({ [vendor?.id ?? '']: 'booked' });
    expect(after.progress.checklistDone).toEqual([vendor?.checklist[0]?.id]);
    expect(client.suggest).toHaveBeenCalledTimes(1);
    expect(store.getState().calls).toBe(1);
  });

  it('records a cache hit as reused, with no new call counted', async () => {
    const reused: Answer = ok({ suggestions: aiSuggestions, meta: aiMeta, cached: true });
    const { store } = setup({
      client: fakeClient(() => Promise.resolve(reused), { counting: false }),
    });
    await store.submit(festival).settled;
    expect(store.getState().aiView.cached).toBe(true);
    expect(store.getState().calls).toBe(0);
  });

  it('shows a failure as a notice and keeps the deterministic plan', async () => {
    const failure: ClientError = { code: 'rate_limited', retryAfterSeconds: 120 };
    const { store } = setup({ client: fakeClient(() => Promise.resolve(err(failure))) });
    await store.submit(festival).settled;
    const state = store.getState();
    expect(ready(state).ai).toEqual({ status: 'failed', error: 'rate_limited' });
    expect(ready(state).plan.budget.lines.length).toBeGreaterThan(0);
    expect(state.notices).toEqual([
      { id: 'ai', tone: 'warning', text: clientErrorMessage(failure) },
    ]);
    expect(state.aiView.failure).toBe(clientErrorMessage(failure));
    expect(state.aiView.failure).toContain('standard suggestions');
  });

  it('a failed adjustment that keeps earlier AI ideas does not claim standard suggestions', async () => {
    const failure: ClientError = { code: 'timeout' };
    const answers: Answer[] = [fresh, err(failure)];
    const { store } = setup({
      client: fakeClient(() => Promise.resolve(answers.shift() ?? fresh)),
    });
    await store.submit(festival).settled;
    await store.adjust('');
    const state = store.getState();
    expect(ready(state).ai.status).toBe('failed');
    expect(ready(state).ai.suggestions).toBeDefined();
    expect(texts(state)).toEqual([clientErrorMessage(failure, true)]);
    expect(state.aiView.failure).toBe(clientErrorMessage(failure, true));
    expect(state.aiView.failure).toContain('your current ideas are unchanged');
    expect(state.aiView.failure).not.toContain('standard suggestions');
  });

  it('a later success clears the failure notice', async () => {
    let answer: Answer = err({ code: 'timeout' });
    const { store } = setup({ client: fakeClient(() => Promise.resolve(answer)) });
    await store.submit(festival).settled;
    expect(texts(store.getState())).toHaveLength(1);
    answer = fresh;
    await store.personalize();
    expect(store.getState().notices).toEqual([]);
    expect(store.getState().aiView.failure).toBeUndefined();
  });

  it('aborts the request in flight when a new brief is submitted', async () => {
    const first = deferred<Answer>();
    const { store, client } = setup({
      client: fakeClient((b) => (b === festival ? first.promise : Promise.resolve(fresh))),
    });
    store.submit(festival);
    const signal = client.suggest.mock.calls[0]?.[1];
    expect(signal?.aborted).toBe(false);
    const other = brief('community', { date: addDays(today, 30), name: 'Second plan' });
    const second = store.submit(other).settled;
    expect(signal?.aborted).toBe(true);
    first.resolve(err({ code: 'network' }));
    await second;
    const state = store.getState();
    expect(ready(state).brief).toBe(other);
    expect(ready(state).ai.status).toBe('applied');
    expect(state.notices).toEqual([]);
  });

  it('ignores a slow answer for a plan that was reset away and replaced', async () => {
    const slow = deferred<Answer>();
    const other = brief('community', { date: addDays(today, 30), name: 'Second plan' });
    const otherAnswer = deferred<Answer>();
    const { store } = setup({
      // This fake ignores the abort signal and answers anyway; the answer must still be dropped.
      client: fakeClient((b) => (b === festival ? slow.promise : otherAnswer.promise)),
    });
    const stale = store.submit(festival).settled;
    store.reset();
    const current = store.submit(other).settled;
    slow.resolve(fresh);
    await stale;
    expect(ready(store.getState()).ai.status).toBe('pending');
    expect(ready(store.getState()).generation).toBe(2);
    const answer = { ...aiSuggestions, summary: 'For the second plan.' };
    otherAnswer.resolve(ok({ suggestions: answer, meta: aiMeta, cached: false }));
    await current;
    expect(ready(store.getState()).ai.suggestions).toBe(answer);
  });

  it('reports a brief that cannot be planned as refused, and does not ask the AI', async () => {
    const { store, client } = setup();
    const submission = store.submit(brief('community', { date: addDays(today, -1) }));
    expect(submission.accepted).toBe(false);
    await submission.settled;
    expect(store.getState().plan).toEqual({
      ...initialPlanState,
      error: { kind: 'invalid_date', reason: 'past' },
    });
    expect(client.suggest).not.toHaveBeenCalled();
  });

  it('a refused brief keeps the open plan and its request', async () => {
    const answer = deferred<Answer>();
    const { store, client } = setup({ client: fakeClient(() => answer.promise) });
    const first = store.submit(festival).settled;
    const refused = store.submit(brief('community', { date: addDays(today, -1) }));
    expect(refused.accepted).toBe(false);
    expect(client.suggest.mock.calls[0]?.[1].aborted).toBe(false);
    answer.resolve(fresh);
    await first;
    expect(ready(store.getState()).brief).toBe(festival);
    expect(ready(store.getState()).ai.status).toBe('applied');
  });

  it('counts a request once it has settled, so edits while it is pending do not jump ahead', async () => {
    const answer = deferred<Answer>();
    const { store } = setup({ client: fakeClient(() => answer.promise) });
    const request = store.submit(festival).settled;
    store.changeGuests(300);
    expect(store.getState().calls).toBe(0);
    answer.resolve(fresh);
    await request;
    expect(store.getState().calls).toBe(1);
  });

  it('clears notices from the previous plan, except the storage warning', async () => {
    const { store } = setup({
      client: fakeClient(() => Promise.resolve(err({ code: 'network' }))),
      storage: memoryStorage(undefined, { refuseWrites: true }),
    });
    await store.submit(festival).settled;
    expect(store.getState().notices.map((n) => n.id)).toEqual(['storage', 'ai']);
    store.submit(festival);
    expect(store.getState().notices.map((n) => n.id)).toEqual(['storage']);
  });
});

describe('personalize and adjust', () => {
  it('personalize asks once for the current brief and uses the cache', async () => {
    const { store, client } = setup({ storage: savedStorage(planned(festival)) });
    store.hydrate();
    expect(ready(store.getState()).ai.status).toBe('idle');
    await store.personalize();
    expect(client.suggest).toHaveBeenCalledTimes(1);
    expect(client.suggest.mock.calls[0]?.[2]).toBeUndefined();
    expect(ready(store.getState()).ai.status).toBe('applied');
    expect(store.getState().calls).toBe(1);
    expect(store.getState().aiView.adjust).toBeUndefined();
  });

  it('adjust costs one call with the change and the current answer, and is ignored while pending', async () => {
    const answers = [Promise.resolve(fresh)];
    const adjusting = deferred<Answer>();
    const { store, client } = setup({
      client: fakeClient(() => answers.shift() ?? adjusting.promise),
    });
    await store.submit(festival).settled;
    const first = store.adjust('Make it cheaper');
    const second = store.adjust('ignored');
    void store.personalize();
    expect(client.suggest).toHaveBeenCalledTimes(2);
    const adjust = { change: 'Make it cheaper', previous: aiSuggestions };
    expect(client.suggest.mock.calls[1]?.[2]).toEqual({ adjust });
    adjusting.resolve(fresh);
    await Promise.all([first, second]);
    expect(store.getState().calls).toBe(2);
    expect(ready(store.getState()).ai.status).toBe('applied');
    // The Ideas tab announces this answer and the AI panel rebuilds its prompt from the view.
    expect(store.getState().aiView).toEqual({ sentBrief: festival, adjust, cached: false });
  });

  it('adjusts a plan with no AI answer yet by sending the change alone', async () => {
    const answers: Answer[] = [err({ code: 'timeout' }), fresh];
    const { store, client } = setup({
      client: fakeClient(() => Promise.resolve(answers.shift() ?? fresh)),
    });
    await store.submit(festival).settled;
    expect(ready(store.getState()).ai.suggestions).toBeUndefined();
    await store.adjust('More for kids');
    expect(client.suggest.mock.calls[1]?.[2]).toEqual({ adjust: { change: 'More for kids' } });
    expect(ready(store.getState()).ai.status).toBe('applied');
  });

  it('does nothing without a plan', async () => {
    const { store, client } = setup();
    await store.personalize();
    await store.adjust('cheaper');
    expect(client.suggest).not.toHaveBeenCalled();
    expect(store.getState().plan).toBe(initialPlanState);
  });
});

describe('hydrate', () => {
  it('restores a saved plan with its AI answer and never calls', () => {
    const { store, client, storage } = setup({
      storage: savedStorage(planned(festival, { withAi: true })),
    });
    store.hydrate();
    const state = store.getState();
    expect(ready(state).brief).toEqual(festival);
    expect(ready(state).ai.status).toBe('applied');
    expect(state.notices).toEqual([]);
    expect(storage?.removed).toEqual([]);
    expect(client.suggest).not.toHaveBeenCalled();
    expect(state.calls).toBe(0);
  });

  it("hands the restored answer to the client's cache under the restored brief", () => {
    const { store, client } = setup({
      storage: savedStorage(planned(festival, { withAi: true })),
    });
    store.hydrate();
    expect(client.remember).toHaveBeenCalledOnce();
    expect(client.remember).toHaveBeenCalledWith(festival, {
      suggestions: aiSuggestions,
      meta: aiMeta,
    });
  });

  it('seeds nothing for a restored plan that has no AI answer', () => {
    const { store, client } = setup({ storage: savedStorage(planned(festival)) });
    store.hydrate();
    expect(ready(store.getState()).ai.status).toBe('idle');
    expect(client.remember).not.toHaveBeenCalled();
  });

  it('makes the same brief cost no call after a reload, with the real client', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.reject(new Error('no network in tests')));
    const real = createPlanClient({ fetchImpl });
    // The cache key is a SHA-256, so seeding settles a moment after hydrate returns (a person is
    // slower still); the test waits for the store's own seeding to settle.
    let seeded: Promise<void> | undefined;
    const client: PlanClient = {
      ...real,
      remember: (b, answer) => {
        seeded = real.remember(b, answer);
        return seeded;
      },
    };
    const store = createPlannerStore({
      client,
      storage: savedStorage(planned(festival, { withAi: true })),
      today: () => today,
    });
    store.hydrate();
    expect(seeded).toBeInstanceOf(Promise);
    await seeded;
    await store.submit(festival).settled;
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(store.getState().calls).toBe(0);
    expect(store.getState().aiView).toEqual({ sentBrief: festival, cached: true });
  });

  it('does nothing when nothing is saved', () => {
    const { store, storage } = setup();
    const before = store.getState();
    store.hydrate();
    expect(store.getState()).toBe(before);
    expect(storage?.removed).toEqual([]);
  });

  it.each([
    ['corrupt', '{not json', "We couldn't read your saved plan, so we started fresh."],
    ['version', '{"v":2}', "We couldn't read your saved plan, so we started fresh."],
  ])('removes a %s value and says so once', (_kind, text, notice) => {
    const { store, storage, client } = setup({ storage: memoryStorage(text) });
    store.hydrate();
    expect(store.getState().plan).toBe(initialPlanState);
    expect(store.getState().notices).toEqual([{ id: 'restore', tone: 'warning', text: notice }]);
    expect(storage?.removed).toEqual([STORAGE_KEY]);
    expect(client.suggest).not.toHaveBeenCalled();
  });

  it('removes a plan whose event date has passed and says so', () => {
    const { store, storage } = setup({
      storage: savedStorage(planned(festival)),
      day: () => addDays(today, 41),
    });
    store.hydrate();
    expect(store.getState().plan).toBe(initialPlanState);
    expect(store.getState().notices).toEqual([
      {
        id: 'restore',
        tone: 'info',
        text: 'Your saved event date has passed — start a new plan.',
      },
    ]);
    expect(storage?.removed).toEqual([STORAGE_KEY]);
  });

  it('does nothing without storage', () => {
    const { store } = setup({ storage: null });
    store.hydrate();
    expect(store.getState().plan).toBe(initialPlanState);
  });
});

describe('saving', () => {
  it('saves after every change, so a reload restores the edits', async () => {
    const storage = memoryStorage();
    const { store } = setup({ storage });
    await store.submit(festival).settled;
    store.changeGuests(320);
    const reloaded = setup({ storage }).store;
    reloaded.hydrate();
    expect(ready(reloaded.getState()).brief.guests).toBe(320);
    expect(ready(reloaded.getState()).ai.status).toBe('applied');
  });

  it('warns exactly once when the browser refuses to save', async () => {
    const { store } = setup({ storage: memoryStorage(undefined, { refuseWrites: true }) });
    await store.submit(festival).settled;
    store.changeGuests(300);
    store.changeGuests(310);
    expect(store.getState().notices).toEqual([
      {
        id: 'storage',
        tone: 'warning',
        text: "Your browser isn't letting us save — the plan works but won't survive a reload.",
      },
    ]);
  });

  it('warns once when there is no storage at all', async () => {
    const { store } = setup({ storage: null });
    await store.submit(festival).settled;
    store.changeGuests(300);
    expect(store.getState().notices.map((n) => n.id)).toEqual(['storage']);
  });
});

describe('reset and clearData', () => {
  it('reset aborts the request in flight, empties the plan and drops the late answer', async () => {
    const late = deferred<Answer>();
    const { store, client } = setup({ client: fakeClient(() => late.promise) });
    const request = store.submit(festival).settled;
    store.reset();
    expect(client.suggest.mock.calls[0]?.[1].aborted).toBe(true);
    const after = store.getState();
    expect(after.plan).toEqual({ phase: 'empty', generation: 1 });
    expect(after.aiView).toEqual({ cached: false });
    expect(after.calls).toBe(1);
    late.resolve(fresh);
    await request;
    expect(store.getState()).toBe(after);
  });

  it('dispose aborts the request in flight and drops its late answer', async () => {
    const late = deferred<Answer>();
    const { store, client } = setup({ client: fakeClient(() => late.promise) });
    const request = store.submit(festival).settled;
    store.dispose();
    expect(client.suggest.mock.calls[0]?.[1].aborted).toBe(true);
    const { plan } = store.getState();
    late.resolve(fresh);
    await request;
    // The answer is dropped; the request was sent, so it still counts.
    expect(store.getState().plan).toBe(plan);
    expect(store.getState().calls).toBe(1);
    store.dispose();
  });

  it('clearData empties the plan, removes the saved copy and says so', async () => {
    const storage = memoryStorage();
    const { store } = setup({ storage });
    await store.submit(festival).settled;
    store.clearData();
    expect(store.getState().plan.phase).toBe('empty');
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
    expect(storage.removed).toContain(STORAGE_KEY);
    expect(texts(store.getState())).toEqual(['Your saved plan was removed from this browser.']);
  });

  it('clearData copes with storage that throws or is missing', async () => {
    for (const storage of [memoryStorage(undefined, { refuseWrites: true }), null]) {
      const { store } = setup({ storage });
      await store.submit(festival).settled;
      if (storage) {
        storage.removeItem = () => {
          throw new DOMException('denied', 'SecurityError');
        };
      }
      store.clearData();
      expect(store.getState().plan.phase).toBe('empty');
      expect(texts(store.getState())).toContain('Your saved plan was removed from this browser.');
    }
  });
});

describe('notices and subscriptions', () => {
  it('dismissNotice removes one notice by id', async () => {
    const { store } = setup({
      client: fakeClient(() => Promise.resolve(err({ code: 'invalid' }))),
      storage: null,
    });
    await store.submit(festival).settled;
    store.dismissNotice('storage');
    expect(store.getState().notices.map((n) => n.id)).toEqual(['ai']);
    const before = store.getState();
    store.dismissNotice('restore'); // not showing, so nothing changes
    expect(store.getState()).toBe(before);
  });

  it('tells subscribers about each change until they unsubscribe', async () => {
    const { store } = setup();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    await store.submit(festival).settled;
    const seen = listener.mock.calls.length;
    expect(seen).toBeGreaterThanOrEqual(2);
    unsubscribe();
    store.changeGuests(300);
    expect(listener).toHaveBeenCalledTimes(seen);
  });

  it('keeps the same snapshot when an action changes nothing', async () => {
    const { store } = setup();
    await store.submit(festival).settled;
    const before = store.getState();
    store.toggleTask('no-such-task');
    expect(store.getState()).toBe(before);
  });
});

describe('syncToday', () => {
  it('moves the plan to the new day only when the date has changed', async () => {
    let now = today;
    const { store } = setup({ day: () => now });
    await store.submit(festival).settled;
    const before = store.getState();
    store.syncToday();
    expect(store.getState()).toBe(before);
    now = addDays(today, 1);
    store.syncToday();
    expect(ready(store.getState()).today).toBe(now);
    expect(store.getState().calls).toBe(1);
  });

  it('does nothing without a plan', () => {
    const { store } = setup();
    const before = store.getState();
    store.syncToday();
    expect(store.getState()).toBe(before);
  });
});
