# Gatherwise: plans that add up

A GenAI planning assistant for community events, weddings and birthdays, with budgets, timelines, vendor checklists and personalized ideas.

AI proposes, the engine guarantees.

**Live demo:** https://gatherwise-zeta.vercel.app

## 60-second demo path

1. On the landing page, press **Try a sample community event**. The form fills in with "Green Park Diwali Mela": 250 guests, a ₹1,50,000 budget, 75 days from today.
2. Press **Generate my plan**. The plan opens straight away from the engine, and Gemini personalizes it with **1 AI call**.
3. On the **Overview** tab, read the **AI at work** panel: **What we sent to Gemini** (the fixed system instruction and the JSON data block), **What came back (validated)**, **Engine adjustments**, and **AI calls this session**, which reads 1.
4. Open **Budget** and change **Guests attending** from 250 to 400. The lines marked "Yes" under **Scales with guests** grow, the contingency is spent first and an "Over budget by ₹…" callout shows the rest. The status line ends "No AI call used (AI calls this session: 1)."
5. Open **Timeline** and press **Download calendar (.ics)**.
6. Open **Vendors** and set a vendor's **Status** to Quoted or Booked.
7. Open **Ideas**, type "more for kids" under **What should change? (optional)** and press **Adjust with AI (1 call)**. Gemini revises its answer with that change, a ticked AI task stays ticked if the new answer keeps it, and the call counter goes to 2.
8. Open **Volunteers** to see how many volunteers each shift needs and whether the event is short.

## Chosen Vertical

Celebration & Event Planner. Gatherwise is built for the volunteer organizer of a **community event** first: a residents' festival, a fundraiser, a clean-up drive, a sports day or a cultural night. Weddings and birthdays run on the same engine with their own templates, so all three event kinds in the problem statement get the same four deliverables.

Community events have needs the other two mostly lack, and the community template covers them: money comes in as well as going out (break-even), public-space and sound permissions have lead times (permit tasks that point to the local authority), volunteers replace staff (shift planning), and safety scales with the crowd (security, first aid and sanitation vendors by guest count).

## Approach and Logic

The work is split by what each side can be trusted with.

- **The deterministic engine owns every number** (`src/domain/`). It splits the budget in integer minor units (paise, cents) so the lines always add up to the total, schedules tasks backward from the event date with an honest status on each one, decides which vendors the event needs and when to book them, plans volunteer shifts and works out break-even. It is pure TypeScript that never reads the clock, calls the network or touches storage: `today` is always a parameter, and `tests/unit/architecture.test.ts` keeps its imports inside the engine and bans `Date.now`, `Math.random`, `fetch(` and `localStorage` from it.
- **Gemini owns ideas and personalization**, through one structured call per plan (`src/shared/prompt.ts`, `server/provider.ts`). It returns ideas priced per budget category, extra tasks, a summary and questions to ask vendors. It has no lever on the budget: each idea is checked against the same category amounts the prompt showed it and the **Budget** tab shows. The response schema is built per template, so it can only use category, task and vendor ids that exist.
- **Everything Gemini returns passes one chokepoint** (`src/domain/merge.ts`) before it touches the plan: strings are capped, numbers are clamped or dropped, unusable ids are dropped, and every change is listed in the "Engine adjustments" panel. The total budget never changes.

Why the split matters for this problem: a language model is good at suggesting a lantern-lit evening with a vegetarian and Jain menu for 250 neighbours, and bad at sums, deadlines and requirements. An organizer has to be able to trust that the budget adds up and that a deadline marked as met really can be met. So the parts that must be right are computed, the parts that should feel personal are generated, and AI text is always labelled "AI · personalized" while template text is labelled "Standard suggestion".

## How the Solution Works

