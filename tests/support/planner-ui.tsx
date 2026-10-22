/**
 * Rendering helpers for the plan workspace's UI tests: a real planner store with a fake AI client,
 * opened on a brief, rendered the way the app shell renders it.
 * Does: share one `setup` between the workspace and tab test files, with today fixed at `TODAY`
 * so every date in a test is stable.
 * Never does: call the network or read the clock.
 */
import { act, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { sampleBrief } from '../../src/features/brief/samples.js';
import { Planner } from '../../src/features/plan/planner.js';
import { createPlannerStore, type PlannerStore } from '../../src/features/plan/planner-store.js';
import type { EventBrief } from '../../src/shared/schema.js';
import { fakeClient, memoryStorage, type MemoryStorage } from './fakes.js';
import { TODAY } from './fixtures.js';

/** The community sample: a festival 75 days out, so its timeline is mostly on track. */
export const festival = sampleBrief('community', TODAY);

/** Lets every answer the fake has already given land, and React render it. */
export const settle = (): Promise<void> =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

/** What `setup` hands back. */
interface Rendered {
  readonly user: ReturnType<typeof userEvent.setup>;
  readonly store: PlannerStore;
  readonly client: ReturnType<typeof fakeClient>;
  readonly storage: MemoryStorage;
}

/** Renders the planner around a store with a fake client; `start` opens a plan. */
export async function setup({
  client = fakeClient(),
  storage = memoryStorage(),
  start = festival,
}: {
  client?: ReturnType<typeof fakeClient>;
  storage?: MemoryStorage;
  start?: EventBrief | null;
} = {}): Promise<Rendered> {
  const user = userEvent.setup();
  const store = createPlannerStore({ client, storage, today: () => TODAY });
  // Not awaited: a fake that never answers leaves the plan pending, as a slow model would.
  if (start) store.submit(start);
  render(
    <main tabIndex={-1}>
      <Planner store={store}>
        <p>Landing and form</p>
      </Planner>
    </main>,
  );
  await settle();
  return { user, store, client, storage };
}
