/**
 * Browser journeys for the plan workspace, against the production build on desktop and mobile,
 * under the production CSP, with `/api/plan` mocked by a fixed answer shaped exactly like the real
 * API (`{suggestions, meta}`).
 *
 * Does: generates the community sample and checks the model-call budget by counting requests: one
 * to create the plan, none for guests 250 → 400 (which still rescales the budget), none for a
 * reload that restores it, and none for submitting the same brief again after that reload (the
 * restored answer seeds the cache). Checks the AI panel shows the prompt that was sent, axe at
 * WCAG 2.1 AA on Overview and Budget, no horizontal page scroll, and a clean console. Also opens
 * the wedding sample, whose plan is calm, lists the bar vendor and has no Volunteers tab.
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
  WEDDING_SAMPLE,
} from './helpers.js';
import { aiMeta, aiSuggestions } from '../support/fixtures.js';

/** An answer for the wedding template: the fixed community answer names ids a wedding lacks. */
const WEDDING_ANSWER = {
  ...aiSuggestions,
  ideas: [
    {
      title: 'Marigold entrance arch',
      description: 'Frame the entrance with fresh marigold garlands.',
      categoryId: 'decor_flowers',
      estimatedCost: 20_000,
      personalization: 'vibe: marigold garlands',
    },
  ],
  extraTasks: [],
  vendorQuestions: [{ vendorId: 'bar_service', questions: ['Is a licensed bartender included?'] }],
};

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

  // Submitting the same brief again after the reload reuses the restored answer: still no call.
  await page.getByRole('button', { name: 'Edit details' }).click();
  await page.getByRole('button', { name: 'Generate my plan' }).click();
  await page.getByRole('tab', { name: 'Overview' }).click();
  await expect(
    page.getByText('Reused the answer for this exact brief — no new AI call.'),
  ).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('the wedding sample opens a calm wedding plan with a bar vendor and no Volunteers tab', async ({
  page,
}) => {
  const { requests, errors } = await prepare(page, {
    status: 200,
    body: { suggestions: WEDDING_ANSWER, meta: aiMeta },
  });
  await openSampleForm(page, WEDDING_SAMPLE);
  await page.getByRole('button', { name: 'Generate my plan' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(WEDDING_SAMPLE.name);
  await expect(page.getByText(AI_DONE)).toBeVisible();
  await expect(page.getByRole('tab')).toHaveText([
    'Overview',
    'Budget',
    'Timeline',
    'Vendors',
    'Ideas',
  ]);
  await expect(page.getByRole('region', { name: "Some deadlines can't be met" })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Vendors' }).click();
  await expect(page.getByRole('heading', { level: 3, name: 'Bar service' })).toBeVisible();
  await expect(page.getByText('Is a licensed bartender included?', { exact: true })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
  expect(await noSidewaysScroll(page)).toBe(true);
  expect(requests).toHaveLength(1);
  expect(errors).toEqual([]);
});