1. **Brief.** The organizer fills in one form (`src/features/brief/`): event kind and subtype, date and time, venue, guests, budget and currency, dietary and access needs, sound, food and alcohol, notes, the language Gemini should write in (English, Hindi, Tamil, Telugu, Bengali, Marathi, Spanish or French), and for community events the volunteers available and expected income. On submit the brief is checked against the strict zod schema (`src/shared/schema.ts`), loaded on demand, and the date is checked against today.
2. **Engine plan, no AI.** `buildPlan` (`src/domain/plan.ts`) builds the whole plan in the browser at once: the budget (10% contingency first, then the template's categories), the timeline, the vendors with book-by dates, volunteer shifts, break-even and standard ideas. The workspace opens on this plan before any AI answer arrives.
3. **One Gemini call.** The browser sends `{ brief }` to `POST /api/plan` (or `{ brief, adjust: { change, previous } }` for **Adjust with AI**, below). The handler (`server/handler.ts`) checks the method, content type, origin, size, rate limit, JSON, schema and date, rebuilds the same engine plan, and builds the prompt with the same builder the browser uses (`src/shared/prompt.ts`): a fixed system instruction, the brief as JSON data in a separate message, and the plan's allocations and ids. Gemini answers in schema-constrained JSON, which the server parses, validates against the template's schema and sanitizes (`server/answer.ts`, `src/shared/sanitize-suggestions.ts`).
4. **Normalization.** The browser validates the answer again (`src/features/client/api-client.ts`) and merges it through `src/domain/merge.ts`, which clamps, drops and truncates what it must and records each change. The merged plan carries the AI ideas, summary, extra tasks and vendor questions, each labelled.
5. **Edits cost nothing.** Changing guests, budget or date, ticking a task, setting a vendor's status or ticking a checklist item runs the pure reducer (`src/domain/reducer.ts`), which rebuilds the plan locally. No edit reaches the API.
6. **Local persistence.** The plan's inputs and the validated AI answer are saved in this browser's `localStorage` (`src/features/plan/persist.ts`). On the next visit they are parsed strictly and merged again through the same chokepoint; the derived plan itself is never stored.

## Assumptions Made

- **One planner, one device.** There are no accounts and no server database; a plan lives in the browser where it was made.
- **Plan language** changes only the text Gemini writes (summary, ideas, extra tasks and vendor questions). The interface, the template's own task and vendor names and the standard suggestions stay in English. A brief without a language, such as one saved before the setting existed, is English.
- **Currencies** are the eight in `src/shared/options.ts`: INR, USD, EUR, GBP, AED, SGD, AUD and CAD. Budgets are whole units of one currency; there is no conversion.
- **Dates are the organizer's local calendar dates.** "Today" is read from the browser's local date (`src/features/plan/today.ts`); the server accepts a date up to one day either side of its UTC day to allow for time zones.
- **Vendor categories are standard templates** per event kind, not a marketplace. Vendors appear when the brief calls for them (for example, a generator for an outdoor event that ends after 18:00).
- **Amounts are planning estimates, not quotes.** Allocations are shares of the organizer's own budget, and idea costs are Gemini's estimates checked against those shares.
- **Lead times are typical planning heuristics.** Permit processing varies by city, so permit and licence tasks say "check with your local authority"; Gatherwise never claims legal or permit authority.
- **Guest counts drive per-guest costs.** Lines such as food and rentals scale with guests; venue and décor lines stay fixed.

## Requirements coverage

Every deliverable exists for every event kind. Each cell says what the plan contains and where it is on the live site.

| Deliverable            | Community event                                                                                                                                                                                                                             | Wedding                                                                                                                                                                   | Birthday                                                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Budgets**            | **Budget** tab: 10% contingency, then 10 categories from Venue & permits to Activities & entertainment; per-guest lines rescale when guests change                                                                                          | **Budget** tab: 8 categories such as Venue, Catering, Décor & flowers and Photo & video                                                                                   | **Budget** tab: 8 categories such as Venue, Food & beverage, Cake & dessert and Entertainment                                                                     |
| **Timelines**          | **Timeline** tab: worked back from the event date, with public-space, sound and alcohol permissions when the brief needs them; ICS download and print                                                                                       | **Timeline** tab: photographer, décor, invitations, final headcount and run sheet, plus venue, caterer and menu tasting when the brief needs them; ICS download and print | **Timeline** tab: theme and guests, invitations, entertainment, RSVPs, cake and set-up, plus a dietary check when there are dietary needs; ICS download and print |
| **Vendor checklists**  | **Vendors** tab: tent, sound and lighting, caterer or food stalls, toilets, security, first aid, waste and generator, chosen by venue, crowd and menu, plus printing & signage in every plan; each with why, a book-by date and a checklist | **Vendors** tab: photographer and videographer, decorator and florist, plus caterer, DJ, bar and marquee when the brief needs them                                        | **Vendors** tab: cake and decor, plus caterer, kids' entertainer, DJ, bar and photographer when the brief needs them                                              |
| **Personalized ideas** | **Ideas** tab: Gemini's ideas with a budget-fit badge and "Why:"; AI summary on **Overview**, AI tasks on **Timeline**, vendor questions on **Vendors**                                                                                     | As for community events: **Ideas**, the AI summary on **Overview**, AI tasks on **Timeline**, vendor questions on **Vendors**                                             | As for community events: **Ideas**, the AI summary on **Overview**, AI tasks on **Timeline**, vendor questions on **Vendors**                                     |

Community-only extras: the **Volunteers** tab (3-hour shifts, volunteers needed per shift, shortfall or spare) and **break-even** (an income ledger on **Budget** and a Break-even tile on **Overview**, from tickets, sponsors, donations and stall fees).

## Model-call budget

The "AI calls this session" counter on **Overview** is the browser client's count of real requests to `/api/plan`.

| Action                                                                                | AI calls            | Why                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create a plan (**Generate my plan**)                                                  | 1                   | The plan's one structured call for ideas and personalization.                                                                                                                                                               |
| Any edit: guests, budget, date, a task, a vendor's status, a checklist item           | 0                   | Edits go through the pure reducer, which rebuilds the plan locally and leaves the AI answer untouched.                                                                                                                      |
| **Adjust with AI (1 call)** on the **Ideas** tab                                      | 1                   | Sends the organizer's optional change (up to 200 characters; blank asks for fresh ideas) and the current AI answer as data. It skips the cache and asks once; the new answer replaces the whole AI layer.                   |
| **Personalize with AI (1 call)** on a restored plan, or **Try again** after a failure | 1                   | Only on a click; 0 when this tab already has an answer for the exact same brief.                                                                                                                                            |
| Reload, or restore a saved plan                                                       | 0                   | The saved AI answer is restored from this browser and merged again; restoring never calls the API. It also goes into the client's cache under the restored brief.                                                           |
| The same brief again, in this tab or after a reload                                   | 0                   | The client keeps the last 8 answers in an LRU cache keyed by the SHA-256 of the brief's canonical JSON, seeded on reload with the saved plan's answer.                                                                      |
| AI failure                                                                            | 0 automatic retries | The app never re-calls on its own: the client has no retry, the server makes one model call per request, and the Gemini SDK is set to `attempts: 1` (no SDK retry). The plan stays usable with standard ideas and a notice. |

`tests/e2e/tabs.spec.ts` and `tests/e2e/planner.spec.ts` count the requests in a real browser: 1 to generate, still 1 after edits and a reload, 2 after **Adjust with AI**.

## Evaluation map

| Area                        | Where to look                                                                                                                                          | What to look at                                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code Quality                | `src/domain/`, `tests/unit/architecture.test.ts`, `src/shared/schema.ts`, `server/errors.ts`, `docs/adr/`                                              | A pure engine behind a tested import boundary, one zod contract per shape, one API error catalog, and the decisions behind them.                                 |
| Problem Statement Alignment | `src/domain/templates/`, `src/domain/plan.ts`, `src/features/plan/`, `src/shared/prompt.ts`                                                            | Four deliverables for three event kinds, with Gemini personalizing a plan the engine computes.                                                                   |
| Security                    | `server/request.ts`, `server/rate-limit.ts`, `src/shared/sanitize-text.ts`, `src/domain/ics.ts`, `vercel.json`                                         | Request gate, shared per-client quotas and a daily AI budget, text sanitizing in both directions, RFC 5545 escaping, and the CSP and headers. See `SECURITY.md`. |
| Efficiency                  | `src/features/client/api-client.ts`, `src/features/plan/planner-store.ts`, `server/provider.ts`, `scripts/bundle-budget.mjs`, `tests/e2e/tabs.spec.ts` | One call per plan, the LRU cache, a flash-lite model with minimal thinking and capped output, lazy chunks and the first-page budget.                             |
| Testing                     | `vitest.config.ts`, `tests/unit/`, `tests/ui/`, `tests/e2e/`, `docs/TESTING.md`                                                                        | Property tests, the handler matrix, injection corpora, golden ICS, purity and tampered-storage tests, RTL and Playwright with axe.                               |
| Accessibility               | `src/features/plan/tabs.tsx`, `src/features/brief/error-summary.tsx`, `src/styles/base.css`, `tests/e2e/keyboard.spec.ts`, `tests/e2e/helpers.ts`      | WAI-ARIA tabs, the GOV.UK error summary, visible focus and reduced motion, a keyboard-only journey, and axe at WCAG 2.1 A and AA.                                |

## Tech stack

- **Client:** React 19 and TypeScript, built with Vite 8 into a static single-page app. No chart, date, icon or font libraries: native `<meter>`, `Intl` and the system font stack.
- **API:** two Vercel Functions in `api/` that hand Web-standard `Request` objects to one Fetch handler in `server/handler.ts`.
- **AI:** Google Gemini (`gemini-3.5-flash-lite` by default) through the official `@google/genai` SDK, server-side only.
- **Contracts:** zod 4 schemas in `src/shared/schema.ts`, shared by the browser and the server.
- **Runtime dependencies:** exactly four: `react`, `react-dom`, `zod` and `@google/genai`. Everything else is a dev dependency.
- **Quality:** ESLint (strict type-checked, jsx-a11y strict), knip, Prettier, Vitest with fast-check and Testing Library, Playwright with axe-core, CodeQL and Gitleaks in CI.

## Run locally

Node 24 is required (`package.json` engines).

```sh
npm ci
cp .env.example .env.local   # then set GEMINI_API_KEY in .env.local
npm run dev                  # Vite, with /api proxied to the local API on 127.0.0.1:3001
```

Without a key the app still works: the plan is built by the engine, and the AI request answers "not configured" with standard ideas shown instead.

## Scripts

| Script                                    | What it does                                                                                                            |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                             | Vite and the local API server (`scripts/dev-server.ts`) together.                                                       |
| `npm run build`                           | Type-check, build the client, check the first-page budget, compile the API and run the runtime smoke test.              |
| `npm run preview`                         | Serve the production build locally.                                                                                     |
| `npm run lint`                            | ESLint with zero warnings allowed.                                                                                      |
| `npm run typecheck`                       | `tsc -b`: the app, node and test projects.                                                                              |
| `npm run format` / `npm run format:check` | Prettier write / check.                                                                                                 |
| `npm run knip`                            | Unused files, exports and dependencies.                                                                                 |
| `npm test`                                | Unit and component tests (Vitest).                                                                                      |
| `npm run test:coverage`                   | The same with coverage thresholds.                                                                                      |
| `npm run test:e2e`                        | Playwright journeys against the production build, desktop and mobile.                                                   |
| `npm run test:bundle`                     | The first-page JS budget on an existing build.                                                                          |
| `npm run test:runtime`                    | The emitted API modules in plain Node ESM.                                                                              |
| `npm run test:live`                       | Opt-in smoke test of a deployment: `E2E_BASE_URL=https://… npm run test:live`.                                          |
| `npm run preflight`                       | Pre-publish checks on the git index: size, credentials, branches and these docs.                                        |
| `npm run verify`                          | lint, typecheck, test:coverage, knip, build and format:check in one go. CI runs it, then the E2E tests and `npm audit`. |

## Deploy

Gatherwise deploys to Vercel as configured in `vercel.json`: the Vite framework preset, `npm run build`, the `dist` output, a 30-second limit with request cancellation for `api/*.ts`, and the security and caching headers.

Set these environment variables in the Vercel project:

- `GEMINI_API_KEY` (required for AI): the Google AI Studio key. It is read only by the server; never give it a `VITE_` prefix.
- `GEMINI_MODEL` (optional): defaults to `gemini-3.5-flash-lite`.
- `APP_ORIGIN` (optional): an extra origin allowed to call the API, as an exact origin such as `https://example.com` with no trailing slash. A deployment's own origin is always allowed, so most deployments leave it unset.
- `KV_REST_API_URL` and `KV_REST_API_TOKEN` (recommended): the Upstash Redis store the Vercel Marketplace integration adds, which makes the rate limits and the daily budget shared by every instance. `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` work too. Without them the limits count in each instance's memory.
- `AI_DAILY_LIMIT` (optional): model calls allowed per UTC day across the deployment; defaults to 300.

The production deployment must be publicly readable; `npm run test:live` fails if the landing page ends on a Vercel login page.

## Docs

- [Architecture](docs/ARCHITECTURE.md)
- [Testing](docs/TESTING.md)
- [Known limitations](docs/KNOWN-LIMITATIONS.md)
- Architecture decision records:
  - [0001 Engine owns numbers, AI owns ideas](docs/adr/0001-engine-owns-numbers-ai-owns-ideas.md)
  - [0002 Per-template enum schema](docs/adr/0002-per-template-enum-schema.md)
  - [0003 One call per plan](docs/adr/0003-one-call-per-plan.md)
  - [0004 Validated local storage](docs/adr/0004-validated-local-storage.md)
  - [0005 Vite SPA and Vercel Functions](docs/adr/0005-vite-spa-and-vercel-functions.md)
  - [0006 Per-section degradation](docs/adr/0006-per-section-degradation.md)
- [Security policy](SECURITY.md)

## License

[MIT](LICENSE)
