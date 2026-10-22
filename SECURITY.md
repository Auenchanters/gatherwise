# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's private vulnerability reporting: <https://github.com/Auenchanters/gatherwise/security/advisories/new>. Do not open a public issue. Include the steps to reproduce and what an attacker could gain. The same contact is published at `/.well-known/security.txt` on the live site (`public/.well-known/security.txt`).

Only the `main` branch and its live deployment are supported.

## Threats and mitigations

| Threat                                                                       | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                          | Where                                                                                                                                                              |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Prompt injection** through the brief's free text (name, city, vibe, notes) | The text is sanitized and capped, then sent as JSON data in its own user message; nothing from the user is added to the fixed system instruction, which tells the model that every value is untrusted data, never instructions. The answer must match a strict per-template schema whose ids are enums, and the engine clamps every number. A 16-payload injection corpus runs through every free-text field.                                       | `src/shared/prompt.ts`, `src/shared/sanitize-text.ts`, `src/shared/schema.ts`, `src/domain/merge.ts`, `tests/unit/prompt.test.ts`, `tests/fixtures/injection.json` |
| **XSS through model output**                                                 | The server strips tags, stray angle brackets, control and invisible characters from every model string and caps its length; the browser validates the answer again. React renders all user and model text as text, and no code in `src/` sets HTML directly. The CSP allows scripts from the site itself only, with no `unsafe-` sources.                                                                                                           | `server/sanitize.ts`, `src/shared/sanitize-text.ts`, `src/features/client/api-client.ts`, `vercel.json`                                                            |
| **ICS (calendar) injection** with CR, LF or other control characters         | Every text value is escaped per RFC 5545 (backslash, semicolon, comma, line breaks as `\n`); other control characters, U+2028, U+2029 and lone surrogates are dropped; lines fold at 75 octets between characters. A CRLF-injection corpus runs against every text field.                                                                                                                                                                           | `src/domain/ics.ts`, `tests/unit/ics.test.ts`                                                                                                                      |
| **CSRF and cross-origin calls**                                              | `POST /api/plan` accepts only `application/json` (415 otherwise) and rejects a missing, foreign, empty or `null` `Origin` and any `Sec-Fetch-Site: cross-site` request (403). The app uses no cookies or other ambient credentials. See the origin rule below.                                                                                                                                                                                      | `server/request.ts`, `tests/unit/handler.test.ts`                                                                                                                  |
| **Oversize bodies**                                                          | A declared `Content-Length` over 16,384 bytes is refused, and the streamed body is counted and cancelled past 16,384 bytes (413). The strict brief schema caps every field.                                                                                                                                                                                                                                                                         | `server/request.ts`, `src/shared/limits.ts`                                                                                                                        |
| **Abuse and cost**                                                           | Per warm instance: 10 plan requests a minute per client and 60 in total (429 `RATE_LIMITED`), and 3 model calls in flight (429 `CAPACITY_LIMITED`), each with `Retry-After: 60`. One model call per request with no retries, at most 2,048 output tokens and a 20-second timeout; functions stop at 30 seconds. The browser caches answers and never retries on its own.                                                                            | `server/rate-limit.ts`, `server/capacity.ts`, `server/provider.ts`, `vercel.json`, `src/features/client/api-client.ts`                                             |
| **Secret leakage**                                                           | `GEMINI_API_KEY` is read only on the server, never with a `VITE_` prefix, so it never reaches the client bundle. `.env*` files other than `.env.example` are git-ignored. Gitleaks scans the full git history on every push, and `npm run preflight` scans the git index for key signatures, printing only file names. Error responses never carry provider messages.                                                                               | `server/handler.ts`, `.gitignore`, `.gitleaks.toml`, `.github/workflows/secrets.yml`, `scripts/preflight.mjs`, `server/errors.ts`                                  |
| **Tampered or stale `localStorage`**                                         | The saved plan is untrusted: size-capped, parsed strictly, version-checked, and rebuilt by the engine, with any stored AI answer re-validated and merged again. A bad value is removed with a one-line notice.                                                                                                                                                                                                                                      | `src/features/plan/persist.ts`, `src/features/plan/planner-store.ts`, `tests/unit/persist.test.ts`                                                                 |
| **Clickjacking and browser hardening**                                       | Every response carries a CSP with `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'` and `form-action 'self'`; `X-Frame-Options: DENY`; `X-Content-Type-Options: nosniff`; `Referrer-Policy: strict-origin-when-cross-origin`; a `Permissions-Policy` that turns off camera, microphone, geolocation, payment and USB; and HSTS for one year. API responses are `Cache-Control: no-store`.                                            | `vercel.json`, `scripts/live-checks.ts`                                                                                                                            |
| **Private data in logs**                                                     | One JSON log line per request holds ids, numbers and fixed labels only (shape below): never brief text, model text, provider messages, request paths or IP addresses. Clients are rate-limited by a SHA-256 of their address, never the raw address.                                                                                                                                                                                                | `server/log.ts`, `server/handler.ts`, `server/rate-limit.ts`, `tests/unit/handler.test.ts`                                                                         |
| **Supply chain**                                                             | Four runtime dependencies, all pinned to exact versions with a lockfile and installed with `npm ci`. CI runs `npm audit` (moderate and above for production dependencies, high and above for all). CodeQL (`security-extended`) runs on `main`. Dependabot watches npm and GitHub Actions with its pull-request limit at 0, so alerts arrive without bot branches. Actions are pinned to commit SHAs, and the Gitleaks binary is checksum-verified. | `package.json`, `.github/workflows/ci.yml`, `.github/workflows/codeql.yml`, `.github/dependabot.yml`, `.github/workflows/secrets.yml`                              |

