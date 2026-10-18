# Spec: Web calls the API at a configurable base URL (deploy)

Feature spec made from `SPEC_TEMPLATE.md` (sections 1-5, structure only). It changes how the web reaches the API and how the API answers a browser on another origin. No routes, tables or screens change. Builds on `auth.md` (cookie, A2) and `auth-web.md`.

## 1. Goals and expected behaviour

**Goal.** On Render the web is a Static Site and the API is a separate Web Service on different `onrender.com` origins. Rewrites did not work, so the web calls the API at a base URL from the build environment, and the API allows that one web origin (CORS with credentials) so login works. Local dev and all existing tests stay as they are.

**Decisions** (already made by the user; their IDs are given in the session file, the next free one is D79):
- P1. Web reads `VITE_API_URL` at build time. Empty or unset means requests stay relative and the Vite dev proxy works as today. A trailing slash is stripped. No new libraries. Reason: one switch, dev and tests unchanged.
- P2. `credentials` is `"include"` only when a base URL is set, otherwise `"same-origin"` as today. Reason: the cookie must travel cross-origin, and nothing else changes.
- P3. API reads `CORS_ORIGIN`: one exact origin, no wildcard (a wildcard is not allowed with credentials). Set: answer preflight and send the CORS headers. Unset: no CORS headers (today). Written by hand in a small middleware, no `cors` package. Reason: few lines, no dependency.
- P4. When `CORS_ORIGIN` is set and `NODE_ENV=production`, the session cookie uses `sameSite: "none"` and `secure: true`. Otherwise unchanged (`lax`). Reason: a cross-site fetch does not send a `lax` cookie.

**Behaviours.** Each line can be checked. Prefix `R` (B, A are used by other specs).

| # | Behaviour | Test first? |
|---|---|---|
| R1 | API, `CORS_ORIGIN` set, request with `Origin` equal to it: the answer has `Access-Control-Allow-Origin` equal to that exact origin, `Access-Control-Allow-Credentials: true` and `Vary: Origin`. | yes |
| R2 | API, `CORS_ORIGIN` set, preflight `OPTIONS` (with `Origin` and `Access-Control-Request-Method`) from the allowed origin: answers 204 with `Access-Control-Allow-Methods` listing `GET, POST, OPTIONS`, `Access-Control-Allow-Headers` containing `Content-Type`, and the headers of R1. It does not reach auth or any route handler. | yes |
| R3 | API, `CORS_ORIGIN` set, request (or preflight) from any other origin, or with no `Origin`: no `Access-Control-Allow-Origin` and no `Access-Control-Allow-Credentials`. The route still answers as usual (CORS is enforced by the browser). `Vary: Origin` is still sent. | yes |
| R4 | API, `CORS_ORIGIN` unset: no CORS headers on any answer, and `OPTIONS` is handled as today. | |
| R5 | Cookie, `CORS_ORIGIN` set and `NODE_ENV=production`: `Set-Cookie` has `SameSite=None` and `Secure` (and still `HttpOnly`, 7 days, signed). `clearSession` uses the same options. | yes |
| R6 | Cookie, any other combination (`CORS_ORIGIN` unset, or `NODE_ENV` not production): `SameSite=Lax`, `Secure` only when `NODE_ENV=production`, as in `auth.md` A2. | yes |
| R7 | Web: with no base URL (unset or empty), `request("/auth/me")` calls `fetch` with `"/auth/me"` and `credentials: "same-origin"`. | |
| R8 | Web: with base `https://api.example.com`, `request("/auth/me")` calls `fetch` with `https://api.example.com/auth/me` and `credentials: "include"`. | |
| R9 | Web: a base with a trailing slash (`https://api.example.com/`) gives the same URL as R8, with no double slash. | |
| R10 | Web: a whitespace-only base counts as empty (R7). | |
| R11 | Every web API client uses `request()`, so R7-R9 hold for all calls (no other `fetch` in `web/src`). | |

**Out of scope.** Multiple allowed origins, wildcards, a `cors` package, a custom domain setup, a Render rewrite or proxy, changing any route, `CORS_ORIGIN` for the dev proxy, a runtime (non-build-time) config for the web, CSRF protection beyond what `auth.md` says.

**Assumptions.**
- `VITE_API_URL` is the origin only (`https://api.example.com`), no path. It is read at build time, so changing it needs a rebuild of the Static Site.
- `CORS_ORIGIN` is compared as an exact string with the `Origin` header, no trailing slash (the browser sends none).
- The API only uses `GET` and `POST`, and only `Content-Type` is a non-simple request header, so preflight lists just these.
- Preflight answers 204 and no `Access-Control-Max-Age` (not asked for).
- The CORS middleware is the first in `createApp`, before `express.json()` and `cookieParser`.
- Tests set and restore `CORS_ORIGIN` and `NODE_ENV` per test (existing style: `createApp().listen(0)` and `fetch`; for the web, a stubbed `fetch` and a stubbed env).

