# Spec: Accounts and login screens (web, M9)

Feature spec for the sign-up and login screens, the session in the web app and the route guards, made from `SPEC_TEMPLATE.md` (sections 1-5). The API side is `auth.md` (A1-A19); this file does not change it. Other screens (events, tickets, check-in) are in `web.md`.

## 1. Goals and expected behaviour

**Goal.** Attendees and organizers create an account, log in and log out in the browser. The app knows who is logged in, keeps people out of screens meant for the other role, and sends them back to where they were going.

**Behaviours.** Each line is something that can be checked with a component test (`fetch` mocked). "Test first" ones get the test before the code. Ids are W-A1, W-A2, ... (`auth.md` uses A1..).

| # | Behaviour | Test first? |
|---|---|---|
| W-A1 | At start the app calls `GET /auth/me` once (TanStack Query, key `["me"]`). 200 gives the session `{ role, id, email, name }`; 401 gives "logged out" (not an error). Many components reading the session cause one call, not many. | yes |
| W-A2 | While `me` is loading, every guarded screen and every login/signup page shows only a "Loading..." status (`role="status"`). No form, no redirect and no wrong-account message is shown until `me` has an answer (no flash of the login page). | yes |
| W-A3 | If `me` fails with a network error or 5xx, the app shows "Could not check your login" with a Retry button (refetches `me`). It does not show the login page. | |
| W-A4 | Logged out on a guarded screen: redirect to the login page of the needed role (`/login` or `/organizer/login`) with the original path and query in `?next=`. | |
| W-A5 | After a successful login or sign-up the app goes to `next` if it is safe, else home (attendee `/`, organizer `/organizer`). Safe means: starts with a single `/`, not `//`, no scheme. An unsafe `next` is ignored. | |
| W-A6 | Wrong role: an attendee on an organizer screen, or an organizer on an attendee-only screen, sees "This page is for [organizers/attendees]. You are logged in as [email]." with a link to the right login page and a link home. No redirect, so no loop. | yes |
| W-A7 | Logged in and opening `/login` or `/signup` as an attendee (or `/organizer/login`, `/organizer/signup` as an organizer): redirect to `next` if safe, else home. | |
| W-A8 | A successful login or sign-up puts the answer into the `["me"]` cache with `setQueryData`. No second `GET /auth/me` is made (checked: the mock `fetch` is called once for the submit and zero more times). | yes |
| W-A9 | Log out calls `POST /auth/users/logout` or `/auth/organizers/logout` (by the session role). On 204 the `me` cache is set to logged out (no new `GET /auth/me`), all other cached queries are removed, and the app shows the logged-out header. If the call fails (network), the person stays logged in and sees "Could not log out. Try again." | |
| W-A10 | Client checks before sending: email is a valid address (one `@`, text on both sides, no spaces, at most 254) after trimming; name (sign-up) is 1-100 characters after trimming; password (sign-up) is 8-128 characters, not trimmed. Login only needs email format and a non-empty password. A failing form sends nothing. | |
| W-A11 | The server decides. The client never treats its own checks as proof, and always handles the API errors below, even for input its checks accepted. | |
| W-A12 | While a request is pending, the submit button is disabled and its label changes ("Logging in...", "Creating account...", "Logging out..."). A second click sends no second request. | |
| W-A13 | 401 on login shows "Wrong email or password." with the same text whether the email or the password is wrong (the API gives no hint, the UI adds none). | |
| W-A14 | 409 on sign-up shows "This email is already used." under the email field. | |
| W-A15 | 400 shows "Some fields are not valid. Check them and try again." at form level (the API sends only `invalid_input`, no field names). Network error or 5xx shows "Something went wrong. Try again." at form level; the typed values are kept. | |
| W-A16 | Focus: after a failed client check, focus goes to the first invalid field (in form order). After a 409, focus goes to the email field. After 400, 401, 5xx or network error, focus goes to the form-level error. | |
| W-A17 | Accessibility: every input has a `<label>`; an invalid input has `aria-invalid="true"` and `aria-describedby` pointing to its error text; field and form errors have `role="alert"`; the password field has a show/hide button (`aria-pressed`, type toggles `password`/`text`). | |
| W-A18 | Header, logged out: links "Log in", "Sign up" and a role link that switches by page role: "For organizers" (to `/organizer/login`) on attendee pages, "For attendees" (to `/login`) on `/organizer...` pages. Logged in: the name, the role and a "Log out" button. It is shown on every screen and reflects the `me` cache at once. | |
| W-A19 | Each page links to its neighbours: login to signup (same role), signup to login (same role), attendee pages to the organizer pages ("I organize events") and the reverse ("I am an attendee"). | |
| W-A20 | The password is kept only in the input's state. It is never put in the URL, `localStorage`, `sessionStorage`, the query cache or the console. The cookie is `httpOnly`; the app never reads it. | |

**Out of scope.** Password reset, "remember me" (the cookie always lasts 7 days), social login, email verification, a password strength meter, changing email, password or name, deleting accounts, auto-logout when the cookie expires (the next API call that answers 401 is handled by the screen that made it), translations, a dark theme, a design system.

