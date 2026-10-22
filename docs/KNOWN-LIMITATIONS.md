# Known limitations

What Gatherwise does not do yet, or does only partly, and what would lift each limit.

## The daily budget is the only ceiling a determined caller meets

`server/rate-limit.ts` counts 10 plan requests a minute per client and a daily budget of model calls (300 by default, `AI_DAILY_LIMIT`) in a shared Upstash store, so the limits hold across instances. Clients are told apart by a SHA-256 of the first `x-vercel-forwarded-for` address, which Vercel's edge sets. A script that forges the `Origin` and spreads its requests over many addresses passes the per-client limit, so all it can do is spend the daily budget early: after that every plan gets standard ideas until UTC midnight, for everyone. When the store is not configured, fails or takes over a second, the counters fall back to each instance's memory, where they grow with the number of instances and reset when an instance is recycled; that is logged as `limiter_fallback`. `server/capacity.ts` still allows 3 model calls in flight per instance, and requests without a forwarded address (local development) share one bucket.

**What would lift it:** bot protection or a per-session token issued with the page, so the budget is spent by people; a per-client daily budget as well as the global one.

## One device, no sync, no accounts

A plan lives in the `localStorage` of the browser that made it (ADR 0004). There is no sync between devices, no sharing, no collaboration and no account to recover it from. Clearing site data, or "Clear my data", deletes it. Stored plans have one format version (`gatherwise.plan.v1`) and no migration: a value in another version is dropped with a notice. A plan over 200,000 characters is not saved.

**What would lift it:** an export and import file for moving a plan by hand; accounts with a server store for sync and collaboration; versioned migrations in `src/features/plan/persist.ts`.

## The Gemini free tier has a small quota

On a free-tier API key the number of requests per minute and per day is small. When the quota runs out, the provider answers 429, the API returns `AI_BUSY` (503, `Retry-After: 60`), and the plan keeps working with standard ideas and a notice that says when to try again. The app's own daily budget (`AI_DAILY_LIMIT`) can be set below the provider's quota so the app runs out first, at a known time (UTC midnight).

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

The interface copy is in English (`index.html` declares `lang="en"`). The brief's **Language for AI suggestions** setting changes only what Gemini writes (summary, ideas, extra tasks and vendor questions); every label, message, template task and vendor name and the standard suggestions stay English, so a Hindi plan mixes Hindi AI text with English interface text. Text the user or the model writes is rendered with `dir="auto"`, so right-to-left text such as Arabic takes its own direction inside the English layout, but labels and messages are English only. Money is formatted with a fixed locale per currency, and the workspace formats dates and counts in `en-IN` whatever the browser's language.

**What would lift it:** a message catalog per language and locale-aware date formatting chosen by the user.

## The AI answer cache is per tab

The cache of the last 8 answers lives in memory in the planner's client (`src/features/client/api-client.ts`). A reload seeds it with the saved plan's answer, keyed by the restored brief, so submitting that brief again through **Edit details** costs no call. Other answers from before the reload are gone, another tab starts with an empty cache, and a plan whose guests were edited after its answer arrived seeds that answer under the edited brief (the answer the plan already shows).

**What would lift it:** keeping the whole cache in `sessionStorage`, validated on read like the saved plan.

## Text sanitizing trades a few characters for safety

`src/shared/sanitize-text.ts` removes Unicode tag characters to stop hidden instructions, which also turns the England, Scotland and Wales flag emoji into a plain black flag. It turns `http://`, `https://`, `www.` and `javascript:` into a space wherever they appear, so a venue link typed in the notes reaches the model as a bare address, and a word that happens to contain `www.` is split. Text is capped by code points, so a cut can split an emoji built from several code points.

**What would lift it:** an allowlist for the three subdivision flags, and `Intl.Segmenter` to cut by grapheme.

## The origin check is not authentication

A request must carry an allowed `Origin`, which stops other websites from calling the API from a visitor's browser. A script can set a matching `Origin` itself, so the check does not identify who is calling. Such a caller is still held by the other limits: JSON only, 64 KB, the strict brief schema, the rate limits and the daily budget.

**What would lift it:** a signed per-session token issued with the page, or bot protection at the platform edge.
