/**
 * The planner chunk's entry, loaded on demand by the app shell so the first page never carries the
 * reducer, persistence, the API client, zod or the workspace (R66/R67/R69).
 * Does: create a planner store (with the real client unless a test passes one) and either start a
 * plan from a brief or restore the saved one; render the notices and either the workspace or, with
 * no plan, whatever the app shell passes as children (the landing and the form).
 * Never does: call the AI except through `startPlan` (one call) and the store's commands; read the
 * clock except through `todayIso`.
 */
import { useEffect, type ReactElement, type ReactNode } from 'react';
import type { EventBrief } from '../../shared/schema.js';
import { createPlanClient, type PlanClient } from '../client/api-client.js';
import { Notices } from './notices.js';
import { createPlannerStore, type PlannerStorage, type PlannerStore } from './planner-store.js';
import { todayIso } from './today.js';
import { usePlanner } from './use-planner.js';
import { Workspace } from './workspace.js';
import './workspace.css';

/** What the app shell hands the planner. */
export interface PlannerSetup {
  /** The browser's storage, or `null` when it is unavailable. */
  readonly storage: PlannerStorage | null;
  /** The AI client; tests pass a fake. A real one is created when absent. */
  readonly client?: PlanClient | undefined;
}

function createStore({ storage, client = createPlanClient() }: PlannerSetup): PlannerStore {
  return createPlannerStore({ client, storage, today: () => todayIso() });
}

/** A new store for `brief`: the plan is built at once and its one AI call starts. */
export function startPlan(brief: EventBrief, setup: PlannerSetup): PlannerStore {
  const store = createStore(setup);
  void store.submit(brief);
  return store;
}

/** A new store holding the saved plan, if it could be restored. Never calls the AI. */
export function restorePlan(setup: PlannerSetup): PlannerStore {
  const store = createStore(setup);
  store.hydrate();
  return store;
}

/** Props for {@link Planner}. */
export interface PlannerProps {
  readonly store: PlannerStore;
  /** What to show while there is no plan: the landing and the brief form. */
  readonly children: ReactNode;
}

/** Notices, then the workspace for a ready plan or `children` without one. */
export function Planner({ store, children }: PlannerProps): ReactElement {
  const snapshot = usePlanner(store);

  // Coming back to the tab on another day re-plans against the new date (no AI call).
  useEffect(() => {
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') store.syncToday();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [store]);

  return (
    <>
      <Notices snapshot={snapshot} onDismiss={store.dismissNotice} />
      {snapshot.plan.phase === 'ready' ? (
        <Workspace state={snapshot.plan} snapshot={snapshot} store={store} />
      ) : (
        children
      )}
    </>
  );
}
