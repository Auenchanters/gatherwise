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
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addDays } from '../../src/domain/dates.js';
import { formatMoney } from '../../src/domain/money.js';
import type { ReadyState } from '../../src/domain/reducer.js';
import { sampleBrief } from '../../src/features/brief/samples.js';
import type { PlannerStore } from '../../src/features/plan/planner-store.js';
import { err, ok } from '../../src/shared/result.js';
import { descriptionOf, must } from '../support/ui.js';
import {
  deferred,
  fakeClient,
  freshAnswer,
  planned,
  savedStorage,
  type Answer,
} from '../support/fakes.js';
import { aiMeta, aiSuggestions, TODAY as today } from '../support/fixtures.js';
import { festival, settle, setup } from '../support/planner-ui.js';

/** The blob-URL statics jsdom lacks, as they were before a test stubbed them. */
const urlStatics = new Map<'createObjectURL' | 'revokeObjectURL', PropertyDescriptor | undefined>();

function stubUrl(name: 'createObjectURL' | 'revokeObjectURL', value: unknown): void {
  if (!urlStatics.has(name)) urlStatics.set(name, Object.getOwnPropertyDescriptor(URL, name));
  Object.defineProperty(URL, name, { configurable: true, writable: true, value });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const [name, original] of urlStatics) {
    if (original) Object.defineProperty(URL, name, original);
    else Reflect.deleteProperty(URL, name);
  }
  urlStatics.clear();
});

/** Queries inside one tab's panel (every panel is in the DOM; CSS is not loaded in jsdom). */
const panel = (name: string) => within(screen.getByRole('tabpanel', { name }));

/** The store's plan, which these tests always have. */
function ready(store: PlannerStore): ReadyState {
  const state = store.getState().plan;
  if (state.phase !== 'ready') throw new Error('expected a plan');
  return state;
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

/** A vendor's card, by the vendor's label. */
const card = (label: string): HTMLElement =>
  itemOf(panel('Vendors').getByRole('heading', { level: 3, name: label }));

/** Heading levels in a panel, in document order. */
const levels = (tab: string): number[] =>
  panel(tab)
    .getAllByRole('heading')
    .map((h) => Number(h.tagName.slice(1)));

/**
 * Stands in for the browser's blob URLs (jsdom has none; the originals come back after the test)
 * and records what is downloaded: each link's address, file name and whether it was in the page.
 */
function captureDownloads() {
  const blobs: Blob[] = [];
  const clicks: { href: string; download: string; inPage: boolean }[] = [];
  stubUrl(
    'createObjectURL',
    vi.fn((blob: Blob) => {
      blobs.push(blob);
      return `blob:calendar-${blobs.length}`;
    }),
  );
  const revoke = vi.fn();
  stubUrl('revokeObjectURL', revoke);
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicks.push({ href: this.href, download: this.download, inPage: this.isConnected });
  });
  return { blobs, clicks, revoke };
}

const DOWNLOAD = { name: 'Download calendar (.ics)' };
const REFRESH = { name: 'Refresh ideas (1 AI call)' };

