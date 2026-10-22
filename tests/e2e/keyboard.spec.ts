/**
 * The keyboard-only journey, against the production build on desktop and mobile, under the
 * production CSP, with `/api/plan` mocked.
 *
 * Does: goes from the landing to a finished plan and its tabs with Tab, Shift+Tab, the arrow keys,
 * Enter and Space alone: skip link, the three samples, Generate, every tab and its heading, a
 * ticked task, a vendor's status, "Adjust with AI". Checks that every stop shows a focus ring
 * (`:focus-visible` with a drawn outline), that a page-wide listener never saw a pointer, and the
 * model-call count: 1 to create the plan, 2 after Adjust with AI.
 * Never does: use the mouse, or reach a real model.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { AI_DONE, prepare, SAMPLE_NAME } from './helpers.js';

/** Each tab and the h2 its panel opens with. */
const TABS = [
  { name: 'Overview', heading: 'Your plan at a glance' },
  { name: 'Budget', heading: 'Budget' },
  { name: 'Timeline', heading: 'Timeline' },
  { name: 'Vendors', heading: 'Vendors' },
  { name: 'Ideas', heading: 'Ideas' },
  { name: 'Volunteers', heading: 'Volunteers' },
] as const;

/**
 * Whether the focused element shows a ring: it matches `:focus-visible` and has an outline drawn.
 * The one exception is the picker button inside a date or time input, an extra tab stop in
 * Chromium where focus sits inside the browser's own control, which draws its own ring and does
 * not make the input itself `:focus-visible`.
 */
const focusIsVisible = (page: Page): Promise<boolean> =>
  page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return false;
    const { outlineStyle, outlineWidth } = getComputedStyle(el);
    if (el.matches(':focus-visible'))
      return outlineStyle !== 'none' && parseFloat(outlineWidth) > 0;
    return el instanceof HTMLInputElement && (el.type === 'date' || el.type === 'time');
  });

/** Presses `key` until `target` has focus, checking each stop shows a ring; fails after `max`. */
async function pressUntil(
  page: Page,
  key: 'Tab' | 'Shift+Tab',
  target: Locator,
  max = 80,
): Promise<void> {
  for (let stop = 1; stop <= max; stop += 1) {
    await page.keyboard.press(key);
    if (!(await focusIsVisible(page))) {
      const html = await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 120));
      throw new Error(`no focus ring at stop ${stop}: ${html}`);
    }
    if (await target.evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error(`${key} did not reach ${target.toString()} in ${max} presses`);
}

test('the whole journey works with the keyboard alone', async ({ page }) => {
  // About 150 key presses, each checked; a slow runner needs more than the default 30 s.
  test.setTimeout(90_000);
  // A page-wide capture listener: a real mouse or touch would trip it, Enter and Space do not.
  await page.addInitScript(() => {
    addEventListener(
      'pointerdown',
      () => {
        Reflect.set(window, 'pointerUsed', true);
      },
      true,
    );
  });
  const { requests, errors } = await prepare(page);
  await page.goto('/');

  // Skip link first, then the three samples in the order the headline names the events; Enter on
  // the community one fills the form and focuses its heading.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
  expect(await focusIsVisible(page)).toBe(true);
  for (const name of [
    'Try a sample wedding',
    'Try a sample birthday',
    'Try a sample community event',
  ]) {
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name })).toBeFocused();
    expect(await focusIsVisible(page)).toBe(true);
  }
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Event name' })).toHaveValue(SAMPLE_NAME);
  await expect(page.getByRole('heading', { name: 'Tell us about your event' })).toBeFocused();

  // Tab down the form to Generate, and press Enter.
  await pressUntil(page, 'Tab', page.getByRole('button', { name: 'Generate my plan' }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(SAMPLE_NAME);
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  await expect(page.getByText(AI_DONE)).toBeVisible();
  expect(requests).toHaveLength(1);

  // Tab to the tabs, then arrow through every one; each opens its panel and its heading shows.
  const tab = (name: string): Locator => page.getByRole('tab', { name, exact: true });
  await pressUntil(page, 'Tab', tab('Overview'));
  for (const { name, heading } of TABS) {
    if (name !== 'Overview') await page.keyboard.press('ArrowRight');
    await expect(tab(name)).toBeFocused();
    await expect(tab(name)).toHaveAttribute('aria-selected', 'true');
    expect(await focusIsVisible(page), `focus ring on the ${name} tab`).toBe(true);
    await expect(
      page.getByRole('tabpanel', { name }).getByRole('heading', { level: 2, name: heading }),
    ).toBeVisible();
  }

  // Timeline: Space ticks a task.
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(tab('Timeline')).toBeFocused();
  const task = page.getByRole('checkbox', { name: 'Book the venue' });
  await pressUntil(page, 'Tab', task);
  await expect(task).not.toBeChecked();
  await page.keyboard.press('Space');
  await expect(task).toBeChecked();
  await expect(page.getByText("Marked 'Book the venue' done")).toBeAttached();

  // Vendors: back to the tab list, across, and an arrow key changes a status.
  await pressUntil(page, 'Shift+Tab', tab('Timeline'));
  await page.keyboard.press('ArrowRight');
  await expect(tab('Vendors')).toBeFocused();
  const status = page.getByRole('combobox', { name: 'Status for Tent / shamiana' });
  await pressUntil(page, 'Tab', status);
  await expect(status).toHaveValue('to_contact');
  await page.keyboard.press('ArrowDown');
  await expect(status).toHaveValue('quoted');
  await expect(page.getByText("Marked 'Tent / shamiana' as quoted")).toBeAttached();
  expect(requests).toHaveLength(1);

  // Ideas: type what should change, then Enter is the second and last AI call.
  await pressUntil(page, 'Shift+Tab', tab('Vendors'));
  await page.keyboard.press('ArrowRight');
  await expect(tab('Ideas')).toBeFocused();
  const change = page.getByRole('textbox', { name: 'What should change? (optional)' });
  await pressUntil(page, 'Tab', change);
  await page.keyboard.type('cheaper');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Your ideas are updated. AI calls this session: 2.')).toBeAttached();
  expect(requests).toHaveLength(2);

  expect(await page.evaluate(() => Reflect.has(window, 'pointerUsed'))).toBe(false);
  expect(errors).toEqual([]);
});
