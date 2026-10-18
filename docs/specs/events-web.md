# Spec: Event screens (web, M2)

Feature spec for the organizer event screens and the public event page, made from `SPEC_TEMPLATE.md` (sections 1-5). The API side is `events.md` (E1-E20) and `api/openapi.yaml`; this file does not change them. Login, session and guards are `auth-web.md` and are reused as they are (`RequireRole`, `useMe`, `ApiError`, header). Style values are `docs/brand.md`. Roadmap steps 10 (this spec), 11 (organizer screens) and 12 (public page).

## 1. Goals and expected behaviour

**Goal.** A logged-in organizer sees their events, creates an event and opens one of their events. Anyone, without login, opens a public event page and sees when it starts, how long it lasts, how many seats are left and whether it is open, full, closed or already started. Nothing here registers, cancels, edits or checks in (M3 and later).

**Behaviours.** Each line is checked with a component test (`fetch` mocked). "Test first" ones get the test before the code. Ids are W-E1, W-E2, ...

| # | Behaviour | Test first? |
|---|---|---|
| W-E1 | Events list (`/organizer`): calls `GET /events` once (key `["events"]`) and shows one row per event, in the API order (the client does not sort). Each row has the title (a link to the event page), start, status, and "registered / capacity". | |
| W-E2 | Events list, empty: `{ events: [] }` shows "You have no events yet." and a "Create event" link. No table is drawn. | yes |
| W-E3 | Events list shows "Loading..." (`role="status"`) while pending. On network error or 5xx it shows "Could not load your events" with a Retry button that refetches; the list is not shown. | |
| W-E4 | Create form (`/organizer/events/new`) has fields title, start (date and time), duration in minutes, capacity. Submit sends `POST /events` with `{ title, starts_at, duration_minutes, capacity }` and nothing else. `starts_at` is the local date and time converted with `new Date(value).toISOString()` (UTC, with `Z`). Title is trimmed. | yes |
| W-E5 | Client checks before sending, the same limits as E2: title 1-200 characters after trimming; start is a valid date and time and in the future by the browser clock; duration an integer 1-1440; capacity an integer 1-100000 (digits only, no decimals, no empty). A failing form sends nothing. | |
| W-E6 | The server decides (as W-A11). The API answers 400 `invalid_input` without field names, so a 400 shows one form-level message "Some fields are not valid. Check them and try again." The typed values are kept. The client checks never replace this handling, also for input they accepted (for example a start that became past while typing). | yes |
| W-E7 | While the create request is pending the button is disabled and reads "Creating..."; a second click sends no second request (a create is not idempotent, a double click would make two events). | yes |
| W-E8 | On 201 the form puts the answer into `["events", id]`, invalidates `["events"]` and goes to `/event/{id}` (`replace`). The new event is then on the list without a stale copy. | |
| W-E9 | Network error or 5xx on create shows "Something went wrong. Try again." at form level; values kept; no navigation. | |
| W-E10 | One link for everyone: `/event/:id`, no guard. The page waits for `me`, then picks the view. A logged-in **organizer** first calls `GET /events/:id` (key `["events", id]`); on 200 (their own event) the **organizer view** shows title, start, end, duration, capacity, registered, seats left, status and created date, with the real numbers for every status (E10) and a link "Back to events". On 404 (not theirs, unknown) the page falls back to the **public view** (W-E15). Everybody else (logged out, attendee, or `me` failed) gets the public view and no organizer request is made. Read only: no edit, cancel or register controls. | yes |
| W-E11 | Another organizer's event opened by an organizer shows the public view, never organizer data and never an "owned by someone else" message (the API gives the same 404 as for an unknown id, E7/E8). If the public call also answers 404, the page shows "Event not found" (W-E18). | yes |
| W-E12 | Event page shows "Loading..." while pending; network error or 5xx shows "Could not load this event" with Retry. | |
| W-E13 | A `401` or `403` answer from any organizer call (cookie expired or role changed) invalidates `["me"]`. The guard then redirects to the login with `next` (W-A4) or shows the wrong-account message (W-A6). The screen shows no error of its own. | yes |
| W-E14 | `/organizer` and `/organizer/events/new` are inside `RequireRole role="organizer"`. While `me` loads no request for events is made; logged out sends no request (the redirect happens first). `/event/:id` has no guard: it shows "Loading..." until `me` has an answer, then makes only the request for its view. | yes |
| W-E15 | Public view (any viewer, including an organizer who does not own the event): calls `GET /public/events/:id` (key `["public-event", id]`) and looks the same for a user, another organizer or nobody. An organizer who owns the event does not call it. | |
| W-E16 | Public page shows title, start, end, duration and the status line (W-E17). Seats are shown as "{seats_left} of {capacity} seats left" while the status line is Open, Full or Already started; for Cancelled and Ended no seat count is shown, only "Capacity: {capacity}". | |
| W-E17 | Status line, first match wins: `status` `cancelled` gives "Cancelled"; `passed` gives "Ended"; `has_started` true gives "Already started"; `full` true gives "Full"; else "Open". Cancelled and Ended are "closed": the page says "Registration is closed." Already started is not closed: registration stays possible until the event ends (`registration.md` R11), so that page never says "Registration is closed." There is no register button in M2 for any status. | yes |
| W-E18 | Public page 404 shows "Event not found" and a link home (`/`). Loading shows "Loading..."; network error or 5xx shows "Could not load this event" with Retry. | |
| W-E19 | Dates are shown in the browser's time zone, with the zone name (for example `Sat, 1 Jan 2030, 10:00 CET`), by one function `formatDateTime(iso, timeZone?)`. The optional `timeZone` is for tests (they pass `"UTC"`); the app passes nothing. Durations are shown as "{n} min", or "1 h 30 min" from 60 up. | |
| W-E20 | Accessibility: every input has a `<label>`; an invalid input has `aria-invalid="true"` and `aria-describedby` to its error text; field and form errors have `role="alert"`; loading uses `role="status"`; after a failed client check focus goes to the first invalid field, after a server or network error to the form-level error; each screen has one `h1`; the status is text, never colour alone; the list is a real `<table>` with `<th scope="col">`. | |
| W-E21 | Header and links: the organizer pages show the existing header; the list links to "Create event" and each title to `/event/{id}`; the form has "Back to events". The organizer view links "Back to events" and shows the share link (`/event/{id}`, the same URL) as text. The public view has no extra links (no public list exists). | |
| W-E22 | A logged-in organizer keeps the organizer look on every screen, also on the public view of `/event/:id` (own or other organizer's event) and on `/`: the header logo links to `/organizer` (not `/`), the logo and tab icon are the organizer ones, and the account block shows "Organizer". Attendees and logged-out people keep `/` and the attendee look. (Bug found after W-E10: the logo led an organizer to the attendee home.) | yes |

**Out of scope.** Register button and any registration, waiting list, my registration (M3, M4); cancel registration; changing capacity; check-in and arrivals counter; reschedule or cancel the event; editing or deleting an event; a public list of events; search, filters, sorting, pagination; live updates (the list and page refresh on reload, on Retry and after a create; no polling, no refetch on window focus beyond the default); sharing buttons, copy link, calendar export; translations; dark theme; per-event time zone (the zone is the viewer's).

**Assumptions.** Change any of these first in this file.
- UI guards are a convenience; the API is the real guard (E9, E7). The public page is public by design (E11).
- Web paths cannot reuse API paths: the dev proxy and production serve app and API on one origin (auth-web question 1). The API owns `/events` and `/public/events`, so screens use `/organizer/events...` and `/event/:id`. The public link is `/event/{id}`, not `/events/{id}`.
- The organizer home `/organizer` is the events list (replaces the placeholder). No `/organizer/events` list route.
- The start time is entered in the organizer's local time zone and stored as an instant. Viewers see it in their own zone, with the zone name, so a viewer in another zone is not misled.
- `datetime-local` is used for the start (no library). It has no seconds in the value; `min` is set to the current local time at render as a hint only (W-E5 and the server decide).
- Status labels use the English texts of W-E17. `has_started` and `status` come from the server clock; the client never compares dates to decide a status.
- Server errors have no field names, so there are no per-field server errors. The only per-field messages are from the client checks.
- No automatic refetch of events on window focus: `refetchOnWindowFocus: false` on these queries, default `retry: false` as for `me`.

## 2. UI decisions

| Route | Who sees it | API route | Query key | What it shows and does |
|---|---|---|---|---|
| `/organizer` | Organizers (`RequireRole`) | `GET /events` | `["events"]` | Events list or empty state. "Create event" link. Replaces `OrganizerHome`. |
| `/organizer/events/new` | Organizers | `POST /events` | mutation | Create form. On success goes to the event page. |
| `/event/:id` | Everyone, no guard. One link: the owner sees the organizer view, everybody else the public view (W-E10) | owner: `GET /events/:id`; others: `GET /public/events/:id` | `["events", id]`; `["public-event", id]` | Organizer view (all numbers) or public view (status line). 404 state. |

**Events list columns** (in order): Title, Starts, Status, Registered ("0 / 25"). Status text: "Active", "Cancelled", "Ended" (from `passed`). Rows for passed and cancelled events stay in the list (E5), same columns.

**Create form fields** (labels in this order):

| Field | Label | Input | Hint | Client error |
|---|---|---|---|---|
| title | "Title" | `type="text"`, `maxLength` not set (the check reports it) | "1 to 200 characters" | "Enter a title (1 to 200 characters)." |
| start | "Starts" | `type="datetime-local"` | "Your local time ({zone})" with the browser zone name | "Choose a start in the future." |
| duration | "Duration (minutes)" | `type="text"`, `inputMode="numeric"` | "1 to 1440" | "Enter whole minutes from 1 to 1440." |
| capacity | "Capacity (seats)" | `type="text"`, `inputMode="numeric"` | "1 to 100000" | "Enter a whole number from 1 to 100000." |

Text inputs with `inputMode` (not `type="number"`) so that the check, not the browser, decides what a bad value is and the error text is the same everywhere. Submit button "Create event" (pending: "Creating..."). Secondary link "Back to events".

**Public page content.** Eyebrow "Event", `h1` title, status line (badge text plus the words of W-E17), "Starts", "Ends", "Duration", seats line (W-E16), and "Registration is closed." for Cancelled and Ended. For Open, Full and Already started the page has no registration text in M2. Registration is possible from now until the event ends, also after the start (`registration.md` R11), so only Cancelled and Ended are closed; M3 adds the register button for Open, Full (waiting list) and Already started.

**Copy for errors** (shared by the screens):

| Case | Text |
|---|---|
| list load failure | "Could not load your events" + Retry |
| event load failure | "Could not load this event" + Retry |
| 404 (organizer or public) | "Event not found" + "This link is not valid or the event does not exist." |
| create 400 | "Some fields are not valid. Check them and try again." |
| create network or 5xx | "Something went wrong. Try again." |
| 401/403 | no text on the screen; the guard handles it (W-E13) |

**States on every screen.**
- Loading: "Loading..." status (list, event page, public page); button label while creating.
- Error: load failure with Retry (list, event page, public page); create errors at form level.
- Empty: events list only (W-E2).
- Not found: organizer event page and public page.
- Full / closed / already started: public page (W-E17); the organizer page shows the raw status and numbers.

## 3. Architecture decisions

- **Apps:** `web/` only, plus one line in `web/vite.config.ts`. React 19, Vite, TypeScript, TanStack Query, `react-router` (all installed). No new library, no API change.
- **API client:** `web/src/events/api.ts`, built on the same `request` idea as `auth/api.ts`: `fetch` with `credentials: "same-origin"`, throws `ApiError(status)` (reuse the class; export `request` from `auth/api.ts` rather than copy it). Functions: `listEvents`, `getEvent(id)`, `createEvent(body)`, `getPublicEvent(id)`. Types `OrganizerEvent`, `PublicEvent`, `NewEvent`, `EventStatus` follow `openapi.yaml`.
- **Hooks** in `web/src/events/queries.ts`: `useEvents`, `useEvent(id)`, `useCreateEvent`, `usePublicEvent(id)`. Keys are the ones in section 2. The queries set `retry: false` and `refetchOnWindowFocus: false`. A shared `onApiError` sends 401/403 to `queryClient.invalidateQueries({ queryKey: ["me"] })` (W-E13). The 404 is read from `error.status`, not from the text.
- **Dev proxy:** add `/events` and `/public` to the proxy in `vite.config.ts` next to `/auth`. Production serves one origin (README note from auth-web). Because of this the web routes avoid those two prefixes (assumptions).
- **Time:** pure functions in `web/src/events/format.ts` (`formatDateTime`, `formatDuration`, `localToIso`) and `web/src/events/validate.ts` (`validateTitle`, `validateStart`, `validateDuration`, `validateCapacity`, all returning an error text or `null`, taking `now` as a parameter so tests need no fake clock). `localToIso("2030-01-01T10:00")` is `new Date(value).toISOString()` and an invalid date gives the start error. No date library.
- **Status line:** one pure function `publicStatus(event)` returning `"cancelled" | "ended" | "started" | "full" | "open"` in the order of W-E17; the component only maps it to text.
- **Create flow:** `useMutation`; `onSuccess`: `setQueryData(["events", id], data)`, `invalidateQueries({ queryKey: ["events"], exact: true })`, then `navigate`. The button is disabled by `isPending`, so the second click cannot send.
- **Guards:** the two organizer routes (`/organizer`, `/organizer/events/new`) wrap their element in the existing `RequireRole role="organizer"`. `/event/:id` has none and picks its view from `me` (W-E10). `main.tsx` is unchanged.
- **Styling:** `styles.css` and the values in `brand.md`; the cards for the form and the public page, a plain bordered table for the list. New: a status badge (text on a tint) and a table style. Colours for badges are not in `brand.md` yet: use `text` on `ground` for Active/Open, `error-text-on-tint` on `error-tint` for Cancelled, `text-muted` on `ground` for Ended, and add them to `brand.md` when the canvas is drawn (open question 2).

## 4. Files to touch

| File | What to do | Behaviours |
|---|---|---|
| `web/vite.config.ts` | Proxy `/events` and `/public` to `http://localhost:3000` | all |
| `web/src/auth/api.ts` | Export `request` (no behaviour change) | all |
| `web/src/events/api.ts` | `listEvents`, `getEvent`, `createEvent`, `getPublicEvent`, types | W-E1, W-E4, W-E10, W-E15 |
| `web/src/events/queries.ts` | Hooks, keys, 401/403 handling | W-E1, W-E8, W-E13 |
| `web/src/events/format.ts` | `formatDateTime`, `formatDuration`, `localToIso` | W-E4, W-E19 |
| `web/src/events/validate.ts` | Four field checks | W-E5 |
| `web/src/events/publicStatus.ts` | `publicStatus` | W-E17 |
| `web/src/events/EventsList.tsx` | List, empty, loading, error states | W-E1-W-E3, W-E20, W-E21 |
| `web/src/events/CreateEventForm.tsx` | Form, checks, pending, errors, focus | W-E4-W-E9, W-E20 |
| `web/src/events/EventPage.tsx` | Picks the view from `me`; organizer view, 404, errors | W-E10-W-E12, W-E21 |
| `web/src/events/PublicEventPage.tsx` | Public page, status line, 404, errors | W-E15-W-E18 |
| `web/src/App.tsx` | Replace `OrganizerHome` with `EventsList`; add `/organizer/events/new` inside `RequireRole` and the unguarded `/event/:id` | W-E14, W-E15 |
| `web/src/styles.css` | Table, badge, definition list, hint text | |
| `web/src/events/test-helpers.ts` | Sample `OrganizerEvent` and `PublicEvent` builders; reuse `auth/test-helpers.tsx` (`mockFetch`, `json`, `renderApp`, `OLGA`) | |
| `web/src/events/ownership.test.tsx` | Tests first: W-E2, W-E11, W-E13, W-E14 | W-E2, W-E11, W-E13, W-E14 |
| `web/src/events/CreateEventForm.test.tsx` | Tests first: W-E4, W-E6, W-E7; then W-E5, W-E8, W-E9, W-E20 | W-E4-W-E9 |
| `web/src/events/PublicEventPage.test.tsx` | Tests first: W-E17 (one case per status plus the order cases: cancelled and started, full and started); then W-E15, W-E16, W-E18 | W-E15-W-E18 |
| `web/src/events/EventsList.test.tsx`, `EventPage.test.tsx` | W-E1, W-E3, W-E10, W-E12, W-E21 | |
| `web/src/events/format.test.ts`, `validate.test.ts` | Limits (0, 1, 1440, 1441, 100000, 100001, `1.5`, `""`, `"1e3"`); start in the past and exactly now; `formatDateTime` with `"UTC"`; `localToIso` | W-E5, W-E19 |
| `docs/brand.md` | Add table and badge styles after the canvas is drawn | |
| `README.md`, `ROADMAP.md` | Routes, proxy change, steps 10-12 done | |

Tests follow `auth-web.md` section 4: Vitest globals, files next to the code, `fetch` replaced with the `mockFetch` helper, a fresh `QueryClient` per test (`retry: false`), `MemoryRouter`, only `@testing-library/react` (`fireEvent`, `findBy*`, `toBeTruthy()`). Mock `fetch` call counts prove the single calls (W-E1, W-E7, W-E14).

## 5. Done means

- Tests, typecheck and linter pass in `web/`.
- Every behaviour W-E1 to W-E22 has a test, or a note in the README that says it is not covered.
- W-E2, W-E4, W-E6, W-E7, W-E11, W-E13, W-E14 and W-E17 have their tests written and committed before the code (step 11 for the organizer ones, step 12 for W-E17).
- The mock `fetch` counts prove: one `GET /events` on the list, no event request while logged out or while `me` loads, one `POST /events` after a double click.
- A manual check against the real API (two organizers): create an event, see it in the list and on its page, open the other organizer's id and see the public view only, open `/event/{id}` logged out and see the same data, open a made-up id and get "Event not found".
- The README "Project status" says what works: no registration yet, seats left always equal capacity until M3, times shown in the viewer's zone.

## 6. Canvas boards

Boards for the design canvas, each at desktop and phone width. Names are the board titles.

| Board | States shown |
|---|---|
| Organizer / Events list | with 3 events (one Active, one Cancelled, one Ended); empty; loading; load error with Retry |
| Organizer / Create event | empty; filled; client errors on all four fields; form-level 400 error; pending ("Creating...") |
| Organizer / Event page | active with numbers; cancelled; ended; loading; load error with Retry; not found |
| Organizer / Session | wrong account (attendee on an organizer screen, exists in the auth canvas; reuse) |
| Public / Event page | Open; Full; Already started; Cancelled (closed); Ended (closed); loading; load error with Retry; not found |

The public boards use the attendee accent (teal) and the organizer boards the organizer accent (indigo). The header is the existing one, logged out and logged in.

## 7. Decisions on the open questions

No open questions are left.

1. Registration after the start (decided by the user): people can register while the event is running, until it ends (`registration.md` R11). Already started is therefore not a closed status. M2 shows no register button; the public view keeps the "Already started" status and M3 adds the button.
2. Badge colours: approved (user); they are in `brand.md`.
3. One link `/event/:id` for the public and the organizer view (D38). The owner sees the organizer view, everyone else the public view. The path is singular only to avoid the API path `/events/:id` on one origin.
4. Start time input: the native `datetime-local` is accepted, with the browser's own format and clock (no custom picker, no library). The canvas draws it that way.
5. A logged-in organizer keeps the organizer look on every screen, also on the public view (W-E22).
