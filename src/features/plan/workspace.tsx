/**
 * The plan workspace: header, the infeasible-deadlines banner and the tabs (Overview, Budget,
 * Timeline, Vendors, Ideas and, for community events, Volunteers). "Edit details" swaps the tabs
 * for the brief form, filled with the current brief.
 * Does: move focus to the event name whenever a plan opens; send every user action to a store
 * command from its event handler.
 * Never does: call the AI from an effect, or keep plan state of its own (only which tab is open
 * and whether the form is showing).
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { flushSync } from 'react-dom';
import type { ReadyState } from '../../domain/reducer.js';
import { BriefForm } from '../brief/brief-form.js';
import { Budget } from './budget.js';
import { Header } from './header.js';
import { InfeasibleBanner } from './infeasible-banner.js';
import { Overview } from './overview.js';
import type { PlannerSnapshot, PlannerStore } from './planner-store.js';
import { PLAN_ERROR_ID } from './storage-key.js';
import { panelId, tabId, Tabs, type TabSpec } from './tabs.js';

type TabId = 'overview' | 'budget' | 'timeline' | 'vendors' | 'ideas' | 'volunteers';

/** A tab whose content arrives in the next step; still a real, labelled, focusable panel. */
function Placeholder({ title }: { readonly title: string }): ReactElement {
  return (
    <section className="placeholder">
      <h2 className="panel-title">{title}</h2>
      <p>Coming in the next step.</p>
    </section>
  );
}

/** Props for {@link Workspace}. */
export interface WorkspaceProps {
  readonly state: ReadyState;
  readonly snapshot: PlannerSnapshot;
  readonly store: PlannerStore;
}

/** The workspace for a ready plan. */
export function Workspace({ state, snapshot, store }: WorkspaceProps): ReactElement {
  const [tab, setTab] = useState<TabId>('overview');
  const [editing, setEditing] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const formHeadingRef = useRef<HTMLHeadingElement>(null);

  // Each submitted brief is a new generation: a plan has opened, so the event name takes focus.
  useEffect(() => {
    headingRef.current?.focus();
  }, [state.generation]);

  /** Runs a command that closes the plan, then puts focus on `<main>`, since this view is gone. */
  const close = (command: () => void): void => {
    const main = rootRef.current?.closest('main');
    flushSync(command);
    main?.focus();
  };

  const tabs: TabSpec<TabId>[] = [
    {
      id: 'overview',
      label: 'Overview',
      panel: (
        <Overview
          state={state}
          snapshot={snapshot}
          onPersonalize={() => void store.personalize()}
        />
      ),
    },
    { id: 'budget', label: 'Budget', panel: <Budget state={state} store={store} /> },
    { id: 'timeline', label: 'Timeline', panel: <Placeholder title="Timeline" /> },
    { id: 'vendors', label: 'Vendors', panel: <Placeholder title="Vendors" /> },
    { id: 'ideas', label: 'Ideas', panel: <Placeholder title="Ideas" /> },
  ];
  if (state.brief.kind === 'community') {
    tabs.push({ id: 'volunteers', label: 'Volunteers', panel: <Placeholder title="Volunteers" /> });
  }
  // An edit can turn a community event into another kind, taking its Volunteers tab away.
  const selected = tabs.some((t) => t.id === tab) ? tab : 'overview';

  return (
    <div className="workspace" ref={rootRef}>
      <Header
        state={state}
        headingRef={headingRef}
        onEdit={() => {
          flushSync(() => {
            setEditing(true);
          });
          formHeadingRef.current?.focus();
        }}
        onNewPlan={() => {
          close(store.reset);
        }}
        onClearData={() => {
          close(store.clearData);
        }}
      />
      {editing ? (
        <div className="workspace__edit">
          <BriefForm
            initial={state.brief}
            today={state.today}
            headingRef={formHeadingRef}
            onSubmit={(brief) => {
              // Rendered at once, so a refusal's message exists to take focus.
              const { accepted } = flushSync(() => store.submit(brief));
              // A refused brief keeps the form, with everything typed, and says why.
              if (accepted) setEditing(false);
              else document.getElementById(PLAN_ERROR_ID)?.focus();
            }}
          />
          <button
            className="button button--secondary workspace__cancel"
            type="button"
            onClick={() => {
              flushSync(() => {
                setEditing(false);
              });
              headingRef.current?.focus();
            }}
          >
            Cancel editing
          </button>
        </div>
      ) : (
        <>
          <InfeasibleBanner
            schedule={state.plan.schedule}
            timelineId={panelId('timeline')}
            onSeeTimeline={() => {
              setTab('timeline');
              document.getElementById(tabId('timeline'))?.focus();
            }}
          />
          <Tabs label="Plan sections" tabs={tabs} selected={selected} onSelect={setTab} />
        </>
      )}
    </div>
  );
}
