/**
 * WAI-ARIA tabs with automatic activation: arrow keys move between tabs and select as they go,
 * Home and End jump to the ends, and only the selected tab is in the tab order.
 * Does: render every panel, hiding the inactive ones with `is-inactive` (hidden on screen, shown
 * in print), so printing shows the whole plan.
 * Never does: hold the selection itself (the workspace does, so other parts can switch tabs).
 */
import type { KeyboardEvent, ReactElement, ReactNode } from 'react';

/** One tab and its panel. */
export interface TabSpec<Id extends string> {
  readonly id: Id;
  readonly label: string;
  readonly panel: ReactNode;
}

/** The DOM ids of a tab and its panel; other parts may link to them. */
export const tabId = (id: string): string => `tab-${id}`;
export const panelId = (id: string): string => `panel-${id}`;

/** Where each navigation key moves from tab `i` of `n`. */
const MOVES: Readonly<Record<string, (i: number, n: number) => number>> = {
  ArrowRight: (i, n) => (i + 1) % n,
  ArrowLeft: (i, n) => (i - 1 + n) % n,
  Home: () => 0,
  End: (_i, n) => n - 1,
};

/** Props for {@link Tabs}. */
export interface TabsProps<Id extends string> {
  /** Names the tab list for assistive technology. */
  readonly label: string;
  readonly tabs: readonly TabSpec<Id>[];
  readonly selected: Id;
  readonly onSelect: (id: Id) => void;
}

/** A tab list and its panels. */
export function Tabs<Id extends string>({
  label,
  tabs,
  selected,
  onSelect,
}: TabsProps<Id>): ReactElement {
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const move = MOVES[event.key];
    const next = move && tabs[move(index, tabs.length)];
    if (!next) return;
    event.preventDefault();
    onSelect(next.id);
    document.getElementById(tabId(next.id))?.focus();
  };

  return (
    <div className="tabs">
      <div className="tabs__list" role="tablist" aria-label={label}>
        {tabs.map((tab, index) => {
          const isSelected = tab.id === selected;
          return (
            <button
              className="tabs__tab"
              id={tabId(tab.id)}
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isSelected}
              aria-controls={panelId(tab.id)}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => {
                onSelect(tab.id);
              }}
              onKeyDown={(event) => {
                onKeyDown(event, index);
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => (
        <div
          className={tab.id === selected ? 'tabs__panel' : 'tabs__panel is-inactive'}
          id={panelId(tab.id)}
          key={tab.id}
          role="tabpanel"
          aria-labelledby={tabId(tab.id)}
          tabIndex={0}
        >
          {tab.panel}
        </div>
      ))}
    </div>
  );
}
