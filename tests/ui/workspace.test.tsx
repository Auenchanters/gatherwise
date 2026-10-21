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
import { describe, expect, it } from 'vitest';
import { addDays, isoDate } from '../../src/domain/dates.js';
import { formatMoney } from '../../src/domain/money.js';
import { initialPlanState, planReducer } from '../../src/domain/reducer.js';
import { sampleBrief } from '../../src/features/brief/samples.js';
import { clientErrorMessage } from '../../src/features/client/messages.js';
import { savePlan } from '../../src/features/plan/persist.js';
import { Planner } from '../../src/features/plan/planner.js';
import { createPlannerStore } from '../../src/features/plan/planner-store.js';
import { STORAGE_KEY } from '../../src/features/plan/storage-key.js';
import { SYSTEM_INSTRUCTION } from '../../src/shared/prompt.js';
import { err, ok } from '../../src/shared/result.js';
import type { EventBrief } from '../../src/shared/schema.js';
import { fakeClient, memoryStorage, type Answer, type MemoryStorage } from '../support/fakes.js';
import { aiMeta, aiSuggestions } from '../support/fixtures.js';

const today = isoDate('2026-10-21');
const festival = sampleBrief('community', today);

/** Lets every answer the fake has already given land, and React render it. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

/** Renders the planner around a store with a fake client; `start` opens a plan. */
async function setup({
  client = fakeClient(),
  storage = memoryStorage(),
  start = festival,
}: {
  client?: ReturnType<typeof fakeClient>;
  storage?: MemoryStorage;
  start?: EventBrief | null;
} = {}) {
  const user = userEvent.setup();
  const store = createPlannerStore({ client, storage, today: () => today });
  // Not awaited: a fake that never answers leaves the plan pending, as a slow model would.
  if (start) void store.submit(start);
  render(
    <main tabIndex={-1}>
      <Planner store={store}>
        <p>Landing and form</p>
      </Planner>
    </main>,
  );
  await settle();
  return { user, store, client, storage };
}

/** The planner's polite region (the Budget tab has a polite region of its own). */
function statusRegion(): HTMLElement {
  const region = screen
    .getAllByRole('status')
    .find((el) => el.classList.contains('notices__region'));
  if (!region) throw new Error('no notices region');
  return region;
}

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
    expect(facts).toContain('40 days to go');
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
    expect(line && allocated('Food & beverage')).toBe(line && formatMoney(line.allocated, 'INR'));
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
    expect(screen.getByRole('alert').textContent).toContain(
      'Guests must be a whole number from 1 to 5,000',
    );
    const state = store.getState().plan;
    expect(state.phase === 'ready' && state.brief.guests).toBe(250);
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
    const table = screen.getByRole('table');
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
    expect(screen.getByRole('table')).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: 'Overview' }));
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => {
      expect(screen.getByText('Personalized by gemini-3.5-flash-lite in one call.')).toBeTruthy();
    });
    expect(statusRegion().textContent).not.toContain(message);
    expect(client.suggest).toHaveBeenCalledTimes(2);
  });

  it('a notice can be dismissed', async () => {
    const { user } = await setup({
      client: fakeClient(() => Promise.resolve(err({ code: 'network' }))),
    });
    await user.click(screen.getByRole('button', { name: 'Dismiss this notice' }));
    expect(statusRegion().textContent).toBe('');
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

  it('is absent when every deadline can be met', async () => {
    await setup({ start: { ...festival, date: addDays(today, 200) } });
    expect(screen.queryByRole('region', { name: "Some deadlines can't be met" })).toBeNull();
  });
});

describe('workspace: AI at work', () => {
  it('shows the prompt that was sent, the validated answer and the adjustments', async () => {
    await setup();
    const panel = screen.getByText('AI at work').closest('details');
    if (!panel) throw new Error('no AI panel');
    expect(panel.open).toBe(true);
    const prompt = within(panel).getByRole('region', { name: 'What we sent to Gemini' });
    const sent = within(prompt).getByText(/System instruction/u, { selector: 'pre' });
    expect(sent.tabIndex).toBe(0);
    expect(sent.textContent).toContain(SYSTEM_INSTRUCTION);
    expect(sent.textContent).toContain('"name": "Green Park Diwali Mela"');
    const answer = within(panel).getByRole('region', { name: 'What came back (validated)' });
    expect(answer.textContent).toContain('"title": "Diya-lined walkways"');
    const adjustments = within(panel).getByRole('region', { name: 'Engine adjustments' });
    expect(adjustments.textContent).toContain('Clamped');
    expect(adjustments.textContent).toContain("Cost of 'Fireworks finale' clamped");
    const meta = panel.querySelector('.ai-panel__meta')?.textContent;
    expect(meta).toContain('gemini-3.5-flash-lite');
    expect(meta).toContain('1.8 s');
    expect(meta).toContain('1,075 / 1,018');
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
  /** Storage holding a plan for `festival`, with or without its AI answer. */
  function saved(withAi: boolean) {
    let state = planReducer(initialPlanState, { type: 'brief/submitted', brief: festival, today });
    if (withAi) {
      state = planReducer(state, {
        type: 'ai/applied',
        generation: 1,
        suggestions: aiSuggestions,
        meta: aiMeta,
      });
    }
    const storage = memoryStorage();
    savePlan(storage, state);
    return memoryStorage(storage.getItem(STORAGE_KEY) ?? '');
  }

  it('without AI offers one call and makes it only when asked', async () => {
    const client = fakeClient();
    const { user, store } = await setup({ client, storage: saved(false), start: null });
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
    const { store } = await setup({ storage: saved(true), start: null });
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

  it('keep later sections as labelled placeholders, and drop Volunteers outside community events', async () => {
    const birthday = sampleBrief('birthday', today);
    await setup({ start: birthday });
    expect(screen.queryByRole('tab', { name: 'Volunteers' })).toBeNull();
    expect(screen.getAllByText('Coming in the next step.')).toHaveLength(3);
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
    await act(() => moved.submit(festival));
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
