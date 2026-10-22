/**
 * The application shell: skip link, brand header and the single `<main>`.
 * Does: show the landing and the brief form; fill the form from a sample, moving focus to its
 * heading and announcing it politely; load the planner chunk on demand, either to restore a saved
 * plan (when storage holds one) or, inside the form's submit handler, to start a new one. Once the
 * planner is loaded it owns the page and shows the landing again whenever there is no plan.
 * Never does: import the reducer, persistence, the API client, zod or the workspace (they would
 * break the entry-size budget that `scripts/bundle-budget.mjs` enforces); start an AI call (only
 * planner commands do); read the clock outside `todayIso`; or render more than one `<main>` or
 * `<h1>`.
 */
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { BriefForm } from './features/brief/brief-form.js';
import { Landing } from './features/brief/landing.js';
import { sampleBrief, type SampleKind } from './features/brief/samples.js';
import type { PlanClient } from './features/client/api-client.js';
import type { PlannerStorage, PlannerStore } from './features/plan/planner-store.js';
import { refusalTarget, STORAGE_KEY } from './features/plan/storage-key.js';
import { todayIso } from './features/plan/today.js';
import type { EventBrief } from './shared/schema.js';
import { focusAfter } from './ui/focus.js';

type PlannerModule = typeof import('./features/plan/planner.js');

/** The loaded planner: its root component and the store it renders. */
interface Session {
  readonly Planner: PlannerModule['Planner'];
  readonly store: PlannerStore;
}

const loadPlanner = (): Promise<PlannerModule> => import('./features/plan/planner.js');

/** How the sample announcement names each sample. */
const SAMPLE_NAMES: Record<SampleKind, string> = {
  community: 'community event',
  wedding: 'wedding',
  birthday: 'birthday',
};

const OPEN_FAILED =
  "We couldn't open the planner — check your connection, then try again or reload the page.";
const RESTORE_FAILED =
  "We couldn't load your saved plan — check your connection and reload the page, or start a new plan below.";

/** `localStorage`, or `null` where the browser forbids it (some private modes, sandboxed frames). */
function browserStorage(): PlannerStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Whether storage holds a saved plan; reading can throw too. */
function hasSavedPlan(storage: PlannerStorage | null): boolean {
  try {
    return storage !== null && storage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

/** What the brief form starts from; a new `key` remounts it with that brief. */
interface FormSeed {
  readonly key: number;
  readonly initial: EventBrief | undefined;
}

/** Props for {@link App}; both exist for tests, and the defaults are the real browser ones. */
export interface AppProps {
  /** The AI client the planner uses; a real one is created with the planner when absent. */
  readonly client?: PlanClient | undefined;
  /** Where the plan is saved; `localStorage` when absent. */
  readonly storage?: PlannerStorage | null | undefined;
}

/** The application shell. */
export function App({ client, storage: given }: AppProps): ReactElement {
  const [storage] = useState(() => (given === undefined ? browserStorage() : given));
  const [today] = useState(() => todayIso());
  const [seed, setSeed] = useState<FormSeed>({ key: 0, initial: undefined });
  const [status, setStatus] = useState('');
  const [session, setSession] = useState<Session>();
  const [restoring, setRestoring] = useState(() => hasSavedPlan(storage));
  const opening = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Loading a chunk is not an AI call: `restorePlan` only reads storage.
  useEffect(() => {
    if (!restoring) return;
    let live = true;
    void loadPlanner().then(
      (planner) => {
        if (!live) return;
        setSession({ Planner: planner.Planner, store: planner.restorePlan({ storage, client }) });
        setRestoring(false);
      },
      () => {
        if (!live) return;
        setStatus(RESTORE_FAILED);
        setRestoring(false);
      },
    );
    return () => {
      live = false;
    };
  }, [restoring, storage, client]);

  const loadSample = (kind: SampleKind): void => {
    // Commit the refilled form first, so the heading that takes focus is the new one.
    focusAfter(
      () => {
        setSeed((current) => ({ key: current.key + 1, initial: sampleBrief(kind, today) }));
        setStatus(
          `Filled in the sample ${SAMPLE_NAMES[kind]} — check the details, then generate your plan.`,
        );
      },
      () => headingRef.current,
    );
  };

  /** The next time the form shows (after "New plan"), it starts blank. */
  const blankForm = (): void => {
    setSeed((current) => ({ key: current.key + 1, initial: undefined }));
    // A sample's "Filled in…" line described the form that was just submitted, not this blank one.
    setStatus('');
  };

  /**
   * The form's submit: start the plan, loading the planner first if this is the first one. Each
   * update is rendered at once (`focusAfter`), so a refusal's message exists to take focus, and a
   * refused brief stays in the form.
   */
  const submit = (brief: EventBrief): void => {
    if (session) {
      const { accepted } = focusAfter(() => session.store.submit(brief), refusalTarget);
      if (accepted) blankForm();
      return;
    }
    if (opening.current) return;
    opening.current = true;
    setStatus('Opening your plan…');
    void loadPlanner()
      .then(
        (planner) => {
          const { store, accepted } = planner.startPlan(brief, { storage, client });
          focusAfter(
            () => {
              setSession({ Planner: planner.Planner, store });
              setStatus('');
              // The form remounts inside the planner; a refused brief comes back filled in.
              setSeed((current) => ({
                key: current.key + 1,
                initial: accepted ? undefined : brief,
              }));
            },
            () => refusalTarget({ accepted }),
          );
        },
        () => {
          setStatus(OPEN_FAILED);
        },
      )
      .finally(() => {
        opening.current = false;
      });
  };

  const start = (
    <>
      <Landing onUseSample={loadSample} />
      <BriefForm
        key={seed.key}
        initial={seed.initial}
        today={today}
        headingRef={headingRef}
        onSubmit={submit}
      />
      <p className="app-status" role="status">
        {status}
      </p>
    </>
  );

  let content: ReactNode = start;
  if (restoring) {
    content = (
      <section className="welcome">
        <h1>Welcome back</h1>
        <p className="app-status" role="status">
          Loading your saved plan…
        </p>
      </section>
    );
  } else if (session) {
    // The planner module has already loaded (the status said "Opening your plan…" meanwhile), so
    // there is nothing left to suspend on.
    content = <session.Planner store={session.store}>{start}</session.Planner>;
  }

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <header className="site-header">
        <p className="brand">
          <span className="brand__name">Gatherwise</span>
          <span className="brand__tagline">Plans that add up.</span>
        </p>
      </header>
      <main id="main" tabIndex={-1}>
        {content}
      </main>
    </>
  );
}
