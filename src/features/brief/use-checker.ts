/**
 * Loads the brief checker (validate.ts, with zod and the schema) on demand, so the first page
 * never carries it.
 * Does: warms the chunk once on request (the form asks when its submit button is focused or
 * pressed); while a submit waits for it, reports `checking`, plus a `checking` notice after 150 ms;
 * reports a failed load as a notice; and drops the submit when the form unmounted meanwhile (a
 * sample replaced it), so a stale brief never reaches `onSubmit`.
 * Never does: validate anything itself, or let a failed load throw.
 */
import { useEffect, useRef, useState } from 'react';

/** The checker module, as loaded on demand. */
type Checker = typeof import('./validate.js');
/** What the form tells the user about the checker. */
export type CheckerNotice = 'none' | 'checking' | 'failed';

/** How long the checker may take to load before the form says it is working. */
const SLOW_CHECK_MS = 150;
/** The chunk, or `undefined` when it cannot be fetched (offline, or a deploy replaced it). */
const loadChecker = (): Promise<Checker | undefined> =>
  import('./validate.js').catch(() => undefined);

/** The on-demand checker for one mounted form. */
export function useChecker(): {
  /** True while a submit waits for the checker; the submit button shows it and ignores presses. */
  readonly checking: boolean;
  readonly notice: CheckerNotice;
  /** Starts loading the chunk early; only the first call does anything. */
  readonly warm: () => void;
  /** Loads the checker, then calls `run` with it, unless the load failed or the form went away. */
  readonly withChecker: (run: (checker: Checker) => void) => Promise<void>;
} {
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState<CheckerNotice>('none');
  const warmed = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    // Set on every mount, not only the first: StrictMode unmounts and remounts once in development.
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const warm = (): void => {
    if (warmed.current) return;
    warmed.current = true;
    void loadChecker();
  };

  const withChecker = async (run: (checker: Checker) => void): Promise<void> => {
    setChecking(true);
    const slow = window.setTimeout(() => {
      setNotice('checking');
    }, SLOW_CHECK_MS);
    const checker = await loadChecker();
    window.clearTimeout(slow);
    if (!alive.current) return;
    setChecking(false);
    setNotice(checker === undefined ? 'failed' : 'none');
    if (checker !== undefined) run(checker);
  };

  return { checking, notice, warm, withChecker };
}