**Assumptions.** Change any of these first in this file.
- UI guards are a convenience. The API is the real guard (`requireUser`, `requireOrganizer`, A14, A15). A person can edit the page in the browser and still gets 401 or 403 from the API.
- Logout only clears the cookie in the browser. A copied cookie stays valid until it expires (`auth.md`). The UI says nothing more than "logged out".
- Client checks are the same rules as `auth.md` (A5, A7) but the server may be stricter. Email case is not changed by the client; the server lowercases it.
- A person logged in as one role may open the login page of the other role, and logging in there replaces the session (A12). No warning is shown.
- `me` is cached with no automatic refetch on window focus (`refetchOnWindowFocus: false`, `retry: false`, `staleTime: Infinity`) so there is exactly one call at start. Login, sign-up and logout change it by hand.
- The API is reached on the same origin (see section 6, question 1), so `fetch` uses `credentials: "same-origin"`.

## 2. UI decisions

| Route | Who sees it | What it shows and does |
|---|---|---|
| `/login` | Logged out, or an organizer | Attendee login form (email, password). Links: sign up, "I organize events" (`/organizer/login`). Calls `POST /auth/users/login`. |
| `/signup` | Logged out, or an organizer | Attendee sign-up form (email, name, password). Links: log in, "I organize events" (`/organizer/signup`). Calls `POST /auth/users/signup`. |
| `/organizer/login` | Logged out, or an attendee | Organizer login form. Links: sign up, "I am an attendee" (`/login`). Calls `POST /auth/organizers/login`. |
| `/organizer/signup` | Logged out, or an attendee | Organizer sign-up form. Links: log in, "I am an attendee" (`/signup`). Calls `POST /auth/organizers/signup`. |
| `/` | Everyone | Attendee home. A placeholder here; the event screens come from `web.md`. Public: no guard. |
| `/organizer` | Organizers (guarded) | Organizer home. A placeholder here; the organizer screens come from `web.md`. Logged out: redirect to `/organizer/login?next=/organizer`. Attendee: wrong-account message (W-A6). |
| Header (all screens) | Everyone | Logged out: "Log in", "Sign up", and "For organizers" (attendee pages) or "For attendees" (`/organizer...` pages). Logged in: name, role, "Log out" button (W-A18). |

Fields (labels in this order; the same four pages share one form component with props `role` and `mode`):

| Field | Label | Input | Login | Sign-up |
|---|---|---|---|---|
| email | "Email" | `type="email"`, `autocomplete="email"` | yes | yes |
| name | "Name" | `type="text"`, `autocomplete="name"` | no | yes |
| password | "Password" | `autocomplete="current-password"` (login) or `"new-password"` (sign-up), with "Show"/"Hide" button | yes | yes, hint "8 to 128 characters" |

Client error texts: email "Enter a valid email address."; name "Enter your name (1 to 100 characters)."; password (sign-up) "Use 8 to 128 characters."; password (login) "Enter your password."

**Guard rules.** A `RequireRole(role)` wrapper is used by every protected screen (here `/organizer`; later screens reuse it). A `RedirectIfLoggedIn(role)` wrapper is used by the four auth pages: it redirects only a person already logged in with the same role (W-A7). The decision table is in the guard code and tests:

| `me` state | Guarded screen of role R | Auth page of role R |
|---|---|---|
| loading | "Loading..." (W-A2) | "Loading..." |
| error | "Could not check your login" + Retry (W-A3) | same |
| logged out (401) | redirect to R's login with `next` (W-A4) | show the form |
| logged in as R | show the screen | redirect home or `next` (W-A7) |
| logged in as the other role | wrong-account message (W-A6) | show the form |

**States on every screen.**
- Loading: the "Loading..." status while `me` is pending (W-A2); the submit button label while a request is pending (W-A12).
- Error: `me` failure with Retry (W-A3); form errors (W-A13-W-A15); logout failure (W-A9).
- Empty: not applicable (no lists).
- Already logged in: redirect or wrong-account message (table above).

## 3. Architecture decisions

