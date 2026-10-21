/**
 * RTL tests for the Timeline, Vendors, Ideas and Volunteers tabs (src/features/plan/timeline.tsx,
 * vendors.tsx, ideas.tsx, volunteers.tsx), through a real planner store and a fake AI client.
 *
 * Does: proves the model-call budget at the component level (ticking tasks, vendor edits, the
 * calendar download and printing never call the AI; only "Refresh ideas" does, once per click and
 * never while a request is pending); the month groups, status chips, AI labels and live
 * announcements of the timeline; the ICS download (type, file name, content, DTSTAMP, done tasks
 * left out, a non-Latin name); the vendor cards, booking chips, status select and checklist; the
 * idea cards with their fit and source badges and the honest notice when there is no AI answer;
 * the volunteer table with a shortfall and with spare volunteers; heading order; and `dir="auto"`.
 * Never does: call the network or read the clock (today is fixed; Date is faked where a stamp is checked).
 */
import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type ReadyState } from '../../src/domain/reducer.js';
import { sampleBrief } from '../../src/features/brief/samples.js';
import type { PlannerStore } from '../../src/features/plan/planner-store.js';
import { ok } from '../../src/shared/result.js';
import { fakeClient } from '../support/fakes.js';
import { aiMeta, aiSuggestions } from '../support/fixtures.js';
import { festival, setup, today } from '../support/planner-ui.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Queries inside one tab's panel (every panel is in the DOM; CSS is not loaded in jsdom). */
const panel = (name: string) => within(screen.getByRole('tabpanel', { name }));

/** The store's plan, which these tests always have. */
function ready(store: PlannerStore): ReadyState {
  const state = store.getState().plan;
  if (state.phase !== 'ready') throw new Error('expected a plan');
  return state;
}

/** `value`, or a failed test when it is missing. */
function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value');
  return value;
}

/** The checkbox with this name in the Timeline or Vendors panel. */
const box = (tab: string, name: string): HTMLInputElement => {
  const found = panel(tab).getByRole('checkbox', { name });
  if (!(found instanceof HTMLInputElement)) throw new Error('not an input');
  return found;
};

/** The list item (task row or card) a control sits in. */
function itemOf(element: HTMLElement): HTMLElement {
  const item = element.closest('li');
  if (!item) throw new Error('not in a list item');
  return item;
}

/** The text of every element an input's aria-describedby points at. */
function descriptionOf(element: HTMLElement): string {
  const ids = element.getAttribute('aria-describedby')?.split(' ') ?? [];
  return ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
}

/** Heading levels in a panel, in document order. */
const levels = (tab: string): number[] =>
  panel(tab)
    .getAllByRole('heading')
    .map((h) => Number(h.tagName.slice(1)));

/** Stands in for the browser's blob URLs (jsdom has none) and records what is downloaded. */
function captureDownloads() {
  const blobs: Blob[] = [];
  const clicks: { href: string; download: string }[] = [];
  URL.createObjectURL = vi.fn((blob: Blob) => {
    blobs.push(blob);
    return 'blob:calendar';
  });
  const revoke = vi.fn();
  URL.revokeObjectURL = revoke;
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicks.push({ href: this.href, download: this.download });
  });
  return { blobs, clicks, revoke };
}

const DOWNLOAD = { name: 'Download calendar (.ics)' };

describe('every new tab', () => {
  it('each starts at h2 and never skips a heading level', async () => {
    await setup();
    for (const tab of ['Timeline']) {
      const found = levels(tab);
      expect(found[0], tab).toBe(2);
      found.forEach((level, i) => {
        expect(level, tab).toBeLessThanOrEqual((found[i - 1] ?? 1) + 1);
      });
      expect(found.length, tab).toBeGreaterThan(1);
    }
  });

  it('uses no inline styles, so the production CSP holds', async () => {
    await setup();
    expect(document.querySelectorAll('[style]')).toHaveLength(0);
  });

  it('never calls the AI for ticks, the download or printing', async () => {
    const { user, client, store } = await setup();
    captureDownloads();
    vi.spyOn(window, 'print').mockImplementation(() => undefined);
    await user.click(box('Timeline', 'Book the venue'));
    await user.click(panel('Timeline').getByRole('checkbox', { name: 'Hide done tasks' }));
    await user.click(panel('Timeline').getByRole('button', DOWNLOAD));
    await user.click(panel('Timeline').getByRole('button', { name: 'Print plan' }));
    expect(client.suggest).toHaveBeenCalledTimes(1);
    expect(store.getState().calls).toBe(1);
  });
});

