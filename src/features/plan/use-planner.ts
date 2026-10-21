/**
 * The React binding for the planner store.
 * Does: re-renders a component whenever the store's snapshot changes (`useSyncExternalStore`).
 * Never does: start an AI call. Components call store commands from event handlers only, never
 * from effects, so StrictMode's double effects can never double a call.
 */
import { useSyncExternalStore } from 'react';
import type { PlannerSnapshot, PlannerStore } from './planner-store.js';

/** The store's current snapshot, kept up to date. */
export function usePlanner(store: PlannerStore): PlannerSnapshot {
  return useSyncExternalStore(store.subscribe, store.getState);
}
