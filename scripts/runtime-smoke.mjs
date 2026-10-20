/**
 * Post-build smoke test: imports the emitted API modules in plain Node ESM, where an extensionless
 * relative import compiles fine but crashes at runtime, as it would on Vercel.
 * Does: check health, the 405 method gate and one full trip through the request gate and the
 * engine to the "not configured" answer. Never does: call the model.
 */
import assert from 'node:assert/strict';

// The modules are imported after these lines, and Vercel exposes project env vars to the build:
// without the key the handler stays unconfigured (no model call), and without APP_ORIGIN the
// smoke runs the same whatever origin the project is configured for.
delete process.env.GEMINI_API_KEY;
delete process.env.APP_ORIGIN;
const { default: health } = await import('../artifacts/runtime/api/health.js');
const { default: plan } = await import('../artifacts/runtime/api/plan.js');
const base = 'https://gatherwise.example';

const ready = await health.fetch(new Request(`${base}/api/health`));
assert.equal(ready.status, 200);
assert.deepEqual(await ready.json(), { status: 'ok', ai: 'not_configured' });

const wrongMethod = await plan.fetch(new Request(`${base}/api/plan`));
assert.equal(wrongMethod.status, 405);
assert.equal(wrongMethod.headers.get('allow'), 'POST');

const date = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
const brief = {
  kind: 'community',
  subtype: 'festival',
  name: 'Runtime smoke mela',
  date,
  startTime: '16:00',
  durationHours: 4,
  city: '',
  venue: 'outdoor_public',
  guests: 120,
  budget: 50000,
  currency: 'INR',
  dietary: [],
  accessibility: [],
  amplifiedSound: true,
  servesFood: true,
  servesAlcohol: false,
  volunteersAvailable: 10,
  vibe: '',
  notes: '',
};
const unconfigured = await plan.fetch(
  new Request(`${base}/api/plan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ brief }),
  }),
);
assert.equal(unconfigured.status, 503);
assert.equal((await unconfigured.json()).error.code, 'AI_NOT_CONFIGURED');

process.stdout.write(
  'PASS runtime smoke: emitted API modules load in Node ESM (health, 405, gate to 503)\n',
);