## The request log line

`server/log.ts` writes one line per API request with `console.info`, or `console.error` for a 5xx. Its type has room for nothing else:

```ts
interface RequestLog {
  readonly requestId: string; // crypto.randomUUID(), also returned as meta.requestId
  readonly route: string; // '/api/plan', '/api/health' or 'unknown', never the raw path
  readonly status: number;
  readonly code?: ErrorCode; // the catalogued error code, on failures
  readonly kind?: 'internal'; // marks an unexpected fault (a 500) without logging its message
  readonly event?: 'community' | 'wedding' | 'birthday'; // once the brief has parsed
  readonly latencyMs: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}
```

A line from the runtime smoke test in `npm run build`:

```json
{
  "requestId": "1e3e82ed-88ba-44d6-bd03-d7840f7f74ef",
  "route": "/api/plan",
  "status": 503,
  "code": "AI_NOT_CONFIGURED",
  "latencyMs": 10,
  "event": "community"
}
```

## The origin rule

For `POST /api/plan`, `validateTransport` in `server/request.ts` allows exactly two origins: the origin of the request's own URL (so a preview deployment can call itself) and `APP_ORIGIN` when it is set.

- A request whose `Origin` is missing, empty, the opaque value `null`, or anything other than those two origins is refused with 403 `ORIGIN_REJECTED`.
- A request marked `Sec-Fetch-Site: cross-site` is refused with 403, whatever its `Origin`.
- A missing `Origin` is refused. Browsers send `Origin` on every POST, same-origin ones included, so the app's own calls always carry it, and another website cannot make a visitor's browser call the API. A script outside a browser can set any `Origin` it likes, so this check is CSRF hygiene and not an abuse control: the size cap, the strict schema and the rate limits are what hold such callers (see `docs/KNOWN-LIMITATIONS.md`).
- The comparison is exact string equality, after trimming the environment value. `APP_ORIGIN` must be an origin exactly as browsers send it: scheme, host and port only, with no trailing slash and no path. `https://example.com/` never matches; `https://example.com` does.
