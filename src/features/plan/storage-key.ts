/**
 * Constants the first page needs before the planner loads, in a module with no imports: the
 * browser-storage key for the saved plan, and the id of the plan's error message (the app shell
 * moves focus to it when a brief is refused, via `refusalTarget`).
 * Never does: read or write storage itself (persist.ts does).
 */

/** The storage key; the version in it changes with the stored shape. */
export const STORAGE_KEY = 'gatherwise.plan.v1';

/** The id of the message that says why the plan refused a brief or an edit. */
export const PLAN_ERROR_ID = 'plan-error';

/** Where focus goes after a brief is submitted: to the plan's error message if it was refused. */
export const refusalTarget = ({ accepted }: { readonly accepted: boolean }): HTMLElement | null =>
  accepted ? null : document.getElementById(PLAN_ERROR_ID);
