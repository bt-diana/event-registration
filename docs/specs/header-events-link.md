# Spec: "Watch all events" button in the header (web)

Feature spec made from `SPEC_TEMPLATE.md` (sections 1-5). Decisions D58 and D59: the button is a `Link` styled as a button that always opens `/`, the events list. Frontend only: it does not read `me`; no subscription, no API change, no new library. It changes `web/src/auth/Header.tsx` (header rules W-A18, W-R14, W-E22 in `Header.test.tsx`). The list itself is `events-public-list-web.md` (`/`; W-L8, D60: an organizer on `/` stays there and sees the list). No role words in page content: `role-eyebrow.md` RE1 (the header is not content). Style values are `docs/brand.md`. Ids are HB1, HB2, ...

## 1. Goals and expected behaviour

**Goal.** From any screen, anyone (logged out, attendee, organizer) opens `/` in one click, without using the logo. An organizer who clicks it stays on `/` and sees the list in the organizer look (W-L8, D60).

**Behaviours.** Each line is checked with a component test in `web/src/auth/Header.test.tsx` (`fetch` mocked). "Test first" ones get the test before the code.

| # | Behaviour | Test first? |
|---|---|---|
| HB1 | The header has a link with the exact text "Watch all events" (role `link`, inside the `banner`). It is a `Link`, not a `<button>`, and makes no request of its own. | |
| HB2 | The `href` is `/` in every state: logged out, attendee and organizer. It never depends on `me`. | yes |
| HB3 | The link is shown at once, also while `me` is pending, and stays the same after `me` answers 200, 401, a network error or 5xx. It never waits for `me` and does not change when `me` answers. | yes |
| HB4 | Same link in all three states (logged out, attendee, organizer) and on every route the header shows on, including `/login`, `/signup`, `/organizer/login`, `/event/:id` and the registrations screens. Exactly one such link in the header. | |
| HB5 | Current page: when the pathname is exactly `/`, the link has `aria-current="page"`; elsewhere it has no `aria-current`. `/event/1`, `/organizer` and `/organizer/events/new` do not count (exact match, not prefix). This holds for an organizer on `/` too. | yes |
| HB6 | Clicking it from another screen goes to `/` (location changes, `me` is not refetched: `GET /auth/me` count stays 1), for an organizer too: the location stays `/`, no redirect. Clicking it when already there stays on the page and does nothing else. | |
| HB7 | Log out and login keep working: the link is the same before and after (it is not read from the `me` cache). An organizer who clicks it from another screen stays on `/` and sees the public list in the organizer look (W-L8: "Loading..." until `me`, then one list request). | |
| HB8 | The existing header checks stay green: logo `href` and icon (W-E22), account links per role (W-R14), `Log in` / `Sign up` / role switch (W-A18), Log out (W-A9). | |
| HB9 | Accessibility: it is a real `<a>` reached by Tab, in this order: logo, "Watch all events", then the account links and Log out; Enter opens it; visible focus ring (the existing `a:focus-visible`); the text is the accessible name (no icon-only, no `aria-label` that differs from the text); target at least 44 px high. | |
| HB10 | Phone width: the label stays complete (no shortening, no hiding); the header keeps wrapping as today and the button may drop to its own row. No horizontal scroll at 320 px. Checked by hand on the canvas and the real page (jsdom has no layout). | |

**Out of scope.** Subscribing, notifications or email for new events; counters or badges on the button; a dropdown or menu; showing it only on some screens; changing the logo link; changing the `/` or `/organizer` pages; translations; dark theme; a new icon.

**Assumptions.** Change any of these first in this file.
- The target is `/` for everyone (D59). An organizer on `/` is no longer sent to `/organizer` (D60, W-L8): the page waits for `me` ("Loading..." only), then shows the public list in the organizer look. So `aria-current="page"` on `/` applies to organizers too (HB5).
- After login the organizer opens `/organizer` by default (D61; `HOME` in `web/src/auth/guards.tsx`, W-A5/W-A7 in `auth-web.md`). This spec relies on that and does not change it.
- The header logo keeps its role-based target (D62, W-E22): `/organizer` for an organizer, `/` for others. Only the new button is fixed to `/`.
- "Current" means exact pathname match; the query string and hash are ignored.
- The text is English only, as the rest of the app.

## 2. UI decisions

