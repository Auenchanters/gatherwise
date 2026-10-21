/**
 * Shared pieces of the plan workspace's browser journeys.
 * Does: serve every response under the production CSP, answer `/api/plan` with the fixed answer
 * (shaped like the real API) while recording each request body and console error, run axe at WCAG
 * 2.1 A and AA, check for sideways page scroll, and open the community sample's plan.
 * Never does: reach a real model.
 */
import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { aiMeta, aiSuggestions } from '../support/fixtures.js';

const WCAG_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** WCAG 2.1 A and AA violations on the page as it is now. */
export const axeViolations = async (
  page: Page,
): Promise<Awaited<ReturnType<AxeBuilder['analyze']>>['violations']> =>
  (await new AxeBuilder({ page }).withTags(WCAG_AA).analyze()).violations;

/** The Content-Security-Policy the production deployment sends. */
export const CSP = /"Content-Security-Policy",\s*"value":\s*"([^"]+)"/u.exec(
  readFileSync('vercel.json', 'utf8'),
)?.[1];

/**
 * Serves every response with the production CSP, answers `/api/plan` with the fixed answer, and
 * records each plan request body and each console error.
 */
export async function prepare(page: Page): Promise<{ requests: unknown[]; errors: string[] }> {
  const requests: unknown[] = [];
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.route('**/*', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { ...response.headers(), 'content-security-policy': CSP ?? '' },
    });
  });
  // Registered last, so it handles /api/plan before the catch-all above.
  await page.route('**/api/plan', async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ json: { suggestions: aiSuggestions, meta: aiMeta } });
  });
  return { requests, errors };
}

/**
 * Whether the page fits the layout viewport. `clientWidth` stays at the device width; a mobile
 * browser zooms out to fit wide content, so `innerWidth` would grow with the overflow and hide it.
 */
export const noSidewaysScroll = (page: Page): Promise<boolean> =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

/** Opens the community sample's plan and waits until the AI's answer has landed. */
export async function generateSample(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try a sample community event' }).click();
  await page.getByRole('button', { name: 'Generate my plan' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Green Park Diwali Mela');
  await expect(page.getByText('Personalized by gemini-3.5-flash-lite in one call.')).toBeVisible();
}

/** The local calendar date `days` from now, as `YYYY-MM-DD`. */
export function isoIn(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
