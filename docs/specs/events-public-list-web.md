# Spec: Public events list (web, attendee home)

Feature spec made from `SPEC_TEMPLATE.md` (sections 1-5). The API side is `events-public-list.md` (PL1-PL11) and `api/openapi.yaml`; this file does not change them. It replaces the placeholder `AttendeeHome` in `web/src/App.tsx` (route `/`). Status words come from `events-web.md` (W-E17), the organizer look from W-E22, no role words in content from `role-eyebrow.md` (RE1), session helpers from `auth-web.md` (`useMe`, `ApiError`, `request`). Style values are `docs/brand.md`. Ids are W-L1, W-L2, ...

## 1. Goals and expected behaviour

**Goal.** Anyone who opens `/` sees the events they can still join, soonest first, and opens one with a click. An organizer who opens `/` goes to their own home. No registering here (that stays on the event page).

**Behaviours.** Each line is checked with a component test (`fetch` mocked). "Test first" ones get the test before the code.

| # | Behaviour | Test first? |
|---|---|---|
| W-L1 | `/` shows one `h1` "Events" and one card per event, in the API order (the client does not sort). It calls `GET /public/events` once (key `["public-events"]`). No role word and no eyebrow in the content (RE1). | |
| W-L2 | Each card shows: the title as a link to `/event/{id}` (the whole card may be clickable, but there is one link with the title as its text), the start (`formatDateTime`, W-E19), the duration (`formatDuration`) and a badge. No description, no end time. | |
| W-L3 | Badge text, first match wins, from the W-E17 words: `has_started` true gives "Already started"; `full` true gives "Full"; else "{seats_left} of {capacity} seats left". The list only has active events, but if an item has `status` `cancelled` or `passed` anyway, show "Cancelled" or "Ended" first (same order as W-E17); the client never compares dates. Reuse `publicStatus` (W-E17); no second implementation. | yes |
| W-L4 | Empty: `{ events: [] }` shows "No upcoming events." No cards. | yes |
| W-L5 | Loading shows "Loading..." (`role="status"`). Network error or 5xx shows "Could not load events" with a Retry button that refetches only this query; no cards. | |
| W-L6 | Logged out: shows the list as in W-L1. No login link is added in the content (the header has it). Cards link to `/event/{id}`, which shows the "Log in to register" link (W-R2). | |
| W-L7 | Attendee: shows the same list. No request other than `GET /auth/me` and `GET /public/events`; no per-event registration request (no "you are registered" mark in the list). | |
| W-L8 | Organizer: `/` redirects (replace) to `/organizer`. No flash of the list and no `GET /public/events` request: the page waits for `me` ("Loading..." only) and, for an organizer, redirects without fetching. It does not show the public list to an organizer. (Decision: replace, because W-E22 keeps organizers in the organizer look and the organizer home is their events list.) | yes |
| W-L9 | While `me` loads: "Loading..." only, no list request, no redirect (as W-E10, W-A2). `me` network error or 5xx: the page treats the viewer as logged out and shows the list (the list is public); `me` answer 401 means logged out. | yes |
| W-L10 | 401 or 403 from the list call is not expected (the route is public). If it happens, invalidate `["me"]` and show no text of its own (W-E13). | |
| W-L11 | Dates are shown in the browser's time zone with the zone name (W-E19); durations as in W-E19. Pure functions are reused from `web/src/events/format.ts`. | |
| W-L12 | Accessibility: one `h1`; the list is a `<ul>` of `<li>` cards (not a table); the badge is text, never colour alone; loading `role="status"`; the error text is `role="alert"`; after Retry the focus stays on the button or moves to the new content (no extra focus rule). | |
| W-L13 | Refresh: no polling, `refetchOnWindowFocus: false`, `retry: false` (as the other queries). Registering on an event page invalidates `["public-events"]` so the badge is not stale when the person goes back (invalidate in the register success handler of `registration-web.md` W-R6, one added key). | |

**Out of scope.** Search, filters, sorting, pagination (the API returns at most 100), past and cancelled events, description in the list, "registered" marks, register buttons in the list, organizer name, images, calendar export, live updates, translations, dark theme.

**Assumptions.** Change any of these first in this file.
- An organizer on `/` is sent to `/organizer` (replace, so Back does not return to `/`). The organizer can still open any `/event/:id` (W-E10, W-E22).
- The list waits for `me` before it fetches, for the redirect in W-L8. The cost is one `/auth/me` before the list, which the header already makes (same query key `["me"]`, no extra request).
- Cards use the existing card style; a badge style exists from W-E17 (`brand.md`). New styles are small: list spacing and a clickable card.
- The `/public` prefix is already proxied in `web/vite.config.ts`; production serves app and API on one origin, so no config change is needed. The web path `/` does not clash with the API path `/public/events`.

## 2. UI decisions

