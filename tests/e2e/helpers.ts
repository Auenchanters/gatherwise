/**
 * Shared pieces of the plan workspace's browser journeys.
 * Does: serve every response under the production CSP, answer `/api/plan` with the fixed answer
 * (shaped like the real API) or, when a test passes one, a failure, while recording each request
 * body and console error; run axe at WCAG 2.2 A and AA plus its best-practice rules; check for sideways page scroll; fill the
 * form from a landing sample; and open the community sample's plan.
 * Never does: reach a real model.
 */
import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { aiMeta, aiSuggestions } from '../support/fixtures.js';

/** The community sample's event name, which becomes the plan's h1. */
export const SAMPLE_NAME = 'Green Park Diwali Mela';

/** A landing sample: the button that fills the form and the event name it fills in. */
interface Sample {
  readonly button: string;
  readonly name: string;
}

const COMMUNITY_SAMPLE: Sample = { button: 'Try a sample community event', name: SAMPLE_NAME };

/** The wedding sample, whose plan has the bar vendor and no Volunteers tab. */
export const WEDDING_SAMPLE: Sample = {
  button: 'Try a sample wedding',
  name: "Meera & Rohan's Wedding",
};

/** The line the AI panel shows once the fixed answer has landed. */
export const AI_DONE = 'Personalized by gemini-3.5-flash-lite in one call.';

/** WCAG 2.0, 2.1 and 2.2 at A and AA, and axe's best-practice rules (landmarks, heading order…). */
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

/** Violations of {@link AXE_TAGS} on the page as it is now. */
export const axeViolations = async (
  page: Page,
): Promise<Awaited<ReturnType<AxeBuilder['analyze']>>['violations']> =>
  (await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()).violations;

/** The Content-Security-Policy the production deployment sends. */
export const CSP = /"Content-Security-Policy",\s*"value":\s*"([^"]+)"/u.exec(
  readFileSync('vercel.json', 'utf8'),
)?.[1];

/** What the mocked `/api/plan` answers with: a status and a JSON body. */
export interface PlanReply {
  readonly status: number;
  readonly body: unknown;
}

/** The fixed good answer, shaped as the real API returns it. */
const GOOD_REPLY: PlanReply = { status: 200, body: { suggestions: aiSuggestions, meta: aiMeta } };

/**
 * Serves every response with the production CSP, answers `/api/plan` with `reply` (the fixed good
 * answer unless a test says otherwise), and records each plan request body and each console error.
 */
export async function prepare(
  page: Page,
  reply: PlanReply = GOOD_REPLY,
): Promise<{ requests: unknown[]; errors: string[] }> {
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
    await route.fulfill({ status: reply.status, json: reply.body });
  });
  return { requests, errors };
}

/**
 * What makes the page wider than the layout viewport: empty when it fits, otherwise the outermost
 * elements that cross the right edge, so a failure names its cause. `clientWidth` stays at the
 * device width; a mobile browser zooms out to fit wide content, so `innerWidth` would grow with
 * the overflow and hide it.
 */
export const sidewaysOverflow = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const root = document.documentElement;
    if (root.scrollWidth <= root.clientWidth) return [];
    const edge = root.clientWidth + 0.5;
    const crosses = (el: Element | null): boolean =>
      el !== null && el.getBoundingClientRect().right > edge;
    return Array.from(document.body.querySelectorAll('*'))
      .filter((el) => crosses(el) && !crosses(el.parentElement))
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}.${el.className}: ${el.textContent.trim().slice(0, 40)}`,
      );
  });

/** Opens the landing and fills the form from a sample (the community one unless told otherwise). */
export async function openSampleForm(page: Page, sample: Sample = COMMUNITY_SAMPLE): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: sample.button }).click();
  await expect(page.getByRole('textbox', { name: 'Event name' })).toHaveValue(sample.name);
}

/** Opens the community sample's plan and waits until the AI's answer has landed. */
export async function generateSample(page: Page): Promise<void> {
  await openSampleForm(page);
  await page.getByRole('button', { name: 'Generate my plan' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(SAMPLE_NAME);
  await expect(page.getByText(AI_DONE)).toBeVisible();
}

/** The local calendar date `days` from now, as `YYYY-MM-DD`. */
export function isoIn(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