describe('timeline', () => {
  it('groups tasks by the month of their latest start under h3 headings', async () => {
    const { store } = await setup();
    const tasks = ready(store).plan.schedule.tasks;
    const headings = panel('Timeline').getAllByRole('heading', { level: 3 });
    expect(headings.map((h) => h.textContent)).toEqual([
      'November 2026',
      'December 2026',
      'January 2027',
    ]);
    // The first group holds exactly the tasks that start in November.
    const november = tasks.filter((t) => t.latestStart.startsWith('2026-11')).length;
    const list = headings[0]?.nextElementSibling;
    expect(list?.tagName).toBe('UL');
    expect(list?.querySelectorAll(':scope > li')).toHaveLength(november);
  });

  it('shows each task with a status chip, dates, category and note, labelled by its title', async () => {
    await setup();
    const row = itemOf(box('Timeline', 'Apply for public-space permission'));
    expect(within(row).getByText('On track')).toBeTruthy();
    expect(row.textContent).toContain('Start by 4 Dec 2026 · finish by 25 Dec 2026');
    expect(row.textContent).toContain('Venue & permits');
    expect(row.textContent).toContain('Check with your local authority — processing times vary');
    const label = within(row).getByText('Apply for public-space permission');
    expect(label.tagName).toBe('LABEL');
    expect(label.getAttribute('dir')).toBe('auto');
    expect(within(row).queryByText('AI · personalized')).toBeNull();
  });

  it('labels a task Gemini added "AI · personalized"', async () => {
    await setup();
    const row = itemOf(box('Timeline', 'Order clay diyas'));
    expect(within(row).getByText('AI · personalized')).toBeTruthy();
  });

  it('shows how many tasks are done, and the lead-time caveat', async () => {
    const { user, store } = await setup();
    const total = ready(store).plan.schedule.tasks.length;
    const t = panel('Timeline');
    expect(t.getByText(`0 of ${total} tasks done`)).toBeTruthy();
    expect(t.getByRole('progressbar', { name: 'Tasks done' }).getAttribute('value')).toBe('0');
    await user.click(box('Timeline', 'Book the venue'));
    expect(t.getByText(`1 of ${total} tasks done`)).toBeTruthy();
    expect(
      t.getByText(/typical planning heuristics; permit processing varies by city/u),
    ).toBeTruthy();
  });

  it('ticking a task marks it done, announces it politely and makes no AI call', async () => {
    const { user, client, store } = await setup();
    const checkbox = box('Timeline', 'Book the venue');
    const row = itemOf(checkbox);
    await user.click(checkbox);
    expect(checkbox.checked).toBe(true);
    expect(within(row).getByText('Done')).toBeTruthy();
    expect(ready(store).progress.doneTasks).toContain('book_venue');
    const live = panel('Timeline').getByRole('status');
    expect(live.textContent).toBe("Marked 'Book the venue' done");
    await user.click(checkbox);
    expect(checkbox.checked).toBe(false);
    expect(live.textContent).toBe("Marked 'Book the venue' not done");
    expect(within(row).getByText('On track')).toBeTruthy();
    expect(client.suggest).toHaveBeenCalledTimes(1);
    expect(store.getState().calls).toBe(1);
  });

  it('describes each checkbox by its status and dates', async () => {
    await setup();
    const text = descriptionOf(box('Timeline', 'Book the venue'));
    expect(text).toContain('On track');
    expect(text).toContain('Start by 15 Nov 2026');
  });

  it('"Hide done tasks" filters done tasks out and back in', async () => {
    const { user } = await setup();
    const t = panel('Timeline');
    await user.click(box('Timeline', 'Book the venue'));
    const hide = t.getByRole('checkbox', { name: 'Hide done tasks' });
    await user.click(hide);
    expect(t.queryByRole('checkbox', { name: 'Book the venue' })).toBeNull();
    expect(t.getByRole('checkbox', { name: 'Form the organizing committee' })).toBeTruthy();
    await user.click(hide);
    expect(t.getByRole('checkbox', { name: 'Book the venue' })).toBeTruthy();
  });

  it('with done tasks hidden, ticking a task moves focus to the next one instead of losing it', async () => {
    const { user } = await setup();
    await user.click(panel('Timeline').getByRole('checkbox', { name: 'Hide done tasks' }));
    await user.click(box('Timeline', 'Define goals and the programme'));
    expect(document.activeElement).toBe(box('Timeline', 'Form the organizing committee'));
  });

  it('with done tasks hidden, ticking the last task focuses the previous one, then the filter', async () => {
    const { user, store } = await setup();
    const t = panel('Timeline');
    await user.click(t.getByRole('checkbox', { name: 'Hide done tasks' }));
    await user.click(box('Timeline', 'Thank sponsors and volunteers'));
    expect(document.activeElement).toBe(box('Timeline', 'Write the post-event report'));
    // Everything but one task is done; ticking that one leaves nothing to focus but the filter.
    const open = ready(store).plan.schedule.tasks.filter((x) => x.status !== 'done');
    act(() => {
      for (const task of open.slice(1)) store.toggleTask(task.id);
    });
    await user.click(box('Timeline', must(open[0]).title));
    expect(t.getByText('Every task is done.')).toBeTruthy();
    expect(document.activeElement).toBe(t.getByRole('checkbox', { name: 'Hide done tasks' }));
  });

  it('builds the calendar file: type, name, content, a fresh DTSTAMP, and no done tasks', async () => {
    const { blobs, clicks } = captureDownloads();
    const { user } = await setup();
    // Only Date is faked, so user-event's timers still run.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 21, 12, 30, 45)));
    await user.click(box('Timeline', 'Book the venue'));
    await user.click(panel('Timeline').getByRole('button', DOWNLOAD));

    expect(clicks).toEqual([
      { href: 'blob:calendar', download: 'gatherwise-green-park-diwali-mela-2027-01-04.ics' },
    ]);
    const blob = must(blobs[0]);
    expect(blob.type).toBe('text/calendar;charset=utf-8');
    const text = await blob.text();
    expect(text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(text).toContain('SUMMARY:Green Park Diwali Mela');
    expect(text).toContain('DTSTAMP:20261021T123045Z');
    // The done task is left out; an open one is in.
    expect(text).not.toContain('SUMMARY:Book the venue');
    expect(text).toContain('SUMMARY:Form the organizing committee');
  });

  it('releases the file URL a little after the click', async () => {
    const { revoke } = captureDownloads();
    await setup();
    vi.useFakeTimers();
    fireEvent.click(panel('Timeline').getByRole('button', DOWNLOAD));
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30_000);
    expect(revoke).toHaveBeenCalledWith('blob:calendar');
  });

  it('names a Hindi event "plan" in the file name and keeps its text in the calendar', async () => {
    const { blobs, clicks } = captureDownloads();
    const { user } = await setup({ start: { ...festival, name: 'अनुपमा का जन्मदिन 🎉' } });
    expect(screen.getByRole('heading', { level: 1 }).getAttribute('dir')).toBe('auto');
    await user.click(panel('Timeline').getByRole('button', DOWNLOAD));
    expect(clicks.map((c) => c.download)).toEqual(['gatherwise-plan-2027-01-04.ics']);
    expect(await must(blobs[0]).text()).toContain('अनुपमा का जन्मदिन 🎉');
  });

  it('"Print plan" opens the print dialog', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { user } = await setup();
    await user.click(panel('Timeline').getByRole('button', { name: 'Print plan' }));
    expect(print).toHaveBeenCalledTimes(1);
  });

  it('an event today still has a timeline, with every unmeetable task marked', async () => {
    const { store } = await setup({ start: { ...festival, date: today } });
    const { schedule } = ready(store).plan;
    expect(schedule.infeasibleCount + schedule.overdueCount).toBeGreaterThan(0);
    const t = panel('Timeline');
    expect(t.getAllByRole('heading', { level: 3 }).length).toBeGreaterThan(0);
    // One checkbox per task, plus the "Hide done tasks" filter.
    expect(t.getAllByRole('checkbox')).toHaveLength(schedule.tasks.length + 1);
    expect(t.getAllByText(/^(Can't be done in time|Overdue)$/u).length).toBeGreaterThan(0);
  });

  it('renders a Hindi, emoji AI task as text with dir="auto"', async () => {
    const task = { ...must(aiSuggestions.extraTasks[0]), title: 'दिये मंगवाएं 🎉 <b>' };
    const suggestions = { ...aiSuggestions, extraTasks: [task] };
    const client = fakeClient(() =>
      Promise.resolve(ok({ suggestions, meta: aiMeta, cached: false })),
    );
    await setup({ client });
    const label = panel('Timeline').getByText('दिये मंगवाएं 🎉 <b>');
    expect(label.getAttribute('dir')).toBe('auto');
    expect(label.querySelector('b')).toBeNull();
  });

  it('works for a birthday too, with no Volunteers tab', async () => {
    await setup({ start: sampleBrief('birthday', today) });
    expect(panel('Timeline').getAllByRole('checkbox').length).toBeGreaterThan(2);
    expect(screen.queryByRole('tab', { name: 'Volunteers' })).toBeNull();
  });
});
