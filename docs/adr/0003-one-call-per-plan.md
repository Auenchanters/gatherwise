# ADR 0003: One call per plan, and the model-call budget

- **Status:** Accepted
- **Date:** 2026-10-21

## Context

Planning is iterative: an organizer changes the guest count, the budget and the date many times and ticks tasks off as they go. If any of that reached the model, cost and latency would grow with every click, a small API quota would run out, and the plan would shift under the user. React's StrictMode runs effects twice in development, so a call started from an effect could quietly double. The app should also be able to show, not just claim, how many calls it made.

## Decision

- **One structured call creates a plan.** Edits never call the model: guests, budget, date, task ticks, vendor statuses and checklist ticks go through the pure reducer (`src/domain/reducer.ts`), which rebuilds the plan locally and leaves the AI answer untouched.
- **Calls start in one place.** Only the planner store's `submit`, `personalize` and `adjust` commands call the client (`src/features/plan/planner-store.ts`), and the UI invokes them from event handlers, never from effects. Each call is tagged with the plan's generation, so a late answer for an older brief is dropped.
- **Repeats are free.** The client (`src/features/client/api-client.ts`) remembers the last 8 successful answers, keyed by the SHA-256 of the brief's canonical JSON. **Adjust with AI** skips that lookup, asks once with the organizer's change and the current answer, and stores the new answer. Failures and aborts are never cached.
- **No automatic retries anywhere.** The client never retries, the server makes one model call per request and never repairs an answer (`server/handler.ts`, `server/answer.ts`), and the SDK is created with `retryOptions: { attempts: 1 }` (`server/provider.ts`).
- **A small, bounded call.** The default model is `gemini-3.5-flash-lite` with `thinkingLevel: MINIMAL`, `maxOutputTokens: 4096` (room for the largest answer the schema allows; a typical one uses about 1,000), a 25-second SDK timeout (Gemini can be slow under load) and the request's abort signal passed through. The browser gives up after 28 seconds, inside the function's 30-second limit.
- **Server-side ceilings.** Shared across instances through an Upstash store: 10 plan requests a minute per client and a daily budget of model calls (300 by default, `AI_DAILY_LIMIT`), with an in-memory fallback that never fails a request (`server/rate-limit.ts`). Per instance: 3 model calls in flight (`server/capacity.ts`).
- **The count is visible.** "AI calls this session" is the client's count of real requests, shown on the Overview tab, in the AI panel and in the Budget tab's update message.

## Consequences

### Positive

- Cost and latency are predictable: 1 call to create a plan and 1 per **Adjust with AI**, whatever the user edits.
- Edits are instant and work offline once the plan has loaded.
- The budget is enforced by tests that count real requests: `tests/unit/api-client.test.ts` counts `fetch` calls, and `tests/e2e/tabs.spec.ts` and `tests/e2e/planner.spec.ts` count requests in a real browser.

### Negative

- After an edit, the ideas keep their earlier personalization; their budget-fit badges recompute, but new ideas need an explicit **Adjust with AI** (1 call).
- An adjustment replaces the whole AI layer (summary, ideas, extra tasks and vendor questions). The model is asked to keep what the change does not affect, but nothing forces it to; a ticked AI task stays ticked only when the new answer has a task with the same title.
- A transient failure is not recovered automatically; the user presses "Try again" or **Adjust with AI**.
- The cache lives in memory in one tab. A reload seeds it only with the saved plan's answer (a restored plan costs 0 calls, and so does submitting its brief again); other answers from before the reload are gone.
- The daily budget is global: once it is spent, every plan gets standard ideas until UTC midnight, and a caller with many addresses can spend it early (see `docs/KNOWN-LIMITATIONS.md`).

## Alternatives considered

1. **Re-personalize after every edit.** Rejected: the cost, latency and quota grow with every click, and the plan would change under the user while they edit it.
2. **Several smaller calls (ideas, tasks and questions separately) or an agent loop.** Rejected: more calls for little gain; one structured answer carries all of it.
3. **Automatic retry with backoff.** Rejected: hidden extra calls make the budget untrue and drain a quota faster when the provider is already struggling, while the deterministic plan is already usable (ADR 0006).

## Related

- `src/features/plan/planner-store.ts`
- `src/features/client/api-client.ts`
- `src/domain/reducer.ts`
- `server/provider.ts`
- `server/rate-limit.ts`
- `server/capacity.ts`
- `tests/e2e/tabs.spec.ts`
