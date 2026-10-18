# Spec: "Watch all events" button in the header (web)

Feature spec made from `SPEC_TEMPLATE.md` (sections 1-5). Decision D58: the button is a `Link` styled as a button that opens the events list. Frontend only: no subscription, no API change, no new library. It changes `web/src/auth/Header.tsx` (header rules W-A18, W-R14, W-E22 in `Header.test.tsx`). The list itself is `events-public-list-web.md` (`/`, W-L8 sends organizers to `/organizer`). No role words in page content: `role-eyebrow.md` RE1 (the header is not content). Style values are `docs/brand.md`. Ids are HB1, HB2, ...

## 1. Goals and expected behaviour

**Goal.** From any screen, anyone (logged out, attendee, organizer) opens the events list in one click, without using the logo.

**Behaviours.** Each line is checked with a component test in `web/src/auth/Header.test.tsx` (`fetch` mocked). "Test first" ones get the test before the code.

| # | Behaviour | Test first? |
|---|---|---|
| HB1 | The header has a link with the exact text "Watch all events" (role `link`, inside the `banner`). It is a `Link`, not a `<button>`, and makes no request of its own. | |
| HB2 | The `href` depends on the role: logged out `/`; attendee (`user`) `/`; organizer `/organizer`. No `/organizer` link for logged out or attendees. | yes |
| HB3 | While `me` is pending the link is not shown (same rule as the account links, so a logged-in organizer never sees a wrong `href` flash). After `me` answers (200 or 401) it appears. `me` network error or 5xx counts as logged out, so `/`. | yes |
| HB4 | Same link in all three states (logged out, attendee, organizer) and on every route the header shows on, including `/login`, `/signup`, `/organizer/login`, `/event/:id` and the registrations screens. Exactly one such link in the header. | |
| HB5 | Current page: when the pathname equals the link's `href` exactly (`/` for logged out and attendees, `/organizer` for organizers), the link has `aria-current="page"`; elsewhere it has no `aria-current`. `/organizer/events/new` or `/event/1` do not count (exact match, not prefix). | yes |
| HB6 | Clicking it from another screen goes to the `href` (location changes, `me` is not refetched: `GET /auth/me` count stays 1). Clicking it when already there stays on the page and does nothing else. | |
| HB7 | Log out and login keep working: after logout the link switches to `/` at once (from the `me` cache, as the other header parts, W-A18); after an organizer logs in it is `/organizer`. | |
| HB8 | The existing header checks stay green: logo `href` and icon (W-E22), account links per role (W-R14), `Log in` / `Sign up` / role switch (W-A18), Log out (W-A9). | |
| HB9 | Accessibility: it is a real `<a>` reached by Tab, in this order: logo, "Watch all events", then the account links and Log out; Enter opens it; visible focus ring (the existing `a:focus-visible`); the text is the accessible name (no icon-only, no `aria-label` that differs from the text); target at least 44 px high. | |
| HB10 | Phone width: the label stays complete (no shortening, no hiding); the header keeps wrapping as today and the button may drop to its own row. No horizontal scroll at 320 px. Checked by hand on the canvas and the real page (jsdom has no layout). | |

**Out of scope.** Subscribing, notifications or email for new events; counters or badges on the button; a dropdown or menu; showing it only on some screens; changing the logo link; changing the `/` or `/organizer` pages; translations; dark theme; a new icon.

**Assumptions.** Change any of these first in this file.
- Organizers go straight to `/organizer` (their events list), not to `/` (which would redirect them, W-L8). The target is picked from `me.data?.role`, the same expression the logo already uses.
- "Current" means exact pathname match; the query string and hash are ignored.
- The text is English only, as the rest of the app.

## 2. UI decisions

| Part | Decision |
|---|---|
| Place | Right side of the header, first element of the right group, before the account links / `Log in` nav. The logo stays on the left. |
| Look | Outlined (secondary) button: surface background, `--border-input` border, `--text`, 8 px radius, 16 px semibold, 48 px high, 0 16 px padding (same as `button-secondary`). Not filled, so it does not compete with page actions (Create event, Register). A new class `button-link-secondary` next to `button-link`. |
| Current state | `aria-current="page"` plus a visible difference that is not colour alone: border in `--accent` (organizer purple or attendee teal, as the page) and a 2 px border width. Hover: text and border `--accent`. |
| Label | "Watch all events" (sentence case, always). |
| Desktop | One row: logo, then the right group (button, then nav or account). Gap 16 px between the button and the account block. |
| Phone (up to 520 px, the width used in `styles.css`) | The right group wraps below the logo, full label visible; the button, then the account block, wrap inside it in the existing 8 px row gap. |

