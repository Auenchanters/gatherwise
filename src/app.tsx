/**
 * The application shell: skip link, brand header and the single `<main>`.
 * Does: shows the landing and the brief form; fills the form from a sample, moves focus to its
 * heading and announces it politely; and for now only announces that a submitted plan is ready
 * (Task 15a wires the planner).
 * Never does: read the clock outside `todayIso`, or render more than one `<main>` or `<h1>`.
 */
import { useRef, useState, type ReactElement } from 'react';
import { flushSync } from 'react-dom';
import { BriefForm } from './features/brief/brief-form.js';
import { Landing } from './features/brief/landing.js';
import { sampleBrief, type SampleKind } from './features/brief/samples.js';
import { todayIso } from './features/plan/today.js';
import type { EventBrief } from './shared/schema.js';

/** How the sample announcement names each sample. */
const SAMPLE_NAMES: Record<SampleKind, string> = {
  community: 'community event',
  birthday: 'birthday',
};

/** What the brief form starts from; a new `key` remounts it with that brief. */
interface FormSeed {
  readonly key: number;
  readonly initial: EventBrief | undefined;
}

/** Application shell for the landing state. */
export function App(): ReactElement {
  const [today] = useState(() => todayIso());
  const [seed, setSeed] = useState<FormSeed>({ key: 0, initial: undefined });
  const [status, setStatus] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);

  const loadSample = (kind: SampleKind): void => {
    // Commit the refilled form first, so the heading that takes focus is the new one.
    flushSync(() => {
      setSeed((current) => ({ key: current.key + 1, initial: sampleBrief(kind, today) }));
      setStatus(
        `Filled in the sample ${SAMPLE_NAMES[kind]} — check the details, then generate your plan.`,
      );
    });
    headingRef.current?.focus();
  };

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
        <Landing onUseSample={loadSample} />
        <BriefForm
          key={seed.key}
          initial={seed.initial}
          today={today}
          headingRef={headingRef}
          onSubmit={() => {
            setStatus('Plan ready to generate');
          }}
        />
        <p className="app-status" role="status">
          {status}
        </p>
      </main>
    </>
  );
}
