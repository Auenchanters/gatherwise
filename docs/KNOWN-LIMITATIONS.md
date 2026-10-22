# Known limitations

What Gatherwise does not do yet, or does only partly, and what would lift each limit.

## Rate limits are per instance and in memory

`server/rate-limit.ts` allows 10 plan requests a minute per client and 60 a minute per instance, and `server/capacity.ts` allows 3 model calls in flight. Each warm serverless instance keeps its own counters in memory, so the real ceiling grows with the number of instances and resets when an instance is recycled. Clients are told apart by a SHA-256 of the first `x-vercel-forwarded-for` address; requests without that header (local development) share one bucket.

**What would lift it:** a shared store for the counters (a key-value service with atomic increments), or rate limiting at the platform edge.

## One device, no sync, no accounts

A plan lives in the `localStorage` of the browser that made it (ADR 0004). There is no sync between devices, no sharing, no collaboration and no account to recover it from. Clearing site data, or "Clear my data", deletes it. Stored plans have one format version (`gatherwise.plan.v1`) and no migration: a value in another version is dropped with a notice. A plan over 200,000 characters is not saved.

**What would lift it:** an export and import file for moving a plan by hand; accounts with a server store for sync and collaboration; versioned migrations in `src/features/plan/persist.ts`.

## The Gemini free tier has a small quota

On a free-tier API key the number of requests per minute and per day is small. When the quota runs out, the provider answers 429, the API returns `AI_BUSY` (503, `Retry-After: 60`), and the plan keeps working with standard ideas and a notice that says when to try again.

**What would lift it:** a paid Gemini tier with a higher quota.

## AI output is not deterministic

The same brief can produce different ideas, tasks and wording on different calls; the model runs with a temperature of 0.7 (`server/provider.ts`). The engine bounds what that can change: ids come from per-template enums, numbers are clamped or dropped with a listed adjustment, strings are sanitized and capped, the total budget never moves, and all AI text is labelled. Within one tab, an identical brief reuses the cached answer.

**What would lift it:** a lower temperature for more repeatable wording. The bounds above are what make the variation safe; they do not remove it.

## Vendor categories are templates, not a marketplace

Vendors are standard types per event kind (caterer, tent, sound and lighting, photographer and so on), chosen by template rules from the brief. There are no real vendors, prices, availability, bookings or payments; "Booked" is a status the organizer sets.

**What would lift it:** an integration with a vendor directory or booking service for the user's city.

## Calendar export uses all-day, floating dates

`src/domain/ics.ts` writes all-day events (`DTSTART;VALUE=DATE`) with no time zone: the event on its date, with the start time and duration only in the description, and each unfinished task on its "start by" day, marked free (`TRANSP:TRANSPARENT`) so it does not block the day. There are no reminders (`VALARM`), done tasks are left out, and the file is a snapshot: after edits it has to be downloaded again.

**What would lift it:** a timed event with the browser's time zone (`TZID`), reminders, and a subscribable calendar feed that updates itself.

## Lead times are heuristics

Task lead times and vendor book-by days are typical planning heuristics, not local rules. Permit and licence tasks say "check with your local authority" and never claim legal or permit authority.

**What would lift it:** city-specific templates or a permits data source.

## Weddings are one ceremony and reception

The wedding template plans a single ceremony and reception (`src/domain/templates/wedding.ts`). Multi-day celebrations with several functions are not modelled.

**What would lift it:** sub-events within a plan, each with its own date, budget share and tasks.

## English interface

The interface copy is in English (`index.html` declares `lang="en"`). Text the user or the model writes is rendered with `dir="auto"`, so right-to-left text such as Arabic takes its own direction inside the English layout, but labels and messages are English only. Money is formatted with a fixed locale per currency, and the workspace formats dates and counts in `en-IN` whatever the browser's language.

**What would lift it:** a message catalog per language and locale-aware date formatting chosen by the user.

## The AI answer cache is per tab

The cache of the last 8 answers lives in memory in the planner's client (`src/features/client/api-client.ts`). Another tab, or a reload, starts with an empty cache. A restored plan does not need it, because restoring never calls the API, but submitting the same brief again after a reload (through **Edit details**) makes a new call.

**What would lift it:** keeping the cache in `sessionStorage`, validated on read like the saved plan.

## Text sanitizing trades a few characters for safety

`src/shared/sanitize-text.ts` removes Unicode tag characters to stop hidden instructions, which also turns the England, Scotland and Wales flag emoji into a plain black flag. Text is capped by code points, so a cut can split an emoji built from several code points.

**What would lift it:** an allowlist for the three subdivision flags, and `Intl.Segmenter` to cut by grapheme.

## The API accepts calls without a browser

A request with no `Origin` header (curl, a script) passes the origin check and is held only by the other limits: JSON only, 16 KB, the strict brief schema and the rate limits. Browsers always send `Origin` on a cross-site POST, so other websites cannot call the API from a visitor's browser.

**What would lift it:** a signed per-session token issued with the page, or bot protection at the platform edge.
