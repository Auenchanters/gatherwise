/**
 * Smoke test against a real deployment: `E2E_BASE_URL=https://… npm run test:live`, run daily
 * against production by .github/workflows/live.yml.
 * Does: run the checks in scripts/live-checks.ts (health, landing page, security headers and ONE
 * real plan request, the only model call) and print one PASS line, or each failure and exit 1.
 * Never does: run as part of `verify` or `test:e2e`, guess a URL (it exits if E2E_BASE_URL is
 * unset or not a URL), or print brief text, model text or any key. It sets `process.exitCode`
 * rather than calling `process.exit`, so what it wrote to stderr is flushed first.
 */
import { todayIso } from '../src/features/plan/today.js';
import { runLiveSmoke } from './live-checks.js';

const base = process.env.E2E_BASE_URL;
if (!base || !URL.canParse(base)) {
  process.stderr.write(
    'E2E_BASE_URL is not set, or is not a URL. Pass the deployment to check, for example:\n' +
      '  E2E_BASE_URL=https://gatherwise.vercel.app npm run test:live\n',
  );
  process.exitCode = 1;
} else {
  const { failures, summary } = await runLiveSmoke(base, fetch, todayIso());
  if (failures.length > 0 || summary === undefined) {
    process.stderr.write(`${failures.map((failure) => `FAIL ${failure}`).join('\n')}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`PASS live smoke: ${summary}\n`);
  }
}
