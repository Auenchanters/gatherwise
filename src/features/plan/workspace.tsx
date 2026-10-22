/**
 * The plan workspace: header, the infeasible-deadlines banner and the tabs (Overview, Budget,
 * Timeline, Vendors, Ideas and, for community events, Volunteers). "Edit details" swaps the tabs
 * for the brief form, filled with the current brief.
 * Does: move focus to the event name whenever a plan opens; send every user action to a store
 * command from its event handler.
 * Never does: call the AI from an effect, or keep plan state of its own (only which tab is open
 * and whether the form is showing).
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { vendorView, type ReadyState } from '../../domain/reducer.js';
import { BriefForm } from '../brief/brief-form.js';
import { Budget } from './budget.js';
import { Header } from './header.js';
import { Ideas } from './ideas.js';
import { InfeasibleBanner } from './infeasible-banner.js';
import { Overview } from './overview.js';
import type { PlannerSnapshot, PlannerStore } from './planner-store.js';
import { focusAfter } from '../../ui/focus.js';
import { refusalTarget } from './storage-key.js';
import { panelId, tabId, Tabs, type TabSpec } from './tabs.js';
import { Timeline } from './timeline.js';
import { Vendors } from './vendors.js';
import { Volunteers } from './volunteers.js';

type TabId = 'overview' | 'budget' | 'timeline' | 'vendors' | 'ideas' | 'volunteers';

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

  // The Overview tile and the Vendors tab both need the vendors with the organizer's progress laid
  // over them. Keyed on the state, not `state.plan`: a status or tick leaves the plan object as it
  // was. All tabs stay mounted for print, so this runs once per state, not once per tab per render.
  const vendors = useMemo(() => vendorView(state), [state]);

  // Each submitted brief is a new generation: a plan has opened, so the event name takes focus.
  useEffect(() => {
    headingRef.current?.focus();
  }, [state.generation]);

  /** Runs a command that closes the plan, then puts focus on `<main>`, since this view is gone. */
  const close = (command: () => void): void => {
    const main = rootRef.current?.closest('main');
    focusAfter(command, () => main);
  };

  const tabs: TabSpec<TabId>[] = [
    {
      id: 'overview',
      label: 'Overview',
      panel: (
        <Overview
          state={state}
          vendors={vendors}
          snapshot={snapshot}
          onPersonalize={() => void store.personalize()}
        />
      ),
    },
    { id: 'budget', label: 'Budget', panel: <Budget state={state} store={store} /> },
    { id: 'timeline', label: 'Timeline', panel: <Timeline state={state} store={store} /> },
    {
      id: 'vendors',
      label: 'Vendors',
      panel: <Vendors state={state} vendors={vendors} store={store} />,
    },
    {
      id: 'ideas',
      label: 'Ideas',
      panel: <Ideas state={state} calls={snapshot.calls} store={store} />,
    },
  ];
  if (state.brief.kind === 'community') {
    tabs.push({ id: 'volunteers', label: 'Volunteers', panel: <Volunteers state={state} /> });
  }
  // An edit can turn a community event into another kind, taking its Volunteers tab away.
  const selected = tabs.some((t) => t.id === tab) ? tab : 'overview';

  return (
    <div ref={rootRef}>
      <Header
        state={state}
        headingRef={headingRef}
        onEdit={() => {
          focusAfter(
            () => {
              setEditing(true);
            },
            () => formHeadingRef.current,
          );
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
              // Rendered at once, so a refusal's message exists to take focus. A refused brief
              // keeps the form, with everything typed, and says why.
              const { accepted } = focusAfter(() => store.submit(brief), refusalTarget);
              if (accepted) setEditing(false);
            }}
          />
          <button
            className="button button--secondary workspace__cancel"
            type="button"
            onClick={() => {
              focusAfter(
                () => {
                  setEditing(false);
                },
                () => headingRef.current,
              );
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
