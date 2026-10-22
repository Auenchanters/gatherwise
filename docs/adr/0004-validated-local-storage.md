# ADR 0004: Validated `localStorage` with no backend database

- **Status:** Accepted
- **Date:** 2026-10-21

## Context

A plan should survive a reload, but accounts, collaboration and a server database are out of scope: they would add authentication, personal data on a server and running cost to a tool used by one organizer at a time. Browser storage is the obvious place, and it is also untrusted: the user, an extension or an old version of the app can leave anything there, including broken JSON, a huge string, a script tag in a field or numbers the engine would never produce.

## Decision

- Save after every change, under one versioned key (`gatherwise.plan.v1`), only the plan's **inputs**: the brief, the planned guest count, the generation, the user's ticks and vendor statuses, and the validated AI answer with its metadata (`src/features/plan/persist.ts`). The derived plan is never stored.
- On load, treat the value as untrusted: reject anything over 200,000 characters, unparsable JSON, another version, or an envelope that fails the strict schema (the brief through `eventBriefSchema`, id lists and vendor statuses bounded in count and length).
- Check the AI part on its own against the brief's template schema. If it fails, restore the plan without it rather than throwing the plan away.
- Rebuild the plan through `restorePlanState` in `src/domain/reducer.ts`, so a stored AI answer passes the same merge (`src/domain/merge.ts`) as a fresh one: its numbers are clamped and its changes listed again.
- Report what happened in one line. A corrupt or other-version value is removed with "We couldn't read your saved plan, so we started fresh."; a plan whose date has passed is removed with "Your saved event date has passed — start a new plan."; storage that refuses writes gets one notice. "Clear my data" removes the saved plan and says so.

## Consequences

### Positive

- No personal data is kept on a server, and there is nothing to authenticate.
- Tampered storage cannot inject numbers or markup: values are re-validated, re-derived by the engine and rendered as text.
- Restoring a plan never calls the model (ADR 0003).

### Negative

- A plan lives on one device and one browser; there is no sync, sharing or collaboration.
- Clearing site data loses the plan.
- There is no migration between storage versions yet: a value with another version is dropped.
- Saved plans are capped at 200,000 characters; a plan that would exceed it is not saved and the older copy stays.

## Alternatives considered

1. **A server database with accounts.** Rejected: out of scope for v1, and it adds authentication, personal data handling and cost.
2. **Store the derived plan and trust it on load.** Rejected: tampered totals or dates would bypass the engine, and a stored plan would drift from the code that built it.
3. **IndexedDB.** Rejected: a heavier API with no benefit for a single value of this size.
4. **Encode the plan in the URL.** Rejected: very long URLs, and the notes would end up in browser history and server logs.

## Related

- `src/features/plan/persist.ts`
- `src/features/plan/storage-key.ts`
- `src/features/plan/planner-store.ts`
- `src/domain/reducer.ts`
- `tests/unit/persist.test.ts`
- `tests/e2e/edge-cases.spec.ts`
