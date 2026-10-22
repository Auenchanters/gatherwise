/**
 * RTL tests for the app shell (src/app.tsx) and its on-demand planner.
 *
 * Does: checks the landmarks and the single h1, the problem-statement copy and the skip link; that
 * a sample fills the form, takes focus and is announced; that generating loads the planner and
 * opens the workspace with one AI call; that a saved plan is restored with no call, and a corrupt
 * one is dropped with a notice; that a planner chunk that fails to load leaves the landing usable;
 * and that "New plan" brings back a blank form on the same store.
 * Never does: call the network (every App gets a fake client) or depend on the real date (`Date`
 * is pinned to 2026-10-21).
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/app.js';
import { sampleBrief } from '../../src/features/brief/samples.js';
import { PLAN_ERROR_ID, STORAGE_KEY } from '../../src/features/plan/storage-key.js';
import {
  fakeClient,
  memoryStorage,
  planned,
  savedStorage,
  type MemoryStorage,
} from '../support/fakes.js';
import { TODAY as today } from '../support/fixtures.js';

const PLANNER = '../../src/features/plan/planner.js';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 21, 12));
});

afterEach(() => {
  vi.doUnmock(PLANNER);
  vi.useRealTimers();
});

function setup(storage: MemoryStorage = memoryStorage()) {
  const client = fakeClient();
  const user = userEvent.setup();
  render(<App client={client} storage={storage} />);
  return { client, storage, user };
}

const appStatus = (): HTMLElement => {
  const status = document.querySelector<HTMLElement>('.app-status');
  if (!status) throw new Error('no app status');
  return status;
};

describe('App landing state', () => {
  it('has one main, one h1 that sells the plan, and the brand in the banner', () => {
    setup();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings.map((h) => h.textContent)).toEqual(['Plan a celebration that adds up']);
    expect(within(screen.getByRole('banner')).getByText('Gatherwise')).toBeTruthy();
  });

  it('names budgets, timelines, vendors and AI ideas for all three kinds of event', () => {
    setup();
    const landing = screen.getByRole('region', { name: 'Plan a celebration that adds up' });
    const text = landing.textContent;
    for (const phrase of [
      'weddings',
      'birthdays',
      'community events',
      'budget',
      'timeline',
      'vendors',
      'Google Gemini',
      'Budgets that add up',
      'Deadlines that are honest',
      'AI ideas you can check',
    ]) {
      expect(text).toContain(phrase);
    }
  });

  it('puts the skip link first in the tab order', async () => {
    const { user } = setup();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Skip to main content' }));
  });

  it.each([
    ['Try a sample wedding', "Meera & Rohan's Wedding", 'wedding'],
    ['Try a sample birthday', "Aarav's 8th — space adventure", 'birthday'],
    ['Try a sample community event', 'Green Park Diwali Mela', 'community event'],
  ])('"%s" fills the form, focuses its heading and says so', async (button, name, sample) => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: button }));
    expect(screen.getByRole('textbox', { name: 'Event name' })).toHaveProperty('value', name);
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { name: 'Tell us about your event' }),
    );
    const announced = screen.getByText(
      `Filled in the sample ${sample} — check the details, then generate your plan.`,
    );
    expect(announced.getAttribute('role')).toBe('status');
  });
});

describe('App planner', () => {
  it('generating loads the planner and opens the workspace with one AI call', async () => {
    const { user, client, storage } = setup();
    await user.click(screen.getByRole('button', { name: 'Try a sample community event' }));
    await user.click(screen.getByRole('button', { name: 'Generate my plan' }));
    const heading = await screen.findByRole('heading', {
      level: 1,
      name: 'Green Park Diwali Mela',
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(heading);
    });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getAllByRole('main')).toHaveLength(1);
    await screen.findByText('Personalized by gemini-3.5-flash-lite in one call.');
    expect(client.suggest).toHaveBeenCalledTimes(1);
    expect(storage.getItem(STORAGE_KEY)).not.toBeNull();
  });

  it('New plan brings back a blank form, and the next plan uses the same store', async () => {
    const { user, client } = setup();
    await user.click(screen.getByRole('button', { name: 'Try a sample birthday' }));
    await user.click(screen.getByRole('button', { name: 'Generate my plan' }));
    await screen.findByRole('heading', { level: 1, name: "Aarav's 8th — space adventure" });
    await user.click(screen.getByRole('button', { name: 'New plan' }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Plan a celebration that adds up',
    );
    expect(screen.getByRole('textbox', { name: 'Event name' })).toHaveProperty('value', '');
    await user.click(screen.getByRole('button', { name: 'Try a sample community event' }));
    await user.click(screen.getByRole('button', { name: 'Generate my plan' }));
    await screen.findByRole('heading', { level: 1, name: 'Green Park Diwali Mela' });
    await waitFor(() => {
      expect(client.suggest).toHaveBeenCalledTimes(2);
    });
    // The sample's "Filled in…" line described a form that is gone; a blank form carries no status.
    await user.click(screen.getByRole('button', { name: 'New plan' }));
    expect(screen.getByRole('textbox', { name: 'Event name' })).toHaveProperty('value', '');
    expect(appStatus().textContent).toBe('');
  });

  it('restores a saved plan without calling the AI', async () => {
    const { client } = setup(savedStorage(planned(sampleBrief('community', today))));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Welcome back');
    expect(screen.getByRole('status').textContent).toBe('Loading your saved plan…');
    await screen.findByRole('heading', { level: 1, name: 'Green Park Diwali Mela' });
    expect(screen.getByRole('button', { name: 'Personalize with AI (1 call)' })).toBeTruthy();
    expect(client.suggest).not.toHaveBeenCalled();
  });

  it('drops a corrupt saved plan, says so and shows the landing', async () => {
    const storage = memoryStorage('{"v":1,"brief":"<script>"}');
    setup(storage);
    await screen.findByText("We couldn't read your saved plan, so we started fresh.");
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Plan a celebration that adds up',
    );
    expect(storage.removed).toEqual([STORAGE_KEY]);
  });

  it('a brief the planner refuses stays in the form, and its reason takes focus', async () => {
    const { user, client } = setup();
    await user.click(screen.getByRole('button', { name: 'Try a sample community event' }));
    const date = screen.getByLabelText('Date');
    await user.clear(date);
    await user.type(date, today);
    // The day turns after the page loaded: the form still accepts today, the planner cannot.
    vi.setSystemTime(new Date(2026, 9, 22, 12));
    const expectRefused = async () => {
      await waitFor(() => {
        expect(document.activeElement).toBe(document.getElementById(PLAN_ERROR_ID));
      });
      expect(screen.getByRole('alert').textContent).toContain('Choose a date from today onwards.');
      expect(screen.getByRole('textbox', { name: 'Event name' })).toHaveProperty(
        'value',
        'Green Park Diwali Mela',
      );
      expect(screen.getByLabelText('Date')).toHaveProperty('value', today);
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
        'Plan a celebration that adds up',
      );
    };
    // First through the planner chunk loading, then through the loaded planner.
    await user.click(screen.getByRole('button', { name: 'Generate my plan' }));
    await expectRefused();
    await user.click(screen.getByRole('button', { name: 'Generate my plan' }));
    await expectRefused();
    expect(client.suggest).not.toHaveBeenCalled();
  });

  it('keeps the landing usable when the planner cannot load', async () => {
    vi.doMock(PLANNER, () => {
      throw new Error('Failed to fetch dynamically imported module');
    });
    const { user, client } = setup();
    await user.click(screen.getByRole('button', { name: 'Try a sample community event' }));
    await user.click(screen.getByRole('button', { name: 'Generate my plan' }));
    await waitFor(() => {
      expect(appStatus().textContent).toBe(
        "We couldn't open the planner — check your connection, then try again or reload the page.",
      );
    });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Plan a celebration that adds up',
    );
    expect(screen.getByRole('textbox', { name: 'Event name' })).toHaveProperty(
      'value',
      'Green Park Diwali Mela',
    );
    expect(client.suggest).not.toHaveBeenCalled();
  });

  it('says so when a saved plan cannot be loaded, and shows the landing', async () => {
    vi.doMock(PLANNER, () => {
      throw new Error('Failed to fetch dynamically imported module');
    });
    setup(savedStorage(planned(sampleBrief('community', today))));
    await waitFor(() => {
      expect(appStatus().textContent).toContain("We couldn't load your saved plan");
    });
    expect(screen.getByRole('button', { name: 'Generate my plan' })).toBeTruthy();
  });
});