| Route | Who sees it | API route | Query key | What it shows and does |
|---|---|---|---|---|
| `/` | Logged out and attendees; organizers are redirected to `/organizer` | `GET /public/events` | `["public-events"]` | Heading "Events", cards, empty and error states |

**Card content** (in order): title (link), start line "Sat, 1 Jan 2030, 10:00 CET", duration "1 h 30 min", badge.

**Copy.**

| Case | Text |
|---|---|
| heading | "Events" |
| empty | "No upcoming events." |
| load failure | "Could not load events" + Retry |
| loading | "Loading..." |
| badge | "Already started", "Full", "{n} of {capacity} seats left" |

**States.** Loading, error with Retry, empty, list (with the three badge kinds), organizer redirect (no screen).

## 3. Architecture decisions

- **Apps:** `web/` only. React 19, Vite, TypeScript, TanStack Query, `react-router`. No new library, no API change.
- **API client:** add `listPublicEvents()` and the type `PublicListItem` (the ten keys of PL5) to `web/src/events/api.ts`, built on the existing `request`.
- **Hook:** `usePublicEvents()` in `web/src/events/queries.ts`, key `["public-events"]`, `retry: false`, `refetchOnWindowFocus: false`, and `enabled` only when `me` has answered and the viewer is not an organizer (so W-L8 and W-L9 make no list request).
- **Component:** `web/src/events/PublicEventsList.tsx` replaces `AttendeeHome` in `App.tsx` for the `/` route. It reads `useMe`: pending shows "Loading..."; organizer renders `<Navigate to="/organizer" replace />`; otherwise it shows the list states.
- **Status:** reuse `publicStatus` (W-E17); the list item has the fields it needs (`status`, `has_started`, `full`).
- **Dev proxy:** `/public` is already proxied in `web/vite.config.ts`; no change.
- **Styling:** `styles.css` and `brand.md`: the attendee accent (teal), the existing card and badge. Add only a list reset (`ul` with no bullets) and a card link hover/focus state if needed.

## 4. Files to touch

| File | What to do | Behaviours |
|---|---|---|
| `web/src/events/api.ts` | `listPublicEvents`, `PublicListItem` | W-L1 |
| `web/src/events/queries.ts` | `usePublicEvents`; invalidate `["public-events"]` from the register success handler | W-L1, W-L13 |
| `web/src/events/PublicEventsList.tsx` | The component (states, cards, badge, redirect) | W-L1-W-L12 |
| `web/src/App.tsx` | Replace `AttendeeHome` with `PublicEventsList` and delete the placeholder | W-L1, W-L8 |
| `web/src/styles.css` | List reset, card link state | |
| `web/src/events/test-helpers.ts` | `PublicListItem` builder | |
| `web/src/events/PublicEventsList.test.tsx` (new) | Tests first: W-L3 (one case per badge, plus the order cases), W-L4, W-L8 (no list request, redirect), W-L9. Then W-L1, W-L2, W-L5-W-L7, W-L10, W-L11 | W-L1-W-L11 |
| `web/src/events/eyebrow.test.tsx` | Keep the `/` case green (no role word in `main`) | RE1 |
| `docs/brand.md` | Boards for the list, after the canvas is drawn (separate edit) | |
| `README.md`, `ROADMAP.md` | Routes and step (separate edit by the agent that owns them) | |

Tests follow `auth-web.md` section 4: Vitest globals, files next to the code, `mockFetch`, a fresh `QueryClient` per test (`retry: false`), `MemoryRouter`, `@testing-library/react` only. Fetch call counts prove: one `GET /public/events` on the list, zero list requests for an organizer and while `me` loads.

## 5. Done means

- Tests, typecheck and linter pass in `web/`.
- Every behaviour W-L1 to W-L13 has a test, or a note in the README that says it is not covered.
- W-L3, W-L4, W-L8 and W-L9 have their tests written and committed before the code.
- The `eyebrow.test.tsx` case for `/` stays green.
- A manual check against the real API: logged out sees the list; an attendee sees the same; an organizer opening `/` lands on `/organizer`; a cancelled or passed event is not in the list; a full event shows "Full".

## 6. Canvas boards

Each board at desktop and phone width. Attendee accent (teal); header is the existing one, logged out and logged in as an attendee.

| Board | States shown |
|---|---|
| Public / Events list | with 4 cards (one with seats left, one Full, one Already started, one with 1 seat left); empty ("No upcoming events."); loading; load error with Retry |
| Public / Events list (header) | the same list logged out and logged in as an attendee (header differences only) |

No board for the organizer redirect (no screen).

## 7. Open questions

1. Organizer on `/`: replace with `/organizer` (default, W-L8) or keep showing the public list in the organizer look?
2. Should a card show the end time or seats as "n / capacity" instead of "n of capacity seats left"? Default: the W-E16 wording.
3. Should the whole card be clickable (default: yes, with one real link on the title) or only the title?
4. 100 events max (from the API): is a "showing the first 100" note needed? Default: no.