- **Apps:** `web/` only. React 19, Vite, TypeScript, TanStack Query (already installed). No API change beyond `auth.md` A17-A19.
- **Router package:** `react-router` (v7). In v7 the one package `react-router` has everything for the browser (`BrowserRouter`, `Routes`, `Navigate`, `useNavigate`, `useSearchParams`); `react-router-dom` is only a re-export kept for old code, so it is not used. It is **not yet in `web/package.json`**. The user has approved it; installing it (`npm install react-router` in `web/`) is part of the code step. Check the version it installs supports React 19 (v7 does). No other library is needed.
- **Routing style:** declarative (`BrowserRouter` in `main.tsx`, `Routes` in `App.tsx`). No data routers, loaders or actions: data goes through TanStack Query.
- **Session:** `useMe()` is `useQuery({ queryKey: ["me"], queryFn: fetchMe, ... })`. `fetchMe` calls `GET /auth/me`; 200 returns the object, 401 returns `null` (logged out), anything else throws (W-A3). Login and sign-up use `useMutation`; `onSuccess` runs `queryClient.setQueryData(["me"], data)`. Logout `onSuccess` sets `["me"]` to `null` and calls `queryClient.removeQueries({ predicate: key !== "me" })`.
- **API client:** a small `fetch` wrapper in `web/src/auth/api.ts` (JSON body, `credentials: "same-origin"`) that returns the parsed body or throws an error carrying the status. Role to path: `user` is `users`, `organizer` is `organizers`, from a fixed map.
- **Role types:** `type Role = "user" | "organizer"`; `type Me = { role: Role; id: string; email: string; name: string }`.
- **Redirect with `next`:** `Navigate to={`${loginPath}?next=${encodeURIComponent(path + search)}`}`. After login, read `next` with `useSearchParams` and check it with `safeNext(next)` (W-A5) before `navigate(..., { replace: true })`.
- **Validation:** pure functions in `web/src/auth/validate.ts`, no library.
- **Styling:** plain CSS or inline; nothing new.
- **Dev setup:** see section 6, question 1.

## 4. Files to touch

| File | What to do | Behaviours |
|---|---|---|
| `web/package.json` | Add `react-router` (approved; installed in the code step) | all |
| `web/vite.config.ts` | Dev proxy for `/auth` to the API (if question 1 is answered "proxy") | W-A1 |
| `web/src/main.tsx` | Wrap `App` in `BrowserRouter` next to `QueryClientProvider`; `QueryClient` defaults for `me` stay on the query, not global | W-A1 |
| `web/src/App.tsx` | Header plus `Routes` for the seven routes in section 2 | W-A18, W-A19 |
| `web/src/auth/api.ts` | `fetchMe`, `login`, `signup`, `logout`, error with status | W-A1, W-A8, W-A9 |
| `web/src/auth/session.ts` | `useMe`, `useLogin`, `useSignup`, `useLogout`, `ME_KEY` | W-A1, W-A8, W-A9 |
| `web/src/auth/validate.ts` | `validateEmail`, `validateName`, `validatePassword`, `safeNext` | W-A5, W-A10 |
| `web/src/auth/guards.tsx` | `RequireRole`, `RedirectIfLoggedIn`, loading and error states | W-A2-W-A7 |
| `web/src/auth/AuthForm.tsx` | Shared form: fields, show/hide, errors, focus, pending label, links | W-A10-W-A17, W-A19, W-A20 |
| `web/src/auth/Header.tsx` | Logged-out links, logged-in name and log out | W-A9, W-A18 |
| `web/src/App.test.tsx` | Update the existing test: `App` now needs `QueryClientProvider` and a router, and `fetch` mocked | |
| `web/src/auth/session.test.tsx` | Tests first: W-A1, W-A8 | W-A1, W-A8, W-A9 |
| `web/src/auth/guards.test.tsx` | Tests first: W-A2, W-A6; then W-A3, W-A4, W-A7 | W-A2-W-A7 |
| `web/src/auth/validate.test.ts` | Email, name, password limits; `safeNext` (`//evil.com`, `https://x`, `/a?b=1`, empty) | W-A5, W-A10 |
| `web/src/auth/AuthForm.test.tsx` | Both roles, both modes: client checks, status mapping, pending button, focus, aria, show/hide, links | W-A10-W-A17, W-A19, W-A20 |
| `web/src/auth/Header.test.tsx` | Logged-out and logged-in header, logout flow and failure | W-A9, W-A18 |
| `README.md`, `ROADMAP.md` | Routes, `react-router` added, M9 step 28 done | |

Tests follow the existing style (`App.test.tsx`: Vitest globals, files next to the code in `web/src/`, `render` and `screen` from Testing Library). The only installed helper is `@testing-library/react`, so use `fireEvent` and `findBy*` queries and `toBeTruthy()` (no `jest-dom`, no `user-event`; do not add them). `fetch` is replaced with `vi.stubGlobal("fetch", vi.fn())` returning `Response` objects; each test builds a fresh `QueryClient` (`retry: false`) and renders under `MemoryRouter` with a start path. Rendering is done through a small `renderApp(path)` helper in the test files.

## 5. Done means

- Tests, typecheck and linter all pass in `web/`.
- Every behaviour W-A1 to W-A20 has a test, or a note in the README that says it is not covered.
- W-A1, W-A2, W-A6 and W-A8 have their tests written and committed before the code.
- The mock `fetch` call counts prove W-A1 (one `GET /auth/me` at start) and W-A8 (no second one after login).
- A manual check against the real API: sign up, reload (still logged in), log out, open `/organizer` (redirected, then back after login).
- The README "Project status" says what really works, including the logout limitation (a copied cookie stays valid) and that the UI guards are not security.

## 6. Open questions

1. How does the browser reach the API in development? Proposal: a Vite dev proxy for `/auth` (the API routes have no prefix), so the app and API share one origin and no CORS or `credentials: "include"` is needed. The other option is CORS on the API with a fixed origin. Needed before the code step; the proxy needs a change in `vite.config.ts` and a production note for the README.
