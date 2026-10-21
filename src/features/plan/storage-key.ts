/**
 * The browser-storage key for the saved plan, in a module with no imports, so the first page can
 * check for a saved plan without loading zod or the planner.
 * Never does: read or write storage itself (persist.ts does).
 */

/** The storage key; the version in it changes with the stored shape. */
export const STORAGE_KEY = 'gatherwise.plan.v1';
