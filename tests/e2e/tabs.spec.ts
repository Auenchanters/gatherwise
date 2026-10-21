/**
 * Browser journeys for the Timeline, Vendors, Ideas and Volunteers tabs, against the production
 * build on desktop and mobile, under the production CSP, with `/api/plan` mocked.
 *
 * Does: walks every tab with the keyboard (arrows, Home, End, Tab into the panel) and runs axe at
 * WCAG 2.1 AA on each new tab with no sideways scroll; downloads the calendar and checks it is an
 * iCalendar file; checks that printing shows every tab and no buttons; and counts requests through
 * the model-call budget journey: generating is 1 request, five edits (guests, budget, date, a
 * ticked task, a vendor status) leave it at 1, and "Refresh ideas" makes it 2.
 * Never does: reach a real model.
 */
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import {
  axeViolations,
  generateSample,
  isoIn,
  noSidewaysScroll,
  prepare,
  SAMPLE_NAME,
} from './helpers.js';

const TABS = ['Overview', 'Budget', 'Timeline', 'Vendors', 'Ideas', 'Volunteers'] as const;
const NEW_TABS = ['Timeline', 'Vendors', 'Ideas', 'Volunteers'] as const;

test('every tab is reachable by keyboard, and each new tab has no axe violations', async ({
  page,
}) => {
  const { errors } = await prepare(page);
  await generateSample(page);

  await page.getByRole('tab', { name: 'Overview' }).focus();
  for (const name of TABS.slice(1)) {
    await page.keyboard.press('ArrowRight');
    const tab = page.getByRole('tab', { name });
    await expect(tab).toBeFocused();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel', { name })).toBeVisible();
    if (name === 'Vendors') {
      // Named by its words alone: the sparkle beside it is decoration, not part of the name.
      await expect(
        page.getByRole('heading', {
          level: 4,
          name: 'Questions to ask (AI · personalized)',
          exact: true,
        }),
      ).toBeVisible();
    }
    if ((NEW_TABS as readonly string[]).includes(name)) {
      await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
      expect(await axeViolations(page), `axe on ${name}`).toEqual([]);
      expect(await noSidewaysScroll(page), `no sideways scroll on ${name}`).toBe(true);
    }
  }

  // Wraps around, and Home and End jump to the ends.
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Overview' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'Volunteers' })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(page.getByRole('tab', { name: 'Overview' })).toBeFocused();

  // From a tab, Tab goes into its panel, and the panel's controls follow.
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Timeline' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('tabpanel', { name: 'Timeline' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('checkbox', { name: 'Hide done tasks' })).toBeFocused();
  expect(errors).toEqual([]);
});

test('the calendar downloads as an iCalendar file named after the event', async ({ page }) => {
  const { requests } = await prepare(page);
  await generateSample(page);
  await page.getByRole('tab', { name: 'Timeline' }).click();
  await page.getByRole('checkbox', { name: 'Book the venue' }).check();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download calendar (.ics)' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(
    /^gatherwise-green-park-diwali-mela-\d{4}-\d{2}-\d{2}\.ics$/u,
  );
  const path = await download.path();
  const text = await readFile(path, 'utf8');
  expect(text.startsWith('BEGIN:VCALENDAR')).toBe(true);
  expect(text.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
  expect(text).toContain(`SUMMARY:${SAMPLE_NAME}`);
  expect(text).toMatch(/DTSTAMP:\d{8}T\d{6}Z/u);
  // A task Gemini added says so in the calendar too (long lines are folded, so unfold first).
  expect(text.replaceAll('\r\n ', '')).toContain(
    'SUMMARY:Order clay diyas\r\nDESCRIPTION:AI · personalized — Start by ',
  );
  // The task ticked off is not in the calendar; an open one is.
  expect(text).not.toContain('SUMMARY:Book the venue');
  expect(text).toContain('SUMMARY:Form the organizing committee');
  expect(requests).toHaveLength(1);
});

test('printing shows every tab, and no buttons or menus', async ({ page }) => {
  await prepare(page);
  await generateSample(page);
  await page.emulateMedia({ media: 'print' });
  for (const name of NEW_TABS) {
    await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
  }
  await expect(page.getByRole('tablist')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Print plan' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Refresh ideas (1 AI call)' })).toBeHidden();
  await expect(page.getByRole('combobox', { name: 'Status for Tent / shamiana' })).toBeHidden();
  await expect(page.getByText('Status: To contact').first()).toBeVisible();
});

test('the model-call budget: 1 to generate, none for five edits, 1 for Refresh ideas', async ({
  page,
}) => {
  const { requests, errors } = await prepare(page);
  await generateSample(page);
  expect(requests).toHaveLength(1);

  // 1. Guests, 2. budget and 3. date, on the Budget tab.
  await page.getByRole('tab', { name: 'Budget' }).click();
  await page.getByRole('spinbutton', { name: 'Guests attending' }).fill('300');
  await expect(page.getByText(/^Budget updated for 300 guests/u)).toBeVisible();
  await page.getByRole('spinbutton', { name: 'Total budget' }).fill('200000');
  await expect(page.getByText(/^Budget updated to ₹2,00,000/u)).toBeVisible();
  await page.getByLabel('Event date').fill(isoIn(60));
  await expect(page.getByText(/^Plan updated for /u)).toBeVisible();
  expect(requests).toHaveLength(1);

  // 4. Tick a task.
  await page.getByRole('tab', { name: 'Timeline' }).click();
  const task = page.getByRole('checkbox', { name: 'Book the venue' });
  await task.check();
  await expect(task).toBeChecked();
  await expect(page.getByText("Marked 'Book the venue' done")).toBeAttached();
  expect(requests).toHaveLength(1);

  // 5. Set a vendor's status.
  await page.getByRole('tab', { name: 'Vendors' }).click();
  const status = page.getByRole('combobox', { name: 'Status for Tent / shamiana' });
  await status.selectOption('booked');
  await expect(status).toHaveValue('booked');
  expect(requests).toHaveLength(1);

  // The counter on the Overview agrees: still one call.
  await page.getByRole('tab', { name: 'Overview' }).click();
  await expect(page.locator('.ai-panel__calls dd')).toHaveText('1');

  // Refresh ideas is the only thing that asks again, and it asks once.
  await page.getByRole('tab', { name: 'Ideas' }).click();
  await expect(page.getByText('Edits never call the AI; only this button does.')).toBeVisible();
  await page.getByRole('button', { name: 'Refresh ideas (1 AI call)' }).click();
  await expect(page.getByText('Fresh ideas are in. AI calls this session: 2.')).toBeAttached();
  expect(requests).toHaveLength(2);
  // It asks about the plan as edited, not as first generated.
  expect(requests[1]).toEqual({
    brief: expect.objectContaining({
      name: SAMPLE_NAME,
      guests: 300,
      budget: 200_000,
    }),
  });
  await expect(page.getByRole('button', { name: 'Refresh ideas (1 AI call)' })).toBeEnabled();
  await page.getByRole('tab', { name: 'Overview' }).click();
  await expect(page.locator('.ai-panel__calls dd')).toHaveText('2');
  expect(await axeViolations(page)).toEqual([]);
  expect(errors).toEqual([]);
});
