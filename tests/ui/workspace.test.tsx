/**
 * RTL tests for the plan workspace (src/features/plan/planner.tsx and the views it renders) in
 * jsdom, driven through a real planner store with a fake AI client.
 *
 * Does: proves edits recompute with zero AI calls (guests 250 → 400 moves the per-guest lines and
 * the counter stays at 1); that an AI failure keeps the budget and says so; the infeasible banner;
 * the AI panel's prompt, answer, adjustments and cached and restored states; the restored plan's
 * "Personalize with AI (1 call)"; WAI-ARIA tab keys; refused edits; and the header actions.
 * Never does: call the network or read the clock (`today` is fixed for the store).
 */
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { describe, expect, it } from 'vitest';
import { addDays } from '../../src/domain/dates.js';
import { formatMoney } from '../../src/domain/money.js';
import type { ScheduledTask, Status } from '../../src/domain/schedule.js';
import { sampleBrief } from '../../src/features/brief/samples.js';
import { clientErrorMessage } from '../../src/features/client/messages.js';
import { InfeasibleBanner } from '../../src/features/plan/infeasible-banner.js';
import { Planner } from '../../src/features/plan/planner.js';
import { createPlannerStore } from '../../src/features/plan/planner-store.js';
import { PLAN_ERROR_ID, STORAGE_KEY } from '../../src/features/plan/storage-key.js';
import { SYSTEM_INSTRUCTION } from '../../src/shared/prompt.js';
import { err, ok } from '../../src/shared/result.js';
import { descriptionOf, must } from '../support/ui.js';
import {
  deferred,
  fakeClient,
  freshAnswer,
  memoryStorage,
  planned,
  savedStorage,
  type Answer,
} from '../support/fakes.js';
import { aiSuggestions, aiMeta, TODAY as today } from '../support/fixtures.js';
import { festival, settle, setup } from '../support/planner-ui.js';

/** The planner's polite region, by its name (the tabs have status regions of their own). */
const statusRegion = (): HTMLElement => screen.getByRole('status', { name: 'Notices' });

/** The Allocated cell of a budget row, by category label. */
const allocated = (label: string): string =>
  within(screen.getByRole('row', { name: new RegExp(`^${label}`, 'u') })).getAllByRole('cell')[0]
    ?.textContent ?? '';

describe('workspace: opening a plan', () => {
  it('puts the event name in the only h1, focuses it, and shows the facts', async () => {
    await setup();
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toBe('Green Park Diwali Mela');
    expect(heading.getAttribute('dir')).toBe('auto');
    expect(document.activeElement).toBe(heading);
    const facts = screen.getByRole('list', { name: 'Event facts' }).textContent;
    expect(facts).toContain('Community event · Festival or fair');
    expect(facts).toContain('75 days to go');
    expect(facts).toContain('250 guests');
    expect(facts).toContain('₹1,50,000.00 budget');
  });

  it('labels the AI summary, announces its arrival and counts one AI call', async () => {
    await setup();
    const summary = screen.getByText(aiSuggestions.summary);
    expect(summary.getAttribute('dir')).toBe('auto');
    expect(summary.parentElement?.textContent).toContain('AI · personalized');
    expect(statusRegion().textContent).toBe('Gemini has personalized your plan.');
    const tile = screen.getByText('AI calls this session', { selector: 'dt.tile__label' });
    expect(tile.nextElementSibling?.textContent).toBe('1');
  });

  it('shows the engine sentence while the AI is pending, and says it is working', async () => {
    const client = fakeClient(() => new Promise<Answer>(() => undefined));
    await setup({ client });
    expect(statusRegion().textContent).toContain('Gemini is personalizing your plan…');
    expect(
      screen.getByText(/^A community event \(festival or fair\) for 250 guests/u),
    ).toBeTruthy();
  });
});

