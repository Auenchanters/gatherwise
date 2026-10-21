/**
 * Browser journeys for the plan workspace, against the production build on desktop and mobile,
 * under the production CSP, with `/api/plan` mocked by a fixed answer shaped exactly like the real
 * API (`{suggestions, meta}`).
 *
 * Does: generates the community sample and checks the model-call budget by counting requests: one
 * to create the plan, none for guests 250 → 400 (which still rescales the budget), none for a
 * reload that restores it. Checks the AI panel shows the prompt that was sent, axe at WCAG 2.1 AA
 * on Overview and Budget, no horizontal page scroll, and a clean console.
 * Never does: reach a real model.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  AI_DONE,
  axeViolations,
  CSP,
  noSidewaysScroll,
  openSampleForm,
  prepare,
  SAMPLE_NAME,
} from './helpers.js';

/** The Allocated cell of the Food & beverage row. */
const foodLine = (page: Page) =>
  page
    .getByRole('row', { name: /^Food & beverage/u })
    .getByRole('cell')
    .first();

test('the community sample becomes a plan with one AI call, and edits and reloads cost none', async ({
  page,
}) => {
  expect(CSP).toBeTruthy();
  const { requests, errors } = await prepare(page);
  await openSampleForm(page);
  await page.getByRole('button', { name: 'Generate my plan' }).click();

  const heading = page.getByRole('heading', { level: 1 });
  await expect(heading).toHaveText(SAMPLE_NAME);
  await expect(heading).toBeFocused();
  await expect(page.getByText(AI_DONE)).toBeVisible();
  expect(requests).toEqual([{ brief: expect.objectContaining({ name: SAMPLE_NAME }) }]);

  // Overview: the AI panel shows the prompt that was sent, and the counter says 1.
  const prompt = page.getByRole('region', { name: 'What we sent to Gemini' });
  await expect(prompt).toContainText('You are Gatherwise');
  await expect(prompt).toContainText(`"name": "${SAMPLE_NAME}"`);
  await expect(page.getByRole('region', { name: 'Engine adjustments' })).toContainText(
    "Cost of 'Fireworks finale' clamped",
  );
  await expect(page.locator('.ai-panel__calls dd')).toHaveText('1');
  expect(await axeViolations(page)).toEqual([]);
  expect(await noSidewaysScroll(page)).toBe(true);

  // Budget: guests 250 → 400 rescales the per-guest lines locally.
  await page.getByRole('tab', { name: 'Budget' }).click();
  const before = await foodLine(page).textContent();
  await page.getByRole('spinbutton', { name: 'Guests attending' }).fill('400');
  await expect(page.getByText(/^Budget updated for 400 guests/u)).toContainText(
    'No AI call used (AI calls this session: 1).',
  );
  await expect(foodLine(page)).not.toHaveText(before ?? '');
  await expect(page.getByText(/Over budget by ₹/u)).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
  expect(await noSidewaysScroll(page)).toBe(true);
  expect(requests).toHaveLength(1);

  // A reload restores the plan from this browser without asking the AI again.
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(SAMPLE_NAME);
  await expect(page.getByText('Restored with your saved plan — no new AI call.')).toBeVisible();
  await page.getByRole('tab', { name: 'Budget' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Guests attending' })).toHaveValue('400');
  expect(requests).toHaveLength(1);
  expect(errors).toEqual([]);
});
