import type { ReactElement } from 'react';

/** Application shell: skip link, brand header and the landing landmark. */
export function App(): ReactElement {
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <header className="site-header">
        <p className="brand">Gatherwise</p>
      </header>
      <main id="main" tabIndex={-1}>
        <h1>Gatherwise</h1>
        <p className="tagline">Plans that add up.</p>
        <p className="lede">
          A GenAI planning assistant for community events, weddings and birthdays — budgets that
          reconcile, timelines that respect lead times, vendor checklists and personalized ideas.
        </p>
      </main>
    </>
  );
}
