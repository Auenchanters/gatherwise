/**
 * Moving focus to something a state change is about to render.
 * Never does: choose what takes focus (each caller does), or focus anything when the target is gone.
 */
import { flushSync } from 'react-dom';

/**
 * Runs `commit` and renders its state updates at once (React would otherwise batch them until
 * after this handler), then focuses what `target` finds in the new DOM, if anything.
 * @returns What `commit` returned, which `target` also receives.
 */
export function focusAfter<T>(
  commit: () => T,
  target: (result: T) => HTMLElement | null | undefined,
): T {
  const result = flushSync(commit);
  target(result)?.focus();
  return result;
}
