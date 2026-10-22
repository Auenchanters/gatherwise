# ADR 0001: The engine owns numbers, the AI owns ideas

- **Status:** Accepted
- **Date:** 2026-10-20

## Context

Gatherwise must produce budgets, timelines, vendor checklists and personalized ideas for community events, weddings and birthdays. Three of those four are about money, dates and requirements, where one wrong figure costs the organizer real money or a missed permit. A language model writes good ideas but is unreliable at sums, at working back from deadlines and at remembering every requirement a crowd of 300 brings. The organizer has to be able to trust the plan without checking it by hand.

## Decision

Split the work by what each side can be trusted with.

- A pure TypeScript engine in `src/domain/` computes every number and date. Money is integer minor units, split with a largest-remainder allocation so the lines always add up (`src/domain/money.ts`, `src/domain/budget.ts`). The timeline is a backward critical-path schedule with an honest status on each task (`src/domain/schedule.ts`). Vendors, book-by dates, volunteer shifts and break-even come from template rules and arithmetic (`src/domain/vendors.ts`, `src/domain/volunteers.ts`, `src/domain/break-even.ts`).
- Gemini supplies what an engine cannot: ideas tailored to the brief, a summary, weight hints that nudge a category up or down, extra tasks the template missed, and questions to ask each vendor. The system instruction tells it never to compute totals, sums, dates or deadlines, and the prompt never includes the total budget or the expected income (`src/shared/prompt.ts`).
- Every AI value reaches the plan only through `src/domain/merge.ts`, which clamps or drops numbers to the ranges in `src/shared/limits.ts`, drops ids the plan cannot use, caps strings, and records each change as an adjustment shown in the **AI at work** panel. Extra tasks may only follow template tasks, so they cannot create a dependency cycle.
- AI text is always labelled "AI · personalized" and template text "Standard suggestion".

## Consequences

### Positive

- The budget invariant `sum(lines) + contingency === total + (overBy ?? 0)` holds after every call, and the total the organizer set never changes because of the model.
- The engine is deterministic, so it is covered by property tests (fast-check) and runs identically in the browser and on the server.
- The plan exists before the AI answers and survives the AI failing (ADR 0006), and edits recompute locally with no model call (ADR 0003).

### Negative

- Each event kind needs a hand-written template (`src/domain/templates/`) with categories, tasks, lead times and vendor rules, and those templates have to be maintained.
- The model cannot add a budget category or a vendor type the template lacks; its only lever on money is a bounded weight hint.
- Lead times are typical heuristics rather than local rules, so permit tasks point the organizer to the local authority.

## Alternatives considered

1. **Let Gemini generate the whole plan.** Rejected: its totals and deadlines cannot be guaranteed, one wrong sum breaks trust in everything else, and every edit would need another call.
2. **Ask Gemini for the numbers, then validate and re-ask until they add up.** Rejected: it multiplies calls, cost and latency and still cannot promise a correct answer.
3. **Templates only, no AI.** Rejected: the problem asks for personalized ideas, and fixed suggestions cannot respond to a brief's vibe, dietary needs or venue.

## Related

- `src/domain/plan.ts`
- `src/domain/merge.ts`
- `src/domain/budget.ts`
- `src/domain/schedule.ts`
- `src/shared/prompt.ts`
- `tests/unit/merge.test.ts`
- `tests/unit/architecture.test.ts`