describe('workspace: zero-call edits', () => {
  it('guests 250 → 400 rescales the per-guest lines and keeps AI calls at 1', async () => {
    const { user, client, store } = await setup();
    await user.click(screen.getByRole('tab', { name: 'Budget' }));
    const food = allocated('Food & beverage');
    const decor = allocated('Décor');
    const guests = screen.getByRole('spinbutton', { name: 'Guests attending' });
    await user.clear(guests);
    await user.type(guests, '400');

    const state = store.getState().plan;
    if (state.phase !== 'ready') throw new Error('expected a plan');
    const line = state.plan.budget.lines.find((l) => l.categoryId === 'food_beverage');
    if (!line) throw new Error('the community budget has a food line');
    expect(allocated('Food & beverage')).toBe(formatMoney(line.allocated, 'INR'));
    expect(allocated('Food & beverage')).not.toBe(food);
    expect(allocated('Décor')).toBe(decor);
    expect(state.brief.guests).toBe(400);
    expect(client.suggest).toHaveBeenCalledTimes(1);

    const live = screen.getByText(/^Budget updated for 400 guests/u);
    expect(live.getAttribute('role')).toBe('status');
    expect(live.textContent).toContain('over budget by');
    expect(live.textContent).toContain('No AI call used (AI calls this session: 1).');
    expect(screen.getByText(/^Over budget by ₹/u).textContent).toContain('contingency is used up');
  });

  it('a refused value stays in the field, raises the alert, and the plan keeps the last one', async () => {
    const { user, store } = await setup();
    await user.click(screen.getByRole('tab', { name: 'Budget' }));
    const guests = screen.getByRole('spinbutton', { name: 'Guests attending' });
    await user.clear(guests);
    await user.type(guests, '0');
    expect(guests).toHaveProperty('value', '0');
    const copy =
      'Guests must be a whole number from 1 to 5,000 — the plan still uses the last valid number.';
    expect(screen.getByRole('alert').textContent).toContain(copy);
    // WCAG 3.3.1: the refused field itself is marked and described.
    expect(guests.getAttribute('aria-invalid')).toBe('true');
    expect(descriptionOf(guests)).toBe(`Error: ${copy}`);
    expect(
      screen.getByRole('spinbutton', { name: 'Total budget' }).getAttribute('aria-invalid'),
    ).toBeNull();
    const state = store.getState().plan;
    expect(state.phase === 'ready' && state.brief.guests).toBe(250);
    await user.type(guests, '5');
    expect(guests.getAttribute('aria-invalid')).toBeNull();
    expect(screen.getByRole('alert').textContent).toBe('');
  });

  it('a blank field waits until the user leaves it before it is refused', async () => {
    const { user } = await setup();
    await user.click(screen.getByRole('tab', { name: 'Budget' }));
    const budget = screen.getByRole('spinbutton', { name: 'Total budget' });
    await user.clear(budget);
    expect(screen.getByRole('alert').textContent).toBe('');
    expect(budget.getAttribute('aria-invalid')).toBeNull();
    await user.keyboard('{Enter}');
    expect(budget.getAttribute('aria-invalid')).toBe('true');
    expect(descriptionOf(budget)).toContain('The budget must be a whole number from 1');

    const guests = screen.getByRole('spinbutton', { name: 'Guests attending' });
    await user.clear(guests);
    expect(guests.getAttribute('aria-invalid')).toBeNull();
    await user.tab();
    expect(guests.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').textContent).toContain('Guests must be a whole number');

    const date = screen.getByLabelText('Event date');
    await user.clear(date);
    await user.tab();
    expect(date.getAttribute('aria-invalid')).toBe('true');
    expect(descriptionOf(date)).toContain('Enter the event date as a real calendar date');
  });

  it('a new budget and date re-plan and are announced', async () => {
    const { user, client } = await setup();
    await user.click(screen.getByRole('tab', { name: 'Budget' }));
    const budget = screen.getByRole('spinbutton', { name: 'Total budget' });
    await user.clear(budget);
    await user.type(budget, '200000');
    expect(screen.getByText(/^Budget updated to ₹2,00,000\.00/u)).toBeTruthy();
    const date = screen.getByLabelText('Event date');
    await user.clear(date);
    await user.type(date, addDays(today, 60));
    expect(screen.getByText(/^Plan updated for 20 Dec 2026/u)).toBeTruthy();
    expect(client.suggest).toHaveBeenCalledTimes(1);
  });

  it('lays out the budget table with meters, contingency, total and break-even', async () => {
    const { user } = await setup();
    await user.click(screen.getByRole('tab', { name: 'Budget' }));
    const table = within(screen.getByRole('tabpanel', { name: 'Budget' })).getByRole('table');
    expect(within(table).getByText(/^How ₹1,50,000\.00 is split/u)).toBeTruthy();
    const meter = within(table).getByRole('meter', {
      name: /^Food & beverage: \d+% of the total$/u,
    });
    expect(meter.getAttribute('max')).toBe(String(150_000 * 100));
    expect(within(table).getByRole('rowheader', { name: 'Contingency' })).toBeTruthy();
    expect(within(table).getByRole('rowheader', { name: 'Total' })).toBeTruthy();
    expect(within(table).getByText('Adds up exactly to your budget.')).toBeTruthy();
    const ledger = screen.getByRole('region', { name: 'Break-even' });
    expect(ledger.textContent).toContain('20 stalls × ₹1,500.00');
    expect(ledger.textContent).toMatch(/Shortfall|Surplus/u);
  });
});

describe('workspace: a wedding', () => {
  it('shows the wedding template: its budget lines, its vendors and no Volunteers tab', async () => {
    const wedding = sampleBrief('wedding', today);
    // No answer yet, so everything on screen is the engine's own plan for the sample.
    const { store } = await setup({
      client: fakeClient(() => new Promise<Answer>(() => undefined)),
      start: wedding,
    });
    const state = store.getState().plan;
    if (state.phase !== 'ready') throw new Error('expected a plan');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe("Meera & Rohan's Wedding");
    const facts = screen.getByRole('list', { name: 'Event facts' }).textContent;
    expect(facts).toContain('Wedding · Ceremony & reception');
    expect(facts).toContain('240 days to go');
    expect(facts).toContain('150 guests');
    expect(facts).toContain('₹12,00,000.00 budget');
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Overview',
      'Budget',
      'Timeline',
      'Vendors',
      'Ideas',
    ]);
    expect(screen.queryByRole('region', { name: "Some deadlines can't be met" })).toBeNull();

    const budget = within(screen.getByRole('tabpanel', { name: 'Budget' }));
    expect(budget.getAllByRole('rowheader').map((h) => h.textContent)).toEqual([
      'Venue',
      'Catering',
      'Décor & flowers',
      'Photo & video',
      'Music & entertainment',
      'Attire & beauty',
      'Invitations & gifts',
      'Transport & stay',
      'Contingency',
      'Total',
    ]);
    for (const id of ['catering', 'photo_video']) {
      const line = state.plan.budget.lines.find((l) => l.categoryId === id);
      if (!line) throw new Error(`the wedding budget has a ${id} line`);
      expect(allocated(line.label)).toBe(formatMoney(line.allocated, 'INR'));
    }
    expect(screen.queryByRole('region', { name: 'Break-even' })).toBeNull();

    const vendors = within(screen.getByRole('tabpanel', { name: 'Vendors' }));
    expect(
      vendors.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent),
    ).toEqual([
      'Photographer & videographer',
      'Caterer',
      'Decorator & florist',
      'DJ or band',
      'Bar service',
    ]);
    expect(screen.queryByRole('heading', { name: 'Volunteers' })).toBeNull();
  });
});

