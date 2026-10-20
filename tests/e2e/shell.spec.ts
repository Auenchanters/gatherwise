import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.describe('app shell', () => {
  test('has one main landmark and one h1 naming the product', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('main')).toHaveCount(1);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('h1')).toContainText('Gatherwise');
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
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(violations).toEqual([]);
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