**Copy.**

| Case | Text |
|---|---|
| link | "Watch all events" |

**States.** Hidden while `me` loads; visible (not current) on every other route; current on its target route. No loading or error state of its own.

## 3. Architecture decisions

- **Apps:** `web/` only. React, `react-router` (`Link`, `useLocation`, both already used in `Header.tsx`). No new library, no API change, no new route.
- **Target:** a small constant map in `Header.tsx`, `EVENTS_LINK: Record<Me["role"], string>` (`user: "/"`, `organizer: "/organizer"`), with `/` for no `me`. The same `me.data?.role` check as the logo.
- **Current state:** `aria-current={pathname === to ? "page" : undefined}` using the `pathname` the header already reads. (`NavLink` is not used, to keep one `Link` as D58 says and exact matching explicit.)
- **Structure:** the button is rendered by `Header` itself, outside the `Account` component and outside the `nav` elements, wrapped with them in one `div.site-header-end` (flex, wrap, gap). It is not inside `nav aria-label="Account"` so logged out and logged in have the same markup for it. It renders only when `!me.isPending` (HB3).
- **Styling:** `web/src/styles.css`: `.button-link-secondary` (outlined link-button) and `.site-header-end`. The rule `.site-nav a` is not applied because the link is outside the nav. Colours from `brand.md` tokens; no new colour.
- **Landmarks:** the header keeps its two nav landmarks ("Main" for the logged-in account, "Account" for logged out). The button is a plain link in the `banner`.

## 4. Files to touch

| File | What to do | Behaviours |
|---|---|---|
| `web/src/auth/Header.test.tsx` | Tests first: HB2 (three states, `href`), HB3 (pending, 401, 5xx), HB5 (exact match, not on sub-routes). Then HB1, HB4, HB6, HB7, HB9 (Tab order) | HB1-HB9 |
| `web/src/auth/Header.tsx` | Add `EVENTS_LINK`, the link with `aria-current`, the `site-header-end` wrapper | HB1-HB7, HB9 |
| `web/src/styles.css` | `.button-link-secondary`, `.site-header-end`, phone wrap | HB9, HB10 |
| `docs/brand.md` | Header section: the new button, after the canvas is drawn (separate edit) | HB10 |
| `README.md`, `ROADMAP.md` | Step and behaviour list (separate edit by the agent that owns them) | |

Tests follow `auth-web.md` section 4: Vitest globals, files next to the code, `mockFetch`, a fresh `QueryClient` per test, `MemoryRouter`, `@testing-library/react` only. Existing helpers `ANN`, `OLGA`, `renderApp`, `callsTo`, `deferred`, `json` are enough.

## 5. Done means

- Tests, typecheck and linter pass in `web/`.
- Every behaviour HB1 to HB9 has a test, or a note in the README that says it is not covered; HB10 is checked by hand.
- HB2, HB3 and HB5 have their tests written and committed before the code.
- All earlier `Header.test.tsx` and `eyebrow.test.tsx` cases stay green.
- A manual check on the real app, desktop and 360 px: logged out and attendee land on `/`; organizer lands on `/organizer` with no redirect flash; the current state shows on the target route; tab order and focus ring are visible.

## 6. Canvas boards

New boards for the existing design canvas (not a new artifact); not drawn yet. Each at desktop and phone width.

| Board | States shown |
|---|---|
| Header / Watch all events | logged out; attendee; organizer (purple); each with the button normal, hover, focus, and current (on `/` or `/organizer`) |
| Header / Watch all events (phone) | the same three at 360 px, showing how the header wraps; the `me`-loading state (logo only) |

## 7. Open questions

1. While `me` loads: hide the button (default, HB3, no wrong-`href` flash) or show it with `/` and fix it after `me` answers (the logo does this; an organizer would see the `href` change)?
2. Look: outlined (default) or filled like `button-link` (Create event)? Filled competes with page actions and with Log out.
3. Current state: keep the link visible and mark it `aria-current` (default, HB5), or hide it on its own target route?
4. Should the logged-in account nav ("Registrations") and this button share one `nav` landmark? Default: no, the button is a plain link in the header.
5. On the organizer login and signup pages (logged out, organizer look), the target is `/` (the public list) because the viewer is logged out. Acceptable? Default: yes, HB2 follows the session, not the page.