describe('workspace: AI failure', () => {
  it('keeps the budget, shows the notice and offers to try again', async () => {
    const answers: Answer[] = [err({ code: 'unavailable' })];
    const client = fakeClient(() =>
      Promise.resolve(
        answers.shift() ?? ok({ suggestions: aiSuggestions, meta: aiMeta, cached: false }),
      ),
    );
    const { user } = await setup({ client });
    const message = clientErrorMessage({ code: 'unavailable' });
    expect(statusRegion().textContent).toContain(message);
    await user.click(screen.getByRole('tab', { name: 'Budget' }));
    expect(
      within(screen.getByRole('tabpanel', { name: 'Budget' })).getByRole('table'),
    ).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: 'Overview' }));
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => {
      expect(screen.getByText('Personalized by gemini-3.5-flash-lite in one call.')).toBeTruthy();
    });
    expect(statusRegion().textContent).not.toContain(message);
    expect(client.suggest).toHaveBeenCalledTimes(2);
  });

  it('a notice can be dismissed, and focus goes to the plan heading', async () => {
    const { user } = await setup({
      client: fakeClient(() => Promise.resolve(err({ code: 'network' }))),
    });
    await user.click(screen.getByRole('button', { name: /^Dismiss: Can't reach the AI service/u }));
    expect(statusRegion().textContent).toBe('');
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
  });
});

describe('workspace: focus after a notice is dismissed', () => {
  /** A plan with two notices: the browser refused to save, then the AI failed. */
  const twoNotices = () =>
    setup({
      client: fakeClient(() => Promise.resolve(err({ code: 'network' }))),
      storage: memoryStorage(undefined, { refuseWrites: true }),
    });
  const dismissButtons = () => screen.getAllByRole('button', { name: /^Dismiss: / });

  it('moves to the next notice, then to the plan heading when none is left', async () => {
    const { user } = await twoNotices();
    const [first, second] = dismissButtons();
    expect(first?.getAttribute('aria-label')).toContain("browser isn't letting us save");
    await user.click(must(first));
    expect(document.activeElement).toBe(second);
    await user.click(must(second));
    expect(statusRegion().textContent).toBe('');
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
  });

  it('moves to the one before when the last notice is dismissed', async () => {
    const { user } = await twoNotices();
    const [first, second] = dismissButtons();
    await user.click(must(second));
    expect(document.activeElement).toBe(first);
    expect(dismissButtons()).toHaveLength(1);
  });

  it('moves to main when no plan is open, since there is no plan heading', async () => {
    const { user } = await setup();
    await user.click(screen.getByRole('button', { name: 'Clear my data' }));
    await user.click(
      screen.getByRole('button', { name: /^Dismiss: Your saved plan was removed/u }),
    );
    expect(statusRegion().textContent).toBe('');
    expect(document.activeElement).toBe(screen.getByRole('main'));
  });
});

describe('workspace: focus and the AI panel button', () => {
  /** The restored plan without an answer, which offers "Personalize with AI (1 call)". */
  async function restored(client: ReturnType<typeof fakeClient>) {
    const rendered = await setup({ client, storage: savedStorage(planned(festival)), start: null });
    act(() => {
      rendered.store.hydrate();
    });
    return rendered;
  }
  const answerLine = () => screen.getByText('Personalized by gemini-3.5-flash-lite in one call.');

  it('Personalize stays mounted, focused and aria-disabled while it waits', async () => {
    const answer = deferred<Answer>();
    const client = fakeClient(() => answer.promise);
    const { user } = await restored(client);
    const button = screen.getByRole('button', { name: 'Personalize with AI (1 call)' });
    await user.click(button);
    expect(button.isConnected).toBe(true);
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.textContent).toBe('Personalizing…');
    await user.click(button);
    expect(client.suggest).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(button);
  });

  it('focus moves to the line that reports the answer once the button is gone', async () => {
    const answer = deferred<Answer>();
    const { user } = await restored(fakeClient(() => answer.promise));
    await user.click(screen.getByRole('button', { name: 'Personalize with AI (1 call)' }));
    answer.resolve(freshAnswer);
    await settle();
    expect(screen.queryByRole('button', { name: /^Personalize/u })).toBeNull();
    expect(document.activeElement).toBe(answerLine());
  });

  it('Try again keeps focus while it waits, then hands it to the answer line', async () => {
    const retry = deferred<Answer>();
    let asked = 0;
    const client = fakeClient(() => {
      asked += 1;
      return asked === 1 ? Promise.resolve(err({ code: 'unavailable' })) : retry.promise;
    });
    const { user } = await setup({ client });
    const button = screen.getByRole('button', { name: 'Try again' });
    await user.click(button);
    expect(button.isConnected).toBe(true);
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    retry.resolve(freshAnswer);
    await settle();
    expect(document.activeElement).toBe(answerLine());
  });

  it('does not take focus when the user has moved on before the answer lands', async () => {
    const answer = deferred<Answer>();
    const { user } = await restored(fakeClient(() => answer.promise));
    await user.click(screen.getByRole('button', { name: 'Personalize with AI (1 call)' }));
    const budgetTab = screen.getByRole('tab', { name: 'Budget' });
    act(() => {
      budgetTab.focus();
    });
    answer.resolve(freshAnswer);
    await settle();
    expect(document.activeElement).toBe(budgetTab);
  });
});

