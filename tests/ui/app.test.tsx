/**
 * RTL tests for the landing state of the app shell (src/app.tsx with src/features/brief/landing.tsx).
 *
 * Does: checks the landmarks and the single h1, the problem-statement copy, that the skip link is
 * the first stop, and that a sample button fills the form, moves focus to the form heading and
 * submits to the temporary polite status.
 * Never does: call the network; samples are dated from the app's own `today`.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/app.js';

describe('App landing state', () => {
  it('has one main, one h1 that sells the plan, and the brand in the banner', () => {
    render(<App />);
    expect(screen.getAllByRole('main')).toHaveLength(1);
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings.map((h) => h.textContent)).toEqual(['Plan a celebration that adds up']);
    expect(within(screen.getByRole('banner')).getByText('Gatherwise')).toBeTruthy();
  });

  it('names budgets, timelines, vendors and AI ideas for all three kinds of event', () => {
    render(<App />);
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
    const user = userEvent.setup();
    render(<App />);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Skip to main content' }));
  });

  it.each([
    ['Try a sample community event', 'Green Park Diwali Mela'],
    ['Try a sample birthday', "Aarav's 8th — space adventure"],
  ])('"%s" fills the form and focuses its heading', async (button, name) => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: button }));
    expect(screen.getByRole('textbox', { name: 'Event name' })).toHaveProperty('value', name);
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { name: 'Tell us about your event' }),
    );
    await user.click(screen.getByRole('button', { name: 'Generate my plan' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Plan ready to generate');
  });
});
