# ADR 0002: A per-template enum JSON schema for Gemini

- **Status:** Accepted
- **Date:** 2026-10-20

## Context

Gemini's suggestions must point at things the engine knows: an idea is filed under a budget category, an extra task follows existing tasks, and questions belong to a vendor. The three templates (community, wedding, birthday) have different category, task and vendor ids. If the model could write any string as an id, the app would need fuzzy matching or would silently lose suggestions. Gemini can be given a JSON Schema that constrains its output.

## Decision

- Build the response schema per template: `aiSuggestionsSchema(templateIds(template))` in `src/shared/schema.ts` makes every `categoryId`, `after` entry and `vendorId` a `z.enum` of that template's ids (`src/domain/templates/index.ts`).
- Convert it with `z.toJSONSchema` and send it as `responseJsonSchema` with `responseMimeType: 'application/json'` (`src/shared/prompt.ts`, `server/provider.ts`). The copy Gemini is given also carries the string and number caps from `LIMITS.ai` as `maxLength`, `minimum` and `maximum` (`aiResponseJsonSchema`). List caps stay in the descriptions: with `maxItems` on three or more lists Gemini refused the whole request (400 `INVALID_ARGUMENT`, checked live). The server builds the three JSON schemas once, when the module loads, and `tests/unit/prompt.test.ts` pins that each uses only keywords Gemini accepts.
- Parse the answer with the same zod schema on the server (`server/answer.ts`), again in the browser (`src/features/client/api-client.ts`) and again when a saved plan is restored (`src/features/plan/persist.ts`). The server parses each section, and each item of a list, on its own: an item that fails is left out and counted in the log line (`dropped`), and the rest is returned in the strict shape the browser checks.
- Make the parse schema strict on shape and ids (strict objects, every key required) and lenient on quantities: the server then clamps numbers, cuts lists and caps strings to `LIMITS.ai` (`server/sanitize.ts`), and the engine enforces them again in `src/domain/merge.ts`, listing what it changes.

## Consequences

### Positive

- After parsing, an unknown id cannot exist: the model structurally cannot reference a category, task or vendor the template does not have.
- One absurd number (a cost of 10¹², a negative duration) is clamped and listed as an adjustment instead of discarding a paid answer.
- One bad item costs that item, not the paid answer. Only text that is not a JSON object, or an answer with nothing usable left, is a failure (`INVALID_RESPONSE`, 502), with no repair call.

### Negative

- The contract differs per event kind, so tests have to cover all three schemas.
- Renaming a template id changes the contract: a saved AI answer that uses the old id fails validation and the plan is restored without its AI part (ADR 0004).
- Because the parse is lenient on numbers, the merge must survive anything schema-shaped (NaN, ±Infinity, 1e300, long lists), and its property test exists for that reason.
- An id can be valid for the template but inactive for this brief (a permit task the brief does not need); the merge drops those with an adjustment.

## Alternatives considered

1. **One generic schema with free-string ids, filtered afterwards.** Rejected: the model would invent ids, and filtering would drop suggestions silently.
2. **Strict numeric ranges and length limits in the parse schema.** Rejected: one out-of-range value would reject the whole response, wasting the call; clamping and logging keeps the rest.
3. **Free text parsed with patterns.** Rejected: fragile, and impossible to validate as strictly as JSON.

## Related

- `src/shared/schema.ts`
- `src/shared/prompt.ts`
- `src/domain/templates/index.ts`
- `server/answer.ts`
- `src/domain/merge.ts`
- `tests/unit/schema.test.ts`
- `tests/unit/prompt.test.ts`