| Part | Decision |
|---|---|
| Place | Right side of the header, first element of the right group, before the account links / `Log in` nav. The logo stays on the left. |
| Look | Looks like the other header links (D63): no border, no background, `--text`, 15 px semibold, 44 px high, underline on hover. Log out in the header gets the same look. The class `button-link-secondary` stays as the name. |
| Current state | `aria-current="page"` plus an underline and the accent colour (not colour alone). |
| Label | "Watch all events" (sentence case, always). |
| Desktop | One row: logo, then the right group (button, then nav or account). Gap 16 px between the button and the account block. |
| Phone (up to 520 px, the width used in `styles.css`) | The right group wraps below the logo, full label visible; the button, then the account block, wrap inside it in the existing 8 px row gap. |

**Copy.**

| Case | Text |
|---|---|
| link | "Watch all events" |

**States.** Always visible; current on `/` only. No loading or error state of its own.

## 3. Architecture decisions

- **Apps:** `web/` only. React, `react-router` (`Link`, `useLocation`, both already used in `Header.tsx`). No new library, no API change, no new route.
- **Target:** the constant `/`. No role map and no `useMe` check for the button.
- **Current state:** `aria-current={pathname === "/" ? "page" : undefined}` using the `pathname` the header already reads. (`NavLink` is not used, to keep one `Link` as D58 says and exact matching explicit.)
- **Structure:** the button is rendered by `Header` itself, outside the `Account` component and outside the `nav` elements, wrapped with them in one `div.site-header-end` (flex, wrap, gap). It is not inside `nav aria-label="Account"` so logged out and logged in have the same markup for it. It renders in every state, including while `me` is pending (HB3).
- **Styling:** `web/src/styles.css`: `.button-link-secondary` (looks like a nav link, also used for the header Log out look) and `.site-header-end`. The rule `.site-nav a` is not applied because the link is outside the nav. Colours from `brand.md` tokens; no new colour.
- **Landmarks:** the header keeps its two nav landmarks ("Main" for the logged-in account, "Account" for logged out). The button is a plain link in the `banner`.

## 4. Files to touch

| File | What to do | Behaviours |
|---|---|---|
| `web/src/auth/Header.test.tsx` | Tests first: HB2 (`href` `/` in three states), HB3 (shown while pending, same after 200, 401, 5xx), HB5 (exact match, not on sub-routes). Then HB1, HB4, HB6, HB7, HB9 (Tab order) | HB1-HB9 |
| `web/src/auth/Header.tsx` | Add the link with `aria-current`, the `site-header-end` wrapper | HB1-HB7, HB9 |
| `web/src/styles.css` | `.button-link-secondary`, `.site-header-end`, phone wrap | HB9, HB10 |
| `docs/brand.md` | Header section: the new button, after the canvas is drawn (separate edit) | HB10 |
| `README.md`, `ROADMAP.md` | Step and behaviour list (separate edit by the agent that owns them) | |

Tests follow `auth-web.md` section 4: Vitest globals, files next to the code, `mockFetch`, a fresh `QueryClient` per test, `MemoryRouter`, `@testing-library/react` only. Existing helpers `ANN`, `OLGA`, `renderApp`, `callsTo`, `deferred`, `json` are enough.

## 5. Done means

- Tests, typecheck and linter pass in `web/`.
- Every behaviour HB1 to HB9 has a test, or a note in the README that says it is not covered; HB10 is checked by hand.
- HB2, HB3 and HB5 have their tests written and committed before the code.
- All earlier `Header.test.tsx` and `eyebrow.test.tsx` cases stay green.
- A manual check on the real app, desktop and 360 px: logged out, attendee and organizer land on `/` (the organizer sees "Loading..." only, then the list in the organizer look, no redirect); the current state shows on `/` for all three; tab order and focus ring are visible.

## 6. Canvas boards

New boards for the existing design canvas (not a new artifact); not drawn yet. Each at desktop and phone width.

| Board | States shown |
|---|---|
| Header / Watch all events | logged out; attendee; organizer (purple); each with the button normal, hover, focus, and current (on `/`, also for the organizer on the list) |
| Header / Watch all events (phone) | the same three at 360 px, showing how the header wraps; the `me`-loading state (logo and button) |

## 7. Open questions

Decided: the target is `/` for everyone (D59), so the button is shown while `me` loads and the earlier questions on the `href` per role are closed. Also decided: an organizer who clicks the button stays on `/` and sees the list (D60), so the old question 4 (redirect) is closed and removed. Ids are kept.

1. Look: closed by D63 (link look, also for Log out).
2. Current state: keep the link visible and mark it `aria-current` on `/` (default, HB5), or hide it there?
3. Should the logged-in account nav ("Registrations") and this button share one `nav` landmark? Default: no, the button is a plain link in the header.