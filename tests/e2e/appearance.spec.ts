/**
 * The app in the visitor's own colour settings.
 * Does: with a dark colour scheme, check the dark palette is in force and run axe (WCAG 2.1 A and
 * AA, colour contrast included) on the landing page, the filled form and every tab of the
 * community plan, the AI panel open; check AI text in a Hindi plan is tagged `lang="hi"` while the
 * page stays English; with a forced palette, check the progress bar stays visible.
 * Never does: compare screenshots.
 */
import { expect, test } from '@playwright/test';
import { AI_DONE, axeViolations, generateSample, openSampleForm, prepare } from './helpers.js';

const TABS = ['Overview', 'Budget', 'Timeline', 'Vendors', 'Ideas', 'Volunteers'] as const;

test.describe('dark colour scheme', () => {
  test.use({ colorScheme: 'dark' });

  test('the landing page, the form and every tab pass axe', async ({ page }) => {
    // Eight full axe scans: more than the default 30 s on a busy runner.
    test.slow();
    const { errors } = await prepare(page);
    await openSampleForm(page);
    // The dark tokens are in force, not the light ones (--color-bg is #14181d).
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
      'rgb(20, 24, 29)',
    );
    expect(await axeViolations(page), 'axe on the filled form').toEqual([]);

    await generateSample(page);
    await page.locator('summary', { hasText: 'AI at work' }).click();
    for (const name of TABS) {
      await page.getByRole('tab', { name }).click();
      await expect(page.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
      expect(await axeViolations(page), `axe on ${name}`).toEqual([]);
    }
    expect(errors).toEqual([]);
  });
});

test('AI text carries the language the plan asked Gemini to write in', async ({ page }) => {
  await prepare(page);
  await openSampleForm(page);
  await page.getByLabel('Language for AI suggestions').selectOption('Hindi');
  await page.getByRole('button', { name: 'Generate my plan' }).click();
  await expect(page.getByText(AI_DONE)).toBeVisible();
  await page.getByRole('tab', { name: 'Ideas' }).click();
  const title = page.locator('.idea__title').first();
  expect(await title.evaluate((el) => el.closest('[lang]')?.getAttribute('lang'))).toBe('hi');
  // The page itself stays English: only Gemini's words are tagged.
  expect(await page.locator('html').getAttribute('lang')).toBe('en');
});

test.describe('forced colours', () => {
  test.use({ forcedColors: 'active' });

  test('the progress bar keeps a visible edge', async ({ page }) => {
    await prepare(page);
    await generateSample(page);
    await page.getByRole('tab', { name: 'Timeline' }).click();
    const bar = page.locator('.timeline__bar');
    await expect(bar).toBeVisible();
    expect(await bar.evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe('solid');
  });
});