## 2. UI decisions

No screens change. States: if the API is unreachable or CORS blocks the call, `fetch` throws and `request()` already turns it into `ApiError(0)` ("Network error"), which the screens handle today.

## 3. Architecture decisions

- **Apps:** `api/` (one middleware, cookie option) and `web/` (one function). No new tables, no new libraries.
- **Web:** in `web/src/auth/api.ts`, `request(path, init)` builds the URL as `base + path` where `base` is `import.meta.env.VITE_API_URL` trimmed and stripped of trailing `/` (empty when unset). `credentials` is `base ? "include" : "same-origin"`. `base` is read on each call so a test can stub it. `vite.config.ts` stays as it is (the dev proxy is used when `base` is empty).
- **API CORS middleware:** reads `process.env.CORS_ORIGIN` on each request (so tests can change it). If unset, calls `next()`. Else it sets `Vary: Origin`; if `Origin` equals the value it sets `Access-Control-Allow-Origin` (that value) and `Access-Control-Allow-Credentials: true`. For `OPTIONS` with `Access-Control-Request-Method` and a matching origin it also sets `Allow-Methods: GET, POST, OPTIONS` and `Allow-Headers: Content-Type` and ends with 204; for `OPTIONS` from another origin it ends with 204 and no allow headers.
- **Cookie:** in `api/src/auth/cookie.ts`, `cookieOptions()` returns `sameSite: "none"` and `secure: true` when `CORS_ORIGIN` is set and `NODE_ENV === "production"`, else the current values.
- **Env:** `CORS_ORIGIN` (api, optional), `VITE_API_URL` (web, optional, build time).
- **Render setup:** Web Service gets `CORS_ORIGIN=https://<web>.onrender.com` and `NODE_ENV=production`. Static Site gets `VITE_API_URL=https://<api>.onrender.com` before the build.

## 4. Files to touch

| File | What to do | Behaviours |
|---|---|---|
| `api/test/cors.test.ts` | Tests first: set, preflight, other origin, no origin, unset | R1-R4 |
| `api/test/auth/cookie.test.ts` | Tests first: add the SameSite/Secure cases per env | R5, R6 |
| `web/src/auth/api.test.ts` (new) | Tests first: URL joining, trailing slash, empty base, credentials mode | R7-R10 |
| `api/src/cors.ts` | New small middleware (P3) | R1-R4 |
| `api/src/app.ts` | Register the middleware first | R1-R4 |
| `api/src/auth/cookie.ts` | Cookie options (P4) | R5, R6 |
| `web/src/auth/api.ts` | Base URL and credentials in `request()`; update the top comment | R7-R11 |
| `.env.example` | Add `CORS_ORIGIN=` (api, optional, the web origin, leave empty for local) and a note that the web reads `VITE_API_URL` at build time (leave empty locally) | |
| `README.md` | "Run locally" note (line about same origin) and "Deploy on Render": describe both services, both variables, the build-time rule and the known limit below | |
| `ROADMAP.md` | Mark the step when done | |

## 5. Done means

- Tests, typecheck and linter pass in `api/` and `web/`.
- R1-R10 have tests (R11 is checked by a search for `fetch(` in `web/src`); R1, R2, R3, R5, R6 are written and committed before the code.
- All existing tests pass unchanged (local dev and tests are not affected).
- `.env.example` and the README Deploy section are updated in the same step.

**Known limits.**
- `*.onrender.com` origins are cross-site to each other (`onrender.com` is on the public suffix list). Browsers that block third-party cookies (Safari, Chrome with the setting on) will not keep the login. A custom domain with the web and the API on sibling subdomains of one registrable domain (for example `app.example.com` and `api.example.com`) fixes it. No code for this.
- `sameSite: "none"` removes the `lax` defence from `auth.md`; the exact `CORS_ORIGIN` check and `httpOnly` stay as the only protection. CSRF protection remains out of scope.

## 6. Open questions

None. Preflight methods `GET, POST, OPTIONS` are confirmed. There is no existing web test for `request()`, so `web/src/auth/api.test.ts` is a new file.

## 7. Change: one env file per app

The root `.env` and `.env.example` are split: `api/.env` and `api/.env.example` hold the API variables (including `CORS_ORIGIN`), `web/.env.example` documents `VITE_API_URL` (Vite reads `web/.env`; on Render it is set in the Static Site environment). `api/src/db/pool.ts` loads `api/.env` (`../../.env` from `src/db` and from `dist/db`). No behaviour changes when the variables are already in the environment.
