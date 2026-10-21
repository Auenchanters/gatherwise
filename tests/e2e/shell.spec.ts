/**
 * Browser journeys for the landing state, run against the production build on desktop and mobile.
 *
 * Does: checks the landmarks and single h1, that the skip link comes first, axe at WCAG 2.1 AA on
 * the empty page, the sample-filled form and the error summary, and a clean console under the CSP.
 * Never does: call the planning API; the form's submit is still local in this build.
 */
import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const WCAG_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const axeViolations = async (page: Page) =>
  (await new AxeBuilder({ page }).withTags(WCAG_AA).analyze()).violations;

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

  test('has no axe violations at WCAG 2.1 A and AA', async ({ page }) => {
    await page.goto('/');
    expect(await axeViolations(page)).toEqual([]);
  });

  test('renders under the production CSP with no console errors', async ({ page }) => {
    const csp = /"Content-Security-Policy",\s*"value":\s*"([^"]+)"/u.exec(
      readFileSync('vercel.json', 'utf8'),
    )?.[1];
    expect(csp).toBeTruthy();
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.route('**/*', async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: { ...response.headers(), 'content-security-policy': csp ?? '' },
      });
    });
    await page.goto('/');
    await expect(page.locator('h1')).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe('brief form', () => {
  test('the community sample fills the form, takes focus and has no axe violations', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Try a sample community event' }).click();
    await expect(page.getByRole('heading', { name: 'Tell us about your event' })).toBeFocused();
    await expect(page.getByRole('textbox', { name: 'Event name' })).toHaveValue(
      'Green Park Diwali Mela',
    );
    await expect(page.getByRole('group', { name: 'Community extras' })).toBeVisible();
    await expect(
      page.getByRole('status').filter({ hasText: 'Filled in the sample community event' }),
    ).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);

    await page.getByRole('button', { name: 'Generate my plan' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Plan ready to generate' }),
    ).toBeVisible();
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