describe('every new tab', () => {
  it('has one named landmark, its own section, and the vendor questions add none', async () => {
    await setup();
    for (const tab of ['Timeline', 'Vendors', 'Ideas', 'Volunteers']) {
      const regions = panel(tab).getAllByRole('region');
      expect(regions, tab).toHaveLength(1);
      expect(regions[0]?.getAttribute('aria-labelledby'), tab).toBeTruthy();
      expect(within(must(regions[0])).getByRole('heading', { level: 2 }).textContent).toBe(tab);
    }
  });

  it('each starts at h2 and never skips a heading level', async () => {
    await setup();
    for (const tab of ['Timeline', 'Vendors', 'Ideas', 'Volunteers']) {
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

  it('never calls the AI for ticks, vendor edits, the download or printing', async () => {
    const { user, client, store } = await setup();
    captureDownloads();
    vi.spyOn(window, 'print').mockImplementation(() => undefined);
    await user.click(box('Timeline', 'Book the venue'));
    await user.click(panel('Timeline').getByRole('checkbox', { name: 'Hide done tasks' }));
    await user.click(panel('Timeline').getByRole('button', DOWNLOAD));
    await user.click(panel('Timeline').getByRole('button', { name: 'Print plan' }));
    await user.selectOptions(
      panel('Vendors').getByRole('combobox', { name: 'Status for Tent / shamiana' }),
      'Booked',
    );
    const first = must(ready(store).plan.vendors[0]?.checklist[0]).text;
    await user.click(within(card('Tent / shamiana')).getByRole('checkbox', { name: first }));
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
    const note = within(row).getByText(
      'Check with your local authority — processing times vary by city',
    );
    expect(note.getAttribute('dir')).toBe('auto');
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
      t.getByText(
        /Lead times are typical planning estimates; confirm them with your vendors, and with your local authority for any permit\./u,
      ),
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
      {
        href: 'blob:calendar-1',
        download: 'gatherwise-green-park-diwali-mela-2027-01-04.ics',
        inPage: true,
      },
    ]);
    // The link was in the page only for the click.
    expect(document.querySelector('a[download]')).toBeNull();
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

  it('releases the file URL a little after the click, once', async () => {
    const { revoke } = captureDownloads();
    await setup();
    vi.useFakeTimers();
    fireEvent.click(panel('Timeline').getByRole('button', DOWNLOAD));
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(revoke.mock.calls).toEqual([['blob:calendar-1']]);
  });

  it('a second download releases the first file at once, and no timer is left over', async () => {
    const { revoke } = captureDownloads();
    await setup();
    vi.useFakeTimers();
    const button = panel('Timeline').getByRole('button', DOWNLOAD);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(revoke.mock.calls).toEqual([['blob:calendar-1']]);
    vi.advanceTimersByTime(60_000);
    expect(revoke.mock.calls).toEqual([['blob:calendar-1'], ['blob:calendar-2']]);
  });

  it('releases the file when the timeline goes away, and does nothing more later', async () => {
    const { revoke } = captureDownloads();
    await setup();
    vi.useFakeTimers();
    fireEvent.click(panel('Timeline').getByRole('button', DOWNLOAD));
    cleanup();
    expect(revoke.mock.calls).toEqual([['blob:calendar-1']]);
    vi.advanceTimersByTime(60_000);
    expect(revoke).toHaveBeenCalledTimes(1);
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

describe('vendors', () => {
  it('shows a card per vendor with its reason, booking chip, status select and checklist', async () => {
    const { store } = await setup();
    const vendors = ready(store).plan.vendors;
    const v = panel('Vendors');
    expect(v.getAllByRole('heading', { level: 3 })).toHaveLength(vendors.length);
    const tent = itemOf(v.getByRole('heading', { level: 3, name: 'Tent / shamiana' }));
    const reason = within(tent).getByText(/^Recommended: /u);
    expect(reason.getAttribute('dir')).toBe('auto');
    expect(within(tent).getByText('Book by 14 Dec 2026')).toBeTruthy();
    const select = within(tent).getByRole('combobox', { name: 'Status for Tent / shamiana' });
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['To contact', 'Quoted', 'Booked']);
    expect(select).toHaveProperty('value', 'to_contact');
    expect(within(tent).getAllByRole('checkbox')).toHaveLength(must(vendors[0]).checklist.length);
  });

  it('changing the status updates the chip, though the plan object stays the same', async () => {
    const { user, store } = await setup();
    const before = ready(store).plan;
    const tent = itemOf(panel('Vendors').getByRole('heading', { name: 'Tent / shamiana' }));
    const select = within(tent).getByRole('combobox', { name: 'Status for Tent / shamiana' });
    await user.selectOptions(select, 'Booked');
    expect(select).toHaveProperty('value', 'booked');
    expect(within(tent).getByText('Booked', { selector: '.status' })).toBeTruthy();
    expect(within(tent).queryByText('Book by 14 Dec 2026')).toBeNull();
    expect(ready(store).progress.vendorStatus).toEqual({ tent_shamiana: 'booked' });
    expect(ready(store).plan).toBe(before);
    expect(panel('Vendors').getByRole('status').textContent).toBe(
      "Marked 'Tent / shamiana' as booked",
    );
    // "Quoted" is a status the chip does not show, so the select is what says it.
    await user.selectOptions(select, 'Quoted');
    expect(select).toHaveProperty('value', 'quoted');
    expect(within(tent).getByText('Book by 14 Dec 2026')).toBeTruthy();
  });

  it('ignores a status the select does not offer', async () => {
    const { store } = await setup();
    const tent = itemOf(panel('Vendors').getByRole('heading', { name: 'Tent / shamiana' }));
    const select = within(tent).getByRole('combobox', { name: 'Status for Tent / shamiana' });
    fireEvent.change(select, { target: { value: 'haggling' } });
    expect(ready(store).progress.vendorStatus).toEqual({});
    expect(select).toHaveProperty('value', 'to_contact');
    expect(panel('Vendors').getByRole('status').textContent).toBe('');
  });

  it('ticks stay put across tab switches and are announced', async () => {
    const { user, store } = await setup();
    const item = must(ready(store).plan.vendors[0]?.checklist[1]);
    const tick = () => within(card('Tent / shamiana')).getByRole('checkbox', { name: item.text });
    const input = tick();
    if (!(input instanceof HTMLInputElement)) throw new Error('not an input');
    expect(within(card('Tent / shamiana')).getByText(item.text).getAttribute('dir')).toBe('auto');
    await user.click(input);
    expect(input.checked).toBe(true);
    expect(panel('Vendors').getByRole('status').textContent).toBe(`Marked '${item.text}' done`);
    await user.click(screen.getByRole('tab', { name: 'Budget' }));
    await user.click(screen.getByRole('tab', { name: 'Vendors' }));
    expect(tick()).toHaveProperty('checked', true);
    expect(ready(store).progress.checklistDone).toEqual([item.id]);
    await user.click(tick());
    expect(tick()).toHaveProperty('checked', false);
    expect(panel('Vendors').getByRole('status').textContent).toBe(`Marked '${item.text}' not done`);
  });

  it('shows the booking urgency from the dates: overdue, then booked', async () => {
    const { user } = await setup({ start: { ...festival, date: addDays(today, 10) } });
    const tent = itemOf(panel('Vendors').getByRole('heading', { name: 'Tent / shamiana' }));
    expect(within(tent).getByText('Booking overdue')).toBeTruthy();
    expect(within(tent).getByText('Book by 10 Oct 2026')).toBeTruthy();
    await user.selectOptions(
      within(tent).getByRole('combobox', { name: 'Status for Tent / shamiana' }),
      'Booked',
    );
    expect(within(tent).getByText('Booked', { selector: '.status' })).toBeTruthy();
  });

  it('shows "Book soon" with the date when the booking deadline is close', async () => {
    await setup({ start: { ...festival, date: addDays(today, 25) } });
    const tent = itemOf(panel('Vendors').getByRole('heading', { name: 'Tent / shamiana' }));
    expect(within(tent).getByText('Book soon')).toBeTruthy();
    expect(within(tent).getByText('Book by 25 Oct 2026')).toBeTruthy();
  });

  it('follows the plan when guests change: reasons quote the new count', async () => {
    const { store } = await setup();
    const toilets = () =>
      itemOf(panel('Vendors').getByRole('heading', { name: 'Portable toilets' })).textContent;
    expect(toilets()).toContain('250 guests');
    act(() => {
      store.changeGuests(400);
    });
    expect(toilets()).toContain('400 guests');
    expect(toilets()).not.toContain('250 guests');
  });

  it('lists AI questions under the vendor they are for, labelled as AI text', async () => {
    await setup();
    const v = panel('Vendors');
    const tent = itemOf(v.getByRole('heading', { level: 3, name: 'Tent / shamiana' }));
    // Named by its words alone: the decoration beside it is hidden from assistive technology.
    const heading = within(tent).getByRole('heading', {
      level: 4,
      name: 'Questions to ask (AI · personalized)',
    });
    expect(heading.querySelector('[aria-hidden="true"]')?.textContent).toBe('✦');
    const question = within(tent).getByText('Is the tent rain-proof?');
    expect(question.getAttribute('dir')).toBe('auto');
    expect(question.closest('ul')).toBeTruthy();
    expect(v.getAllByRole('heading', { level: 4 })).toHaveLength(1);
  });

  it('has no questions section without an AI answer', async () => {
    const client = fakeClient(() => new Promise<Answer>(() => undefined));
    await setup({ client });
    expect(panel('Vendors').queryByRole('heading', { level: 4 })).toBeNull();
  });
});

describe('ideas', () => {
  it('shows each AI idea with category, cost, fit, source and why', async () => {
    const { store } = await setup();
    const { ideas } = ready(store).plan;
    expect(ideas.every((idea) => idea.source === 'ai')).toBe(true);
    const card = itemOf(
      panel('Ideas').getByRole('heading', { level: 3, name: 'Diya-lined walkways' }),
    );
    const description = within(card).getByText(
      'Line the step-free paths with clay diyas from local potters.',
    );
    expect(description.getAttribute('dir')).toBe('auto');
    expect(card.textContent).toContain('Décor');
    const cost = formatMoney(must(ideas[0]).estimatedCost, 'INR');
    expect(card.textContent).toContain(cost);
    expect(within(card).getByText('Fits Décor budget')).toBeTruthy();
    expect(within(card).getByText('AI · personalized')).toBeTruthy();
    const why = within(card).getByText('vibe: lantern-lit; accessibility: wheelchair');
    expect(why.getAttribute('dir')).toBe('auto');
    expect(card.textContent).toContain('Why: vibe: lantern-lit');
  });

  it('says by how much an over-budget idea goes over its category', async () => {
    const { store } = await setup();
    const fireworks = must(
      ready(store).plan.ideas.find((idea) => idea.title === 'Fireworks finale'),
    );
    expect(fireworks.fit.fits).toBe(false);
    const card = itemOf(panel('Ideas').getByRole('heading', { name: 'Fireworks finale' }));
    const over = formatMoney(fireworks.fit.overBy, 'INR');
    expect(over).toMatch(/^₹[\d,]+\.\d\d$/u);
    expect(
      within(card).getByText(`Over Activities & entertainment budget by ${over}`),
    ).toBeTruthy();
  });

  it('has a Refresh button that says it costs one call, and the zero-call note', async () => {
    await setup();
    const i = panel('Ideas');
    expect(i.getByRole('button', REFRESH).getAttribute('aria-disabled')).toBe('false');
    expect(i.getByText('Edits never call the AI; only this button does.')).toBeTruthy();
  });

  it('refresh is one call, aria-disabled and announced while pending, and enabled again after', async () => {
    const second = deferred<Answer>();
    let asked = 0;
    const client = fakeClient(() => {
      asked += 1;
      return asked === 1 ? Promise.resolve(freshAnswer) : second.promise;
    });
    const { user, store } = await setup({ client });
    const i = panel('Ideas');
    const button = i.getByRole('button', REFRESH);
    expect(store.getState().calls).toBe(1);

    await user.click(button);
    expect(client.suggest).toHaveBeenCalledTimes(2);
    expect(client.suggest.mock.calls[1]?.[2]).toEqual({ refresh: true });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    // The wait is announced once, by the Notices region; the Ideas region stays quiet until it ends.
    expect(i.getByRole('status').textContent).toBe('');
    expect(screen.getByRole('status', { name: 'Notices' }).textContent).toContain(
      'Gemini is personalizing your plan…',
    );
    // A second click while pending does nothing, and the button keeps keyboard focus.
    button.focus();
    await user.keyboard('{Enter}');
    await user.click(button);
    expect(client.suggest).toHaveBeenCalledTimes(2);
    expect(document.activeElement).toBe(button);

    await act(async () => {
      second.resolve(freshAnswer);
      await second.promise;
    });
    await settle();
    expect(button.getAttribute('aria-disabled')).toBe('false');
    expect(store.getState().calls).toBe(2);
    expect(i.getByRole('status').textContent).toBe('Fresh ideas are in. AI calls this session: 2.');
  });

  it('says the ideas are the same when the answer was reused, not that they are fresh', async () => {
    let asked = 0;
    const client = fakeClient(() => {
      asked += 1;
      return Promise.resolve(ok({ suggestions: aiSuggestions, meta: aiMeta, cached: asked > 1 }));
    });
    const { user } = await setup({ client });
    await user.click(panel('Ideas').getByRole('button', REFRESH));
    expect(panel('Ideas').getByRole('status').textContent).toBe(
      'Same ideas as before — reused from this session, no new AI call.',
    );
  });

  it("says there was nothing usable, in the callout's words, when a refresh brings no ideas", async () => {
    let asked = 0;
    const client = fakeClient(() => {
      asked += 1;
      const suggestions = asked > 1 ? { ...aiSuggestions, ideas: [] } : aiSuggestions;
      return Promise.resolve(ok({ suggestions, meta: aiMeta, cached: false }));
    });
    const { user } = await setup({ client });
    await user.click(panel('Ideas').getByRole('button', REFRESH));
    const notice = "Gemini's answer had no usable ideas, so you're seeing standard suggestions.";
    expect(panel('Ideas').getByRole('status').textContent).toBe(notice);
    expect(panel('Ideas').getByText(notice, { selector: 'p.callout' })).toBeTruthy();
  });

  it('forgets a refresh when a new plan starts', async () => {
    const { user, store } = await setup();
    await user.click(panel('Ideas').getByRole('button', REFRESH));
    expect(panel('Ideas').getByRole('status').textContent).toContain('Fresh ideas are in');
    await act(() => store.submit({ ...festival, name: 'Green Park Mela 2' }).settled);
    expect(ready(store).generation).toBe(2);
    expect(panel('Ideas').getByRole('status').textContent).toBe('');
  });

  it('shows the standard ideas with an honest notice when the AI failed', async () => {
    const client = fakeClient(() => Promise.resolve(err({ code: 'unavailable' })));
    await setup({ client });
    const i = panel('Ideas');
    const card = itemOf(i.getByRole('heading', { name: 'Zero-waste food stalls' }));
    expect(within(card).getByText('Standard suggestion')).toBeTruthy();
    expect(within(card).queryByText('AI · personalized')).toBeNull();
    expect(card.textContent).not.toContain('Why:');
    expect(within(card).getByText('Fits Sanitation & waste budget')).toBeTruthy();
    expect(i.getByText(/couldn't personalize these ideas/u)).toBeTruthy();
    expect(i.getByRole('button', REFRESH).getAttribute('aria-disabled')).toBe('false');
  });

  it('says the ideas are standard while the first answer is pending', async () => {
    const client = fakeClient(() => new Promise<Answer>(() => undefined));
    await setup({ client });
    const i = panel('Ideas');
    expect(i.getByText(/standard suggestions for now/u)).toBeTruthy();
    expect(i.getByRole('button', REFRESH).getAttribute('aria-disabled')).toBe('true');
  });

  it('says so when a restored plan was never personalized, and asks only on a click', async () => {
    const client = fakeClient();
    const { user, store } = await setup({
      client,
      storage: savedStorage(planned(festival)),
      start: null,
    });
    act(() => {
      store.hydrate();
    });
    const i = panel('Ideas');
    expect(i.getByText(/haven't been personalized yet/u)).toBeTruthy();
    expect(client.suggest).not.toHaveBeenCalled();
    await user.click(i.getByRole('button', REFRESH));
    expect(client.suggest).toHaveBeenCalledTimes(1);
  });

  it('says so when the AI answered with no usable ideas', async () => {
    const suggestions = { ...aiSuggestions, ideas: [] };
    const client = fakeClient(() =>
      Promise.resolve(ok({ suggestions, meta: aiMeta, cached: false })),
    );
    await setup({ client });
    expect(panel('Ideas').getByText(/had no usable ideas/u)).toBeTruthy();
    expect(panel('Ideas').getAllByText('Standard suggestion').length).toBeGreaterThan(0);
  });

  it('keeps the AI ideas when a later refresh fails', async () => {
    let asked = 0;
    const client = fakeClient(() => {
      asked += 1;
      return Promise.resolve(asked === 1 ? freshAnswer : err({ code: 'timeout' }));
    });
    const { user } = await setup({ client });
    await user.click(panel('Ideas').getByRole('button', REFRESH));
    expect(panel('Ideas').getByRole('heading', { name: 'Diya-lined walkways' })).toBeTruthy();
    expect(panel('Ideas').queryByText(/couldn't personalize these ideas/u)).toBeNull();
    expect(panel('Ideas').getByRole('status').textContent).toContain("didn't go through");
  });
});

describe('volunteers', () => {
  it('shows who each shift needs, with a table, and the roles', async () => {
    await setup();
    const v = panel('Volunteers');
    expect(v.getByText('10 volunteers per shift')).toBeTruthy();
    const table = v.getByRole('table');
    expect(within(table).getByText(/^Volunteer shifts for 4 Jan 2027/u).tagName).toBe('CAPTION');
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Shift', 'Needed', 'Assigned', 'Gap']);
    const [first, second] = within(table).getAllByRole('row').slice(1);
    expect(within(must(first)).getByRole('rowheader').textContent).toBe('18:00–21:00');
    expect(within(must(second)).getByRole('rowheader').textContent).toBe('21:00–23:00');
    expect(
      within(must(first))
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['10', '9', '▲ 1 short']);
    expect(v.getByRole('heading', { level: 3, name: 'Volunteer roles' })).toBeTruthy();
    const term = v.getByText('Registration desk');
    expect(term.tagName).toBe('DT');
    expect(term.nextElementSibling?.textContent).toContain('Greets guests');
  });

  it('calls out the shortfall when only 5 volunteers are available', async () => {
    const { store } = await setup({ start: { ...festival, volunteersAvailable: 5 } });
    expect(ready(store).plan.shifts.shortfall).toBe(15);
    const v = panel('Volunteers');
    expect(v.getByText("You're short by 15 volunteer slots")).toBeTruthy();
    expect(v.queryByText(/Fully staffed/u)).toBeNull();
    expect(v.getByText(/You have 5 volunteers for 2 shifts/u)).toBeTruthy();
  });

  it('says "Fully staffed" with the spare count when there are enough', async () => {
    await setup({ start: { ...festival, volunteersAvailable: 60 } });
    const v = panel('Volunteers');
    expect(v.getByText('Fully staffed (40 spare)')).toBeTruthy();
    expect(v.queryByText(/You're short by/u)).toBeNull();
    expect(within(v.getByRole('table')).getAllByText('None')).toHaveLength(2);
  });

  it('uses the singular for one missing slot', async () => {
    const { store } = await setup({ start: { ...festival, volunteersAvailable: 19 } });
    expect(ready(store).plan.shifts.shortfall).toBe(1);
    expect(panel('Volunteers').getByText("You're short by 1 volunteer slot")).toBeTruthy();
  });

  it('follows the plan when the guest count changes', async () => {
    const { store } = await setup();
    act(() => {
      store.changeGuests(50);
    });
    expect(panel('Volunteers').getByText('2 volunteers per shift')).toBeTruthy();
  });
});