describe('workspace: infeasible deadlines', () => {
  it('shows the banner with statuses and links to the timeline', async () => {
    const { user } = await setup({ start: { ...festival, date: today } });
    const banner = screen.getByRole('region', { name: "Some deadlines can't be met" });
    const items = within(banner).getAllByRole('listitem');
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThanOrEqual(5);
    expect(banner.textContent).toMatch(/Can't be done in time|Overdue/u);
    expect(banner.textContent).toContain('check with your local authority');
    await user.click(within(banner).getByRole('link', { name: 'See the timeline' }));
    const tab = screen.getByRole('tab', { name: 'Timeline' });
    expect(tab.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tab);
  });

  it('lists tasks that cannot be done in time before overdue ones, each group in schedule order', () => {
    const task = (title: string, status: Status): ScheduledTask => ({
      id: title,
      title,
      categoryId: 'general',
      start: today,
      end: today,
      latestStart: today,
      latestEnd: today,
      slackDays: 0,
      status,
      dependsOn: [],
    });
    const tasks = [
      task('Late A', 'overdue'),
      task('Tight B', 'infeasible'),
      task('Late C', 'overdue'),
      task('Tight D', 'infeasible'),
    ];
    render(
      <InfeasibleBanner
        schedule={{ tasks, infeasibleCount: 2, overdueCount: 2 }}
        timelineId="timeline"
        onSeeTimeline={() => undefined}
      />,
    );
    const items = within(screen.getByRole('region')).getAllByRole('listitem');
    expect(items.map((item) => within(item).getByText(/^(Late|Tight) /u).textContent)).toEqual([
      'Tight B',
      'Tight D',
      'Late A',
      'Late C',
    ]);
    expect(items[0]?.textContent).toContain("Can't be done in time");
  });

  it('is absent when every deadline can be met', async () => {
    await setup();
    expect(screen.queryByRole('region', { name: "Some deadlines can't be met" })).toBeNull();
  });

  it('labels a task Gemini added as AI text', async () => {
    // Due a year before an event 200 days away, so the AI task is the only one overdue.
    const lateTask = {
      title: 'Book the lantern makers',
      categoryId: 'decor',
      durationDays: 5,
      leadDays: 365,
      after: [],
    };
    const suggestions = { ...aiSuggestions, extraTasks: [lateTask] };
    const client = fakeClient(() =>
      Promise.resolve(ok({ suggestions, meta: aiMeta, cached: false })),
    );
    await setup({ client, start: { ...festival, date: addDays(today, 200) } });
    const banner = screen.getByRole('region', { name: "Some deadlines can't be met" });
    const [item, ...rest] = within(banner).getAllByRole('listitem');
    expect(rest).toHaveLength(0);
    expect(item?.textContent).toContain('Book the lantern makers');
    expect(item?.textContent).toContain('AI · personalized');
    expect(item?.textContent).toContain('Overdue');
  });
});

describe('workspace: lifecycle', () => {
  it('aborts the request in flight when the planner unmounts', async () => {
    const client = fakeClient(() => new Promise<Answer>(() => undefined));
    const store = createPlannerStore({ client, storage: null, today: () => today });
    store.submit(festival);
    const { unmount } = render(<Planner store={store}>{null}</Planner>);
    const signal = client.suggest.mock.calls[0]?.[1];
    unmount();
    await Promise.resolve();
    expect(signal?.aborted).toBe(true);
  });

  it('keeps the request under StrictMode, which unmounts and remounts once', async () => {
    const client = fakeClient(() => new Promise<Answer>(() => undefined));
    const store = createPlannerStore({ client, storage: null, today: () => today });
    store.submit(festival);
    render(
      <StrictMode>
        <Planner store={store}>{null}</Planner>
      </StrictMode>,
    );
    await settle();
    expect(client.suggest.mock.calls[0]?.[1].aborted).toBe(false);
  });
});

describe('workspace: AI at work', () => {
  it('shows the prompt that was sent, the validated answer and the adjustments', async () => {
    await setup();
    const panel = screen.getByText('AI at work').closest('details');
    if (!panel) throw new Error('no AI panel');
    expect(panel.open).toBe(true);
    // The sparkle beside the title is decoration: hidden from assistive technology, not generated text.
    expect(panel.querySelector('summary > [aria-hidden="true"]')?.textContent).toBe('✦');
    // Each receipt is itself a named, focusable region.
    const sent = within(panel).getByRole('region', { name: 'What we sent to Gemini' });
    expect(sent.tagName).toBe('PRE');
    expect(sent.tabIndex).toBe(0);
    expect(sent.textContent).toContain(SYSTEM_INSTRUCTION);
    expect(sent.textContent).toContain('"name": "Green Park Diwali Mela"');
    const answer = within(panel).getByRole('region', { name: 'What came back (validated)' });
    expect(answer.tagName).toBe('PRE');
    expect(answer.tabIndex).toBe(0);
    expect(answer.textContent).toContain('"title": "Diya-lined walkways"');
    const adjustments = within(panel).getByRole('region', { name: 'Engine adjustments' });
    expect(adjustments.textContent).toContain('Clamped');
    expect(adjustments.textContent).toContain("Cost of 'Fireworks finale' clamped");
    const meta = panel.querySelector('.ai-panel__meta')?.textContent;
    expect(meta).toContain('gemini-3.5-flash-lite');
    expect(meta).toContain('1.8 s');
    expect(meta).toContain('1,075 / 1,018');
    // The count appears once in the panel (its meta) and once on the Overview tile.
    expect(screen.getAllByText('AI calls this session')).toHaveLength(2);
  });

  it('counts the request in flight as in progress until it settles', async () => {
    await setup({ client: fakeClient(() => new Promise<Answer>(() => undefined)) });
    const meta = document.querySelector('.ai-panel__calls dd');
    expect(meta?.textContent).toBe('0 (1 in progress)');
    expect(screen.getByText('1 call in progress')).toBeTruthy();
  });

  it('keeps showing the brief that was sent after the guests change', async () => {
    const { user } = await setup();
    await user.click(screen.getByRole('tab', { name: 'Budget' }));
    const guests = screen.getByRole('spinbutton', { name: 'Guests attending' });
    await user.clear(guests);
    await user.type(guests, '400');
    const prompt = screen.getByRole('region', { name: 'What we sent to Gemini' });
    expect(prompt.textContent).toContain('"guests": 250');
  });

  it('says when nothing needed adjusting', async () => {
    const tidy = { ...aiSuggestions, ideas: aiSuggestions.ideas.slice(0, 1) };
    const client = fakeClient(() =>
      Promise.resolve(ok({ suggestions: tidy, meta: aiMeta, cached: false })),
    );
    await setup({ client });
    expect(
      screen.getByText('No adjustments needed — every AI value was within range.'),
    ).toBeTruthy();
  });

  it('says a cached answer cost no new call', async () => {
    const client = fakeClient(
      () => Promise.resolve(ok({ suggestions: aiSuggestions, meta: aiMeta, cached: true })),
      { counting: false },
    );
    await setup({ client });
    expect(screen.getByText('Reused from this session — no new AI call.')).toBeTruthy();
    expect(statusRegion().textContent).toBe('Reused the AI ideas for this brief — no new AI call.');
  });
});

describe('workspace: a restored plan', () => {
  it('without AI offers one call and makes it only when asked', async () => {
    const client = fakeClient();
    const { user, store } = await setup({
      client,
      storage: savedStorage(planned(festival)),
      start: null,
    });
    act(() => {
      store.hydrate();
    });
    expect(client.suggest).not.toHaveBeenCalled();
    expect(screen.getByRole('region', { name: 'What we would send to Gemini' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Personalize with AI (1 call)' }));
    await waitFor(() => {
      expect(screen.getByText(aiSuggestions.summary)).toBeTruthy();
    });
    expect(client.suggest).toHaveBeenCalledTimes(1);
  });

  it('with AI says the answer came with the saved plan', async () => {
    const { store } = await setup({
      storage: savedStorage(planned(festival, { withAi: true })),
      start: null,
    });
    act(() => {
      store.hydrate();
    });
    expect(screen.getByText('Restored with your saved plan — no new AI call.')).toBeTruthy();
  });
});

describe('workspace: tabs', () => {
  it('follow the WAI-ARIA pattern with arrows, Home and End', async () => {
    const { user } = await setup();
    const names = () => screen.getAllByRole('tab').map((t) => t.textContent);
    expect(names()).toEqual(['Overview', 'Budget', 'Timeline', 'Vendors', 'Ideas', 'Volunteers']);
    const overview = screen.getByRole('tab', { name: 'Overview' });
    expect(overview.getAttribute('aria-selected')).toBe('true');
    expect(overview.tabIndex).toBe(0);
    const panel = screen.getByRole('tabpanel', { name: 'Overview' });
    expect(panel.tabIndex).toBe(0);
    expect(overview.getAttribute('aria-controls')).toBe(panel.id);

    const expectSelected = (name: string) => {
      const tab = screen.getByRole('tab', { name });
      expect(tab.getAttribute('aria-selected')).toBe('true');
      expect(tab.tabIndex).toBe(0);
      expect(document.activeElement).toBe(tab);
      expect(screen.getByRole('tabpanel', { name }).classList).not.toContain('is-inactive');
    };
    overview.focus();
    await user.keyboard('{ArrowRight}');
    expectSelected('Budget');
    expect(screen.getByRole('tab', { name: 'Overview' }).tabIndex).toBe(-1);
    await user.keyboard('{End}');
    expectSelected('Volunteers');
    await user.keyboard('{ArrowRight}');
    expectSelected('Overview');
    await user.keyboard('{ArrowLeft}');
    expectSelected('Volunteers');
    await user.keyboard('{Home}');
    expectSelected('Overview');
    await user.keyboard('a');
    expectSelected('Overview');
  });

  it('drop Volunteers outside community events', async () => {
    const birthday = sampleBrief('birthday', today);
    await setup({ start: birthday });
    expect(screen.queryByRole('tab', { name: 'Volunteers' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Volunteers' })).toBeNull();
  });
});

describe('workspace: header actions', () => {
  it('Edit details opens the filled form, and Cancel returns to the plan', async () => {
    const { user } = await setup();
    await user.click(screen.getByRole('button', { name: 'Edit details' }));
    const heading = screen.getByRole('heading', { name: 'Tell us about your event' });
    expect(document.activeElement).toBe(heading);
    expect(screen.getByRole('textbox', { name: 'Event name' })).toHaveProperty(
      'value',
      'Green Park Diwali Mela',
    );
    expect(screen.queryByRole('tablist')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Cancel editing' }));
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
    expect(screen.getByRole('tablist')).toBeTruthy();
  });

  it('submitting the edited brief opens a new plan and focuses it', async () => {
    const { user, client } = await setup();
    await user.click(screen.getByRole('button', { name: 'Edit details' }));
    const name = screen.getByRole('textbox', { name: 'Event name' });
    await user.clear(name);
    await user.type(name, 'Green Park Mela 2');
    await user.click(screen.getByRole('button', { name: 'Generate my plan' }));
    const heading = await screen.findByRole('heading', { level: 1, name: 'Green Park Mela 2' });
    await waitFor(() => {
      expect(document.activeElement).toBe(heading);
    });
    expect(client.suggest).toHaveBeenCalledTimes(2);
  });

  it('a refused edit keeps the form and what was typed, and focuses the reason', async () => {
    let now = today;
    const client = fakeClient();
    const store = createPlannerStore({ client, storage: null, today: () => now });
    await act(() => store.submit(festival).settled);
    const user = userEvent.setup();
    render(
      <main tabIndex={-1}>
        <Planner store={store}>{null}</Planner>
      </main>,
    );
    await user.click(screen.getByRole('button', { name: 'Edit details' }));
    const name = screen.getByRole('textbox', { name: 'Event name' });
    await user.clear(name);
    await user.type(name, 'Kept name');
    const date = screen.getByLabelText('Date');
    await user.clear(date);
    await user.type(date, today);
    // The day turns while the form is open: the form accepts today, the plan no longer can.
    now = addDays(today, 1);
    await user.click(screen.getByRole('button', { name: 'Generate my plan' }));
    await waitFor(() => {
      expect(document.activeElement).toBe(document.getElementById(PLAN_ERROR_ID));
    });
    expect(screen.getByRole('alert').textContent).toContain(
      'Choose a date from today onwards — the plan still uses the last valid date.',
    );
    expect(screen.getByRole('textbox', { name: 'Event name' })).toHaveProperty(
      'value',
      'Kept name',
    );
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Green Park Diwali Mela');
    expect(client.suggest).toHaveBeenCalledTimes(1);
  });

  it('New plan closes the workspace and moves focus to main', async () => {
    const { user } = await setup();
    await user.click(screen.getByRole('button', { name: 'New plan' }));
    expect(screen.getByText('Landing and form')).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('main'));
  });

  it('Clear my data removes the saved plan and says so', async () => {
    const { user, storage } = await setup();
    await user.click(screen.getByRole('button', { name: 'Clear my data' }));
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
    expect(statusRegion().textContent).toContain('Your saved plan was removed from this browser.');
  });

  it('re-plans for a new day when the page becomes visible again', async () => {
    let now = today;
    const client = fakeClient();
    const moved = createPlannerStore({
      client,
      storage: null,
      today: () => now,
    });
    await act(() => moved.submit(festival).settled);
    render(<Planner store={moved}>{null}</Planner>);
    now = addDays(today, 1);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const state = moved.getState().plan;
    expect(state.phase === 'ready' && state.today).toBe(now);
    expect(client.suggest).toHaveBeenCalledTimes(1);
  });
});
