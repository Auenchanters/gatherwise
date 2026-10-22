# ADR 0005: A Vite single-page app with Vercel Fetch functions

- **Status:** Accepted
- **Date:** 2026-10-20

## Context

The planner is one interactive page whose engine runs entirely in the browser. The only server-side need is to hold the Gemini key and make one call per plan. The deployment should be one artifact with security headers, the first page should stay light, and the API code should be testable offline without a framework's request objects.

## Decision

- **Client:** React 19 built by Vite into static files in `dist/`. The first page loads only the entry chunk; validation, zod and the planner load on demand (see the bundle split in `docs/ARCHITECTURE.md`). `scripts/bundle-budget.mjs` fails the build if the entry exceeds 250 kB raw or 80 kB gzip.
- **API:** two Vercel Functions, `api/plan.ts` and `api/health.ts`, each exporting `{ fetch: handlerFromEnv(process.env) }`. They hand Web-standard `Request` objects to one handler built by `createHandler` in `server/handler.ts`, whose dependencies (the model call, the clock, the rate limiter, the allowed origin) are injectable for tests; `handlerFromEnv` reads the environment once per warm instance and passes it in, so tests never stub the environment.
- **Local development** runs the same handler on `@hono/node-server` (`scripts/dev-server.ts`) behind Vite's `/api` proxy, which keeps the browser's `Host` so the same-origin check behaves as in production (`vite.config.ts`).
- **ESM that runs as emitted:** every relative import in `src/domain`, `src/shared`, `server` and `api` has an explicit `.js` extension. `npm run build` compiles the API with `tsconfig.server.json` and `scripts/runtime-smoke.mjs` imports the emitted modules in plain Node, so a specifier that only works under a bundler fails the build.
- **Platform settings in `vercel.json`:** the security headers and CSP for every response, `no-store` on `/api/*`, immutable caching for hashed assets in `/assets/`, and a 30-second limit with request cancellation for `api/*.ts`.

## Consequences

### Positive

- One deploy serves the static app and the API, with no server to run.
- The key stays on the server, and the client bundle has no AI SDK.
- The handler is tested end to end offline (`tests/unit/handler.test.ts`) and again in plain Node after every build.
- A client abort reaches the model call through `request.signal`.

### Negative

- Serverless instances share nothing, so the rate limits and the concurrency cap are per instance and in memory (`docs/KNOWN-LIMITATIONS.md`).
- The app needs JavaScript; without it, `index.html` shows a `<noscript>` summary of the features and nothing else.
- Headers and function limits live in Vercel's configuration format, so another host would need its own equivalent.

## Alternatives considered

1. **A full-stack framework with server rendering.** Rejected: the page is an interactive tool with no content to render on the server, and a framework runtime would add weight to the first page.
2. **A long-running Node server or container.** Rejected: one more process to run and secure for a single endpoint, where functions and static hosting deploy together.
3. **Calling Gemini directly from the browser.** Rejected: it would expose the API key and remove the server-side gate (origin, size, rate limit, schema).

## Related

- `vite.config.ts`
- `vercel.json`
- `api/plan.ts`
- `api/health.ts`
- `server/handler.ts`
- `scripts/dev-server.ts`
- `scripts/runtime-smoke.mjs`
- `scripts/bundle-budget.mjs`
- `tsconfig.server.json`
