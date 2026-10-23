/**
 * Browser journeys for the landing state, run against the production build on desktop and mobile.
 *
 * Does: checks the landmarks and single h1, that the skip link comes first, axe at WCAG 2.2 AA and
 * best practice on the empty page, the sample-filled form and the error summary, and a clean
 * console under the CSP.
 * Never does: generate a plan; tests/e2e/planner.spec.ts covers that, with the API mocked.
 */
import { expect, test } from '@playwright/test';
import { axeViolations, CSP, openSampleForm, prepare } from './helpers.js';

test.describe('app shell', () => {
  test('has one main landmark, one h1 and the brand in the banner', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('main')).toHaveCount(1);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('h1')).toHaveText('Plan a celebration that adds up');
    await expect(page.getByRole('banner')).toContainText('Gatherwise');
    await expect(page.getByText('Plans that add up.')).toBeVisible();
  });

  test('skip link is the first focusable element and moves focus to main', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('main')).toBeFocused();
  });

  test('has no axe violations at WCAG 2.2 A and AA or best practice', async ({ page }) => {
    await page.goto('/');
    expect(await axeViolations(page)).toEqual([]);
  });

  test('renders under the production CSP with no console errors', async ({ page }) => {
    expect(CSP).toBeTruthy();
    const { errors } = await prepare(page);
    await page.goto('/');
    await expect(page.locator('h1')).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe('brief form', () => {
  test('the community sample fills the form, takes focus and has no axe violations', async ({
    page,
  }) => {
    await openSampleForm(page);
    await expect(page.getByRole('heading', { name: 'Tell us about your event' })).toBeFocused();
    await expect(page.getByRole('group', { name: 'Community extras' })).toBeVisible();
    await expect(
      page.getByRole('status').filter({ hasText: 'Filled in the sample community event' }),
    ).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });

  test('an empty submit focuses an error summary that has no axe violations', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Generate my plan' }).click();
    const summary = page.getByRole('alert');
    await expect(summary).toBeFocused();
    await expect(summary).toContainText("There's a problem");
    await summary.getByRole('link', { name: 'Enter the number of guests' }).click();
    await expect(page.getByRole('spinbutton', { name: 'Guests' })).toBeFocused();
    expect(await axeViolations(page)).toEqual([]);
  });
});
