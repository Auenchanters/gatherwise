# ADR 0006: Per-section degradation when the AI fails

- **Status:** Accepted
- **Date:** 2026-10-21

## Context

The model call can fail in several ways: no key configured, quota exhausted, a timeout, a network error, a rate limit, or an answer that does not fit the schema. An answer can also be partly unusable. A blank page or a spinner that never ends would leave the organizer with nothing, and a silent automatic retry would break the model-call budget (ADR 0003).

## Decision

- **The plan never waits for the AI.** The engine builds the budget, timeline, vendors, shifts and standard ideas before the request starts, and the workspace opens on that plan (`src/domain/plan.ts`).
- **A failure costs only the AI parts.** On failure the reducer marks the AI state `failed` and keeps the plan and any earlier AI answer (`src/domain/reducer.ts`). Without AI ideas, the Ideas tab shows the standard ideas for the event kind (`src/domain/templates/standard-ideas.ts`), priced as a share of their category so they always fit and labelled "Standard suggestion"; the Overview summary falls back to a sentence built from the engine's figures.
- **One honest notice.** The failure is told in one sentence from a single copy catalog (`src/features/client/messages.ts`), for example "AI ideas aren't available right now — the budget, timeline and vendors are fully usable." A rate limit names the wait from `Retry-After`. The server only ever returns catalogued codes and fixed messages (`server/errors.ts`), never a provider message.
- **No automatic retry.** The AI panel offers **Try again** and the Ideas tab **Refresh ideas (1 AI call)**; nothing calls again on its own.
- **Bad items, not bad answers.** Within an answer that parses, `src/domain/merge.ts` drops or clamps the unusable items and keeps the rest, listing each change. If no usable idea is left, the Ideas tab says so and shows the standard ideas.

## Consequences

### Positive

- The budget, timeline, vendors and volunteers always work, with or without Gemini, and the app still runs with no key at all.
- The user always knows whether they are looking at AI or standard text, and why.
- A provider outage cannot multiply calls.

### Negative

- Standard ideas are generic until the user tries again.
- Recovery takes a click.
- The engine summary is plainer than Gemini's.

## Alternatives considered

1. **Hold the plan until the AI answers.** Rejected: the organizer would wait on, or lose, the deterministic plan that does not need the AI at all.
2. **Retry automatically with backoff.** Rejected: hidden calls break the model-call budget and make quota exhaustion worse.
3. **Hide the Ideas section when the AI fails.** Rejected: ideas are one of the four deliverables, and the standard ideas are still useful and budget-checked.

## Related

- `src/domain/plan.ts`
- `src/domain/reducer.ts`
- `src/domain/templates/standard-ideas.ts`
- `src/domain/merge.ts`
- `src/features/client/messages.ts`
- `src/features/plan/ideas.tsx`
- `src/features/plan/notices.tsx`
- `tests/e2e/edge-cases.spec.ts`
