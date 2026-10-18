# Spec: Register button, ticket with QR, scan screen and registration lists (web, M3 UI)

Feature spec for the register button, the ticket (with its QR code), the organizer scan screen and the two registration list routes, made from `SPEC_TEMPLATE.md` (sections 1-5). The API side is `registration.md` (R1-R22) and `api/openapi.yaml`; this file does not change them. Login, session, guards and the header are `auth-web.md` (reused as they are: `RequireRole`, `useMe`, `ApiError`, `request`). The event pages are `events-web.md`; this file replaces its "no register button in M2" (W-E17, last sentence) for Open, Full and Already started. Style values are `docs/brand.md`. Roadmap step 17. The QR and scan parts (W-R24 to W-R37) were added later; they are the web side of the check-in idea of M5 (`checkin.md`, `checkin-web.md`, B6) and are marked where they wait for the check-in API.

## 1. Goals and expected behaviour

**Goal.** A logged-in attendee registers for an event from its public page and sees their ticket (code, status, place on the waiting list). Attendees and organizers each get a registrations screen on its own route. The ticket page also shows a QR code of the ticket code, and the organizer has a camera scan screen that reads it for check-in. Nothing here cancels or sends email (M4), and no check-in request can be sent before the check-in API exists (M5).

**Known gap in the API (read this first).** The API has only `POST /events/{id}/registrations` and `GET /events/{id}/registrations/me` (one event at a time). It has **no** "list all my registrations" route and **no** organizer "list registrations of my event" route. The web cannot invent them (it remembers nothing, and a list of other people's registrations must come from the server). So:

- Behaviours marked **buildable now** use only the two existing routes (register button, ticket for one event, the routing rules) or no API at all (QR, camera, decoding, validation).
- Behaviours marked **blocked-until-API** need a new route, decided in a separate API spec step (open questions 1 and 2 for the lists, 10 for check-in, with a recommended answer each). Until then those two screens show a placeholder (W-R18, W-R20) and their tests are written as `it.todo`.

**Behaviours.** Each line is checked with a component test (`fetch` mocked). "Test first" ones get the test before the code. Ids are W-R1, W-R2, ...

*Register button and ticket on `/event/:id` (buildable now)*

| # | Behaviour | Test first? |
|---|---|---|
| W-R1 | The registration area is part of the **public view** only, and only for a logged-out viewer or an attendee. A logged-in organizer sees none, on the organizer view (own event) and on the public view of another organizer's event: no button, no text, no request to `/events/:id/registrations...`. | yes |
| W-R2 | Logged out (`me` is `null`), event not closed: the area shows a link (styled as the primary button) "Log in to register" to `/login?next=%2Fevent%2F{id}`; when `full` is true the link reads "Log in to join the waiting list". No registration request is made. After login W-A5 brings the person back to the event page. | |
| W-R3 | Attendee: once the public event and `me` have answered, the page calls `GET /events/:id/registrations/me` once (key `["registration", me.id, id]`, section 3), also for closed events (a ticket stays readable, R22). Answer 404 is **not an error**: it means "not registered" and is stored as `null`. Not called for logged-out viewers or organizers. | |
| W-R4 | Attendee without an active registration (`null`, or status `cancelled`), button by the public event: `status` `cancelled` or `passed` (W-E17 "closed"): **no button**, only "Registration is closed." (already shown by W-E17). Otherwise `full` true: button "Join waiting list"; else "Register" (also for Already started: R11). With a `cancelled` registration the button reads "Register again" instead of "Register" (R12); "Join waiting list" stays the same. | yes (closed cases and full label) |
| W-R5 | Click sends exactly one `POST /events/:id/registrations` (no body). While pending the button is disabled and reads "Registering..." (or "Joining..." for the waiting list); a second click sends no second request. (The server is also idempotent, R4/R5; the UI does not rely on it.) | yes |
| W-R6 | Success: both **201** (new) and **200** (already registered) put the answer into `["registration", me.id, id]` with `setQueryData` (no extra `GET .../me`), invalidate `["public-event", id]` (so "seats left" and `full` update) and show the ticket panel (W-R7). The two statuses are shown the same way: the text depends on the registration `status`, not on 200 or 201. | yes |
| W-R7 | Ticket panel by status (texts in section 2). `registered`: "You are registered" and the ticket code. `waitlisted`: "You are on the waiting list", "Your place: {waitlist_position}" and the ticket code. `cancelled`: "Registration cancelled" and the old ticket code marked as no longer valid. The panel is shown also when the event is Cancelled or Ended (R22) and has no button then. The panel has a link "View ticket" to `/registrations/me?event={id}`. | |
| W-R8 | The server decides the seat. If the page said "Register" but the server answers 201 `waitlisted` (someone took the last seat), the person sees the waiting list ticket as in W-R7, not an error and not a message about the mismatch. The fresh `["public-event", id]` then shows Full. | yes |
| W-R9 | Errors of the register call. 409 (`event_cancelled` or `event_passed`; both read from the status only): the area shows "Registration is closed.", the button goes away, `["public-event", id]` is invalidated so the status line becomes Cancelled or Ended. 404: invalidate `["public-event", id]`; the page then shows "Event not found" (W-E18). 401 or 403: invalidate `["me"]` and show no text of its own (W-E13): logged out turns into W-R2, an organizer role into W-R1. Network error or 5xx: "Something went wrong. Try again." in the area, button enabled again, no ticket. | yes (401/403, 409) |
| W-R10 | The registration read has its own states inside the area, the event details stay visible: pending shows "Loading..." (`role="status"`); network error or 5xx shows "Could not load your registration" and a Retry button that refetches only that query. No register button is shown in these two states (the person may already be registered). | yes (no button while loading or on error) |
| W-R11 | Ticket page `/registrations/me?event={id}` (attendee only, W-R15). Calls `GET /public/events/:id` (`["public-event", id]`) and `GET .../registrations/me` (`["registration", me.id, id]`) and shows: event title (link to `/event/{id}`), start, status line (W-E17 words), then the ticket as in W-R7 with the ticket code large and the status badge. No button on this page (register stays on the event page). | |
| W-R12 | Ticket page, other states. Public event 404 (any registration answer): "Event not found" + link home. Event found and registration `null`: "You have no ticket for this event." + link "Go to the event" (`/event/{id}`). Loading: "Loading..." until both have answered. Error: "Could not load your ticket" + Retry (refetches the failed ones). Missing or empty `event` parameter: see W-R18. | |
| W-R13 | 401 or 403 from any call on these screens invalidates `["me"]` and shows no text of its own (W-E13); the guard then redirects to the login with `next` or shows the wrong-account message. | yes |
| W-R14 | Header links for logged-in people (new, small): an attendee gets "My registrations" to `/registrations/me`; an organizer gets "Registrations" to `/registrations`. Logged out: no new link. | |

*Routing of the two list routes (buildable now: the redirects and guards need no list API)*

| # | Behaviour | Test first? |
|---|---|---|
| W-R15 | `/registrations/me` is the **attendee** screen. Attendee: shown. Logged out: redirect (replace) to `/login?next=` with the path **and query** (`/registrations/me?event=...` is kept). Organizer: redirect (replace) to `/registrations` (open question 4). While `me` loads: only "Loading..." (W-A2), no redirect and no list request. | yes |
| W-R16 | `/registrations` is the **organizer** screen. Organizer: shown. **Attendee: redirect (replace) to `/registrations/me`**, never the wrong-account message and no flash of the organizer screen. Logged out: redirect (replace) to `/organizer/login?next=%2Fregistrations` (open question 3). While `me` loads: only "Loading..." and no redirect. `me` network error or 5xx: "Could not check your login" + Retry (W-A3). | yes |
| W-R17 | No redirect loop: each route redirects only the other role, to a route the other role may open (attendee to `/registrations/me`, organizer to `/registrations`). A test opens both routes in both roles and counts that each ends on the right screen after one redirect. The redirects make no request except `GET /auth/me`. The query part of an organizer's `/registrations?event=...` is dropped when an attendee is redirected (an organizer event id means nothing to an attendee). | yes |

*List screens (blocked-until-API unless said)*

| # | Behaviour | Test first? |
|---|---|---|
| W-R18 | Attendee list (`/registrations/me` without `event`): **blocked-until-API** (question 1). Until then the screen is a card with `h1` "My registrations" and "The list is not built yet." (as the earlier placeholders) and no request. Once the route exists: one call (key `["registrations", me.id]`), one row per registration in the API order (the client does not sort): event title (link to `/registrations/me?event={event_id}`), starts, ticket status ("Registered", "Waiting list: place {n}", "Cancelled"), ticket code. Empty: "You have no registrations yet." + link "Go home" (`/`). Loading, error with Retry: as W-R10/W-R12 ("Could not load your registrations"). | empty list yes |
| W-R19 | The attendee list never shows another person's registration and never an organizer's data (the server filters by cookie, R19; the web adds no filter). Registering (W-R6) also invalidates `["registrations", me.id]` once the list exists. | |
| W-R20 | Organizer screen (`/registrations`): **blocked-until-API** (question 2). Until then a card with `h1` "Registrations" and "The list is not built yet." and no request. Once the route exists: the screen loads the organizer's events (`GET /events`, key `["events"]`, already built) for an event selector (default: the `event` query parameter, else the first event), then the registrations of the chosen event (key `["event-registrations", id]`). Columns: Name, Email, Status ("Registered", "Waiting list"), Place, Ticket code, Registered (date and time, W-E19). Rows in API order. | |
| W-R21 | Organizer screen states (when unblocked): no events at all: "You have no events yet." + link "Create event"; event with nobody: "No one has registered for this event yet."; loading "Loading..."; error "Could not load registrations" + Retry; event 404 (not theirs, W-E11 style): "Event not found". Other organizers' registrations are never reachable. | no-events and 404 yes |

*Cross-cutting*

| # | Behaviour | Test first? |
|---|---|---|
| W-R22 | Accessibility: the register control is a real `<button>` (or an `<a>` for login); pending sets `disabled` and `aria-busy="true"`; the ticket panel and its `h2` are a `section` labelled by the heading; the result of a register call is announced (`role="status"` on the ticket panel container, `role="alert"` on errors); after success focus moves to the ticket `h2` (`tabIndex={-1}`), after an error to the error text; status is text, never colour alone; the ticket code is plain selectable text (not an image); each screen has one `h1` (the event title on the event page, "Your ticket" on the ticket page, the list titles on the lists); the lists are real `<table>` with `<th scope="col">`. | |
| W-R23 | Cache safety: registration data is keyed by `me.id`, so a second account in the same browser tab session never sees the first one's ticket. Logout already removes all non-`me` queries (W-A9). | yes |

*QR code on the ticket page (buildable now; the QR is drawn in the browser, no API)*

| # | Behaviour | Test first? |
|---|---|---|
| W-R24 | The QR content is **the ticket code only**: plain text of the 10 characters, no URL, no prefix, no name, email, id or event data. It is made in the browser from `registration.ticket_code` by one pure function `qrModules(code)` (a square matrix of dark/light modules; for 10 characters at error level M it is 21 x 21). The component draws it as an inline `<svg>` from the matrix (no `innerHTML`, no image file, no data URL). The test checks the matrix size and that the encoded text equals the code. | yes |
| W-R25 | The QR is shown on the **ticket page only** (not in the event page panel, W-R7) and only when the registration is `registered`, `checked_in_at` is `null` and the event is not Cancelled. Not shown for `waitlisted` (a place is not entry), `cancelled`, or a Cancelled event: there the code text stays and nothing else is added. A checked-in ticket (`checked_in_at` set) shows the line "Checked in" (also in the event page panel, via `ticketLabel`), the code as text and **no QR** (it can no longer be used; the time is not shown). A `registered` ticket on an Ended event still shows the QR. | yes |
| W-R26 | Scannable and accessible: dark modules `#101C1A` on a white square, a quiet zone of 4 modules inside the white square, drawn at least 200 x 200 px (fluid down to 160 px on a phone, never smaller, `shape-rendering="crispEdges"`), also on the ground colour and in the card. The svg has `role="img"` and `aria-label="QR code for ticket {code}"`; the ticket code stays visible as selectable text next to it (W-R22) with the hint "If the scan does not work, show the ticket code." | |
| W-R27 | No network for the QR: drawing it makes no `fetch` (the test counts calls before and after render and after a re-render). Once the ticket page has loaded it keeps showing the QR without a connection (no service worker, no refetch needed to draw it; reload offline is out of scope). | yes |

*Organizer scan screen `/registrations/scan` (camera, decoding and validation buildable now; the request and result parts blocked-until-API, question 10)*

| # | Behaviour | Test first? |
|---|---|---|
| W-R28 | Route and guard: `/registrations/scan` is an organizer screen with the same entry rules as `/registrations` (W-R16): organizer shown; attendee redirect (replace) to `/registrations/me`; logged out redirect to `/organizer/login?next=%2Fregistrations%2Fscan`; "Loading..." while `me` loads, no camera request before the guard accepts. The `/registrations` screen (placeholder or list) has a link "Check in attendees" to it (keeps the `event` parameter). W-R17 gets this route in its test. | yes |
| W-R29 | Event selector: label "Event", options from `GET /events` (key `["events"]`, already built); default the `event` query parameter if it is in the list, else the first event. No events: "You have no events yet." + link "Create event", no camera. Events error: "Could not load events" + Retry. The chosen event id is the one the check-in is sent for (W-R33). | |
| W-R30 | Camera states (`getUserMedia({ video: { facingMode: "environment" } })`). The camera starts only after a click on "Start camera" (no permission prompt on page load). Shown: **asking** "Waiting for camera permission..." (`role="status"`); **active** live preview and "Point the camera at the ticket QR code."; **denied** (`NotAllowedError`, `SecurityError`) "Camera access is blocked. Allow the camera in your browser settings, or enter the code below."; **no camera** (`NotFoundError`, `OverconstrainedError`) "No camera found. Enter the code below."; **insecure** (`window.isSecureContext` false or no `navigator.mediaDevices`; checked before asking) "The camera needs a secure connection (https or localhost). Enter the code below."; **other** (`NotReadableError`, anything else) "Could not start the camera." + "Try again". In every non-active state the manual form (W-R32) stays usable. | yes (denied, no camera, insecure) |
| W-R31 | Decoding and validation: the decoder (one small function behind `scanner.ts`, W-R37) gives text; the text is trimmed and checked against `^[A-HJ-NP-Z2-9]{10}$` by one pure function `parseTicketCode(text)` (returns the code or `null`) **before any request**. Not matching (a URL, other QR, wrong alphabet, wrong length): no request, message "This is not a ticket code." (`role="alert"`), scanning goes on; the same wrong text again changes nothing. The same function validates the manual entry after upper-casing and removing spaces. | yes |
| W-R32 | Manual entry fallback: always visible under the camera: input label "Ticket code" (autocapitalize characters, `autocomplete="off"`, `spellcheck="false"`, `inputmode="text"`) and a button "Check in". Empty or invalid: field error "Enter a valid ticket code: 10 characters, A-Z without I and O, and 2-9." and no request. Valid: goes through the same submit path as a scan (W-R33). | yes (invalid, no request) |
| W-R33 | One request per code: the first valid code (scan or typed) sends exactly one `POST` for the chosen event (question 10) and **pauses decoding**; frames and repeated reads of the same code while the request is pending or the result is shown send nothing; the manual button is disabled and `aria-busy="true"` while pending. Decoding restarts only after "Scan next". The decoder mock fires the same code 5 times in a row and the test counts one request. Submit logic is written against a `submitCode(eventId, code)` function; until the API exists the test uses a stub that counts calls (so the dedupe test is buildable now; the real `fetch` wiring is blocked). | yes |
| W-R34 | Result states (**blocked-until-API**, mapping proposed in question 10; texts in section 2): valid (200) "Checked in" + the code; already checked in (409 `already_checked_in`) "Already checked in"; not found or another event (404) "Ticket not found for this event."; not valid (409 `not_registered`: waiting or cancelled ticket) "This ticket is not valid."; event cancelled (409 `event_cancelled`) "This event is cancelled."; network error or 5xx "Something went wrong. Try again." + "Try again" (resends the same code, one request) ; 401 or 403 as W-R13. Result in `role="status"` (errors `role="alert"`), focus moves to the result heading, and a "Scan next" button clears it. Status is text, never colour alone. Tests are `it.todo` with question 10 until the API exists. | valid and already checked in yes |
| W-R35 | Camera is released: the stream's tracks are stopped (`track.stop()`) when the person leaves the screen (unmount, route change, logout), when the event selector changes, and when an unmount happens while permission is still being asked (the late stream is stopped at once). The test checks `stop` was called on every track in each case. | yes |
| W-R36 | Accessibility of the scan screen: one `h1` "Check in"; the video has `aria-label="Camera preview"` and `playsInline muted`; start and scan-next are real `<button>`s at least 48px; every camera state is text, not colour; the whole screen works with the keyboard and without a camera (manual form is the full alternative). | |
| W-R37 | The decoder is isolated: `web/src/registrations/scanner.ts` exports `startScanner(video, onText)` returning `stop()`; it holds the frame loop (canvas + the decoder library) and nothing else. Component tests mock this module with `vi.mock` (jsdom has no camera, no canvas decoding), call `onText` by hand, and never import the library. `parseTicketCode` and `qrModules` are tested as pure functions without mocks. The real camera read is checked by hand (section 5). | |

**Out of scope.** Cancelling a registration (M4); promoting from the waiting list and its email (M4); the arrivals counter and its updates (M5/B7, `checkin-web.md`); the check-in API itself; showing the check-in time (only the word "Checked in"); a QR on the event page, in email or as a downloadable image; email UI or "resend ticket"; downloading or printing; torch, zoom or choosing between cameras; scanning from an image file; offline queue of check-ins; a service worker; registering for someone else or with no account; paging, search, filters and sorting of the lists; live updates or polling (the place on the waiting list is a snapshot, refreshed by reload, Retry or the next fetch); a public list of events; translations; dark theme.

**Assumptions.** Change any of these first in this file.
- UI is a convenience; the API is the guard (R15, R20, R19). The web never sends a user id.
- Web paths must not equal API paths on one origin (events-web assumption). `/registrations` and `/registrations/me` are not API routes today, so they are free. A **future** API route must not be `GET /registrations` or `GET /registrations/me` (questions 1 and 2 avoid it).
- The tool for "is the event closed" is `publicStatus` (W-E17) on the public event, never a date comparison in the browser. Closed means `cancelled` or `passed`; Already started stays registrable (R11).
- The QR holds the ticket code only, so a screenshot of it is as secret as the code (the code is also printed beside it). Check-in validity is decided by the server (B6), never by the QR or the browser.
- Camera access needs a secure context (https or `localhost`); the dev server on `localhost` works, a phone on a LAN address over plain http does not (W-R30 shows the message).
- A registration `cancelled` can only appear after M4 (or by SQL); it is specified now because the read route can answer it (R22) and the web must not break on it.
- The 404 of `GET .../registrations/me` means "not registered" only when the public event exists. The ticket page proves that by also loading the public event (`registration.md` assumptions).
- The registration shape has no event details; the web gets title and time from `["public-event", id]` (`registration.md` assumptions).
- Queries use `retry: false` and `refetchOnWindowFocus: false` as in events-web. The registration query is not `staleTime: Infinity`: the default (0) is kept, so opening the page again refetches; a seat or place can change.

## 2. UI decisions

| Route | Who sees it | API route | Query key | What it shows and does |
|---|---|---|---|---|
| `/event/:id` (public view) | Everyone; registration area only for logged-out and attendee (W-R1) | `GET /events/:id/registrations/me`, `POST /events/:id/registrations` | `["registration", me.id, id]`; mutation | Registration area under the seats line: login link, button, ticket panel, states (W-R2-W-R10). |
| `/registrations/me?event={id}` | Attendees (guard W-R15) | the same two routes + `GET /public/events/:id` | `["registration", me.id, id]`, `["public-event", id]` | The ticket page (W-R11, W-R12). |
| `/registrations/me` (no `event`) | Attendees | **new, blocked** (question 1) | `["registrations", me.id]` | List of my registrations, or the placeholder (W-R18). |
| `/registrations` | Organizers (guard W-R16) | **new, blocked** (question 2) | `["events"]`, `["event-registrations", id]` | Registrations of one of my events, or the placeholder (W-R20, W-R21), and the link "Check in attendees". |
| `/registrations/scan?event={id}` | Organizers (guard W-R28) | `GET /events` now; check-in **new, blocked** (question 10) | `["events"]`; mutation | Camera scan and manual code entry for check-in (W-R28-W-R37). |

**Registration area on the event page.** It is a block under the status and seats lines (an `h2` "Registration" is not needed; the ticket panel has its own `h2`). What is shown, first match wins, for an attendee:

| Public event | My registration | Shows |
|---|---|---|
| any | pending | "Loading..." |
| any | error | "Could not load your registration" + Retry |
| any | `registered` | ticket panel "You are registered", no button |
| any | `waitlisted` | ticket panel "You are on the waiting list", no button |
| closed | `null` | "Registration is closed." only (W-E17 text, shown once) |
| closed | `cancelled` | ticket panel "Registration cancelled", "Registration is closed.", no button |
| open or started | `null` | button "Register" |
| open or started | `cancelled` | ticket panel "Registration cancelled" and button "Register again" |
| full | `null` | text "This event is full." and button "Join waiting list" |
| full | `cancelled` | ticket panel "Registration cancelled", "This event is full." and button "Join waiting list" |

Logged out: the login link of W-R2 for open, started and full; for closed events only "Registration is closed.". Organizer: nothing (W-R1).

**Texts.**

| Where | Text |
|---|---|
| Buttons | "Register" / "Registering..."; "Register again"; "Join waiting list" / "Joining..." |
| Login links | "Log in to register"; "Log in to join the waiting list" |
| Full hint | "This event is full." |
| Ticket panel `h2` | "You are registered"; "You are on the waiting list"; "Registration cancelled" |
| Ticket panel lines | "Ticket code" + code; "Your place: {n}"; "This ticket is no longer valid." (cancelled) |
| Panel link | "View ticket" (to the ticket page) |
| Closed | "Registration is closed." |
| Read error | "Could not load your registration" + Retry |
| Register 409 | "Registration is closed." |
| Register network or 5xx | "Something went wrong. Try again." |
| Ticket page | no role eyebrow (`role-eyebrow.md` RE1), `h1` "Your ticket"; "No ticket": "You have no ticket for this event." + "Go to the event"; error "Could not load your ticket" |
| Ticket QR | `h3` "Check-in code"; "Show this QR code at the entrance."; "If the scan does not work, show the ticket code."; svg label "QR code for ticket {code}"; checked in: "Checked in" (no QR) |
| Scan screen | `h1` "Check in"; label "Event"; "Start camera"; "Waiting for camera permission..."; "Point the camera at the ticket QR code."; "Camera access is blocked. Allow the camera in your browser settings, or enter the code below."; "No camera found. Enter the code below."; "The camera needs a secure connection (https or localhost). Enter the code below."; "Could not start the camera." + "Try again"; "Or enter the code" (`h2`), label "Ticket code", button "Check in" / "Checking..."; "This is not a ticket code."; "Enter a valid ticket code: 10 characters, A-Z without I and O, and 2-9."; "Scan next"; link on `/registrations` "Check in attendees" |
| Scan results | "Checked in"; "Already checked in"; "Ticket not found for this event."; "This ticket is not valid."; "This event is cancelled."; "Something went wrong. Try again."; "Could not load events" + Retry; "You have no events yet." + "Create event" |
| Not found | "Event not found" + "This link is not valid or the event does not exist." (as events-web) |
| Lists (blocked) | attendee: `h1` "My registrations", "You have no registrations yet.", "Go home", "Could not load your registrations"; organizer: `h1` "Registrations", "No one has registered for this event yet.", "Could not load registrations" |
| Placeholders | "The list is not built yet." |
| Header | "My registrations" (attendee), "Registrations" (organizer) |

Ticket status text on lists and badges: "Registered", "Waiting list", "Cancelled", and on a checked-in ticket the extra line "Checked in". Scan result badges: "Checked in" like Active/Open, "Already checked in" like Ended, "not found/not valid/cancelled" like Cancelled (all with their text). The QR sits in a white square inside the ticket card (the card is already white; the square keeps its quiet zone in any context). Badge colours reuse `brand.md`: Registered like Active/Open, Waiting list like Full, Cancelled like Cancelled. Date and time in the list and ticket page use `formatDateTime` (W-E19).

**States on every screen.**
- Loading: "Loading..." status (registration area, ticket page, lists); button label while registering.
- Error: read failure with Retry (area, ticket page, lists); register errors in the area.
- Empty: both lists (W-R18, W-R21).
- Not found: event page and ticket page (event); organizer list (event).
- Full / closed: the area table above.
- Scan screen: camera idle, asking, active, denied, no camera, insecure, other error; per-scan pending and the result states (W-R30, W-R34); no events; manual form always available.
- Wrong role: redirects (W-R15-W-R17, W-R28), no wrong-account page on these two routes; other guarded screens keep W-A6.

## 3. Architecture decisions

- **Apps:** `web/` only. React 19, Vite, TypeScript, TanStack Query, `react-router`. No new library for W-R1-W-R23; the QR and scan parts need two small libraries (a QR encoder and a QR decoder), **only after question 9 is answered**. No API change, no proxy change (`/events` and `/public` are proxied already; a new API prefix would need one line in `vite.config.ts`, noted in questions 1 and 2).
- **API client** `web/src/registrations/api.ts`, built on `request` from `auth/api.ts` and the same `body` idea as `events/api.ts`. Type `Registration = { id, event_id, status: "registered" | "waitlisted" | "cancelled", ticket_code, waitlist_position: number | null, checked_in_at: string | null, created_at }` (as `openapi.yaml`). Functions: `getMyRegistration(eventId)` returns the registration or **`null` on 404** (like `fetchMe` with 401), throws `ApiError(status)` otherwise; `register(eventId)` is `POST` with no body and returns the registration (201 and 200 are both `ok`; the status code is not needed by the UI). Blocked functions (`listMyRegistrations`, `listEventRegistrations`) are added with their API step, not before.
- **Hooks** in `web/src/registrations/queries.ts`: `useMyRegistration(eventId, enabled)` (enabled only for an attendee with a known `me`, so no request for others, W-R1/W-R3), `useRegister(eventId)`. Keys: `["registration", meId, eventId]`, `["public-event", id]` (existing), `["registrations", meId]` and `["event-registrations", eventId]` (blocked). A shared `onApiError` is the one of events-web: 401/403 invalidate `["me"]`.
- **Register flow:** `useMutation`; `onSuccess(registration)`: `setQueryData(["registration", meId, id], registration)`, `invalidateQueries({ queryKey: ["public-event", id], exact: true })` (seats left, `full`), and, when the list exists, `invalidateQueries({ queryKey: ["registrations", meId], exact: true })`. `onError`: by `error.status` as W-R9 (409 also invalidates `["public-event", id]`). The button is disabled by `isPending`; no optimistic update (the seat is decided by the server, W-R8).
- **Ticket status:** one pure function `ticketLabel(registration)` returning the heading and detail lines of W-R7, so the event page, the ticket page and the lists share the words. The button choice is one pure function `registerAction(publicEvent, registration)` returning `"none" | "register" | "register-again" | "waitlist"` following the table in section 2 and `publicStatus` (events-web); tests call it directly for every row.
- **Guards and redirects:** a small `RegistrationsEntry` component for `/registrations` and one for `/registrations/me` in `web/src/registrations/entries.tsx`. They reuse `useMe` and the same loading and error states as `MeGate` (export `MeGate` from `auth/guards.tsx`, no behaviour change). `/registrations/me`: attendee shows the screen; logged out `Navigate` to `/login?next=` (path plus search, as `RequireRole`, W-A4); organizer `Navigate to="/registrations" replace`. `/registrations`: organizer shows the screen; attendee `Navigate to="/registrations/me" replace`; logged out `Navigate` to `/organizer/login?next=`. The screens are plain children, so they do not run any query before the guard accepts. `RequireRole` cannot be used as is for `/registrations` because it shows the wrong-account page instead of redirecting (W-A6).
- **Event page integration:** `PublicEventPage` renders `<RegistrationArea event={...} />` after the seats line. The area reads `me` (already loaded by `EventPage`, W-E10), so it adds no `me` call. `PublicEventPage` for an organizer viewer renders the area as nothing (W-R1).
- **Ticket page:** reads `event` with `useSearchParams`. Both queries start together (no waterfall); the result is drawn after both have settled.
- **Styling:** `styles.css` and `brand.md`: the card for the ticket panel (surface, 1px border, radius 12), the code in a larger Public Sans 700 line with letter spacing, badges as in `brand.md`. The ticket and list screens are not in the design canvas yet; section 6 is the input for it. `brand.md` "Not decided yet" gets updated when the canvas is drawn.
- **QR:** `qr.ts` has `qrModules(code)` (wraps the encoder: error level M, byte mode, returns `boolean[][]`) and `QrCode.tsx` draws the svg from it (one `<path>` of dark squares or one `<rect>` per module, white background rect with the 4-module quiet zone). `TicketPage` renders it through `showQr(registration, publicEvent)` (pure, W-R25) in the ticket panel, never `RegistrationArea`.
- **Scanner:** `scanner.ts` `startScanner(video, onText): () => void` asks nothing itself; `ScanScreen` calls `navigator.mediaDevices.getUserMedia`, sets `video.srcObject`, hands the video to `startScanner` (a `requestAnimationFrame` loop, a canvas, the decoder on `ImageData`, throttled to about 5 reads per second) and keeps the `MediaStream` to stop its tracks (W-R35). Camera errors are mapped by one pure function `cameraState(error | undefined)` returning `"denied" | "none" | "insecure" | "other"` (tested for each `DOMException` name, W-R30). The screen state is a small reducer: `idle -> asking -> active -> pending -> result -> active`, so "pending" and "result" both pause decoding (W-R33).
- **Check-in call (blocked):** `checkIn(eventId, ticketCode)` in `registrations/api.ts` and `useCheckIn(eventId)` in `queries.ts` are added with the check-in API step (question 10). Until then `ScanScreen` takes `submitCode` as a prop, defaulting to a function that throws "not built"; tests give it a stub. On success it invalidates nothing now (the arrivals counter is `checkin-web.md`).
- **Guard for the unblocked part only:** nothing in this step depends on the missing routes; the blocked screens are placeholders, so steps 17 code can be finished and committed without the API.

## 4. Files to touch

| File | What to do | Behaviours |
|---|---|---|
| `web/src/registrations/api.ts` | `Registration` type, `getMyRegistration` (404 is `null`), `register` | W-R3, W-R5, W-R6 |
| `web/src/registrations/queries.ts` | `useMyRegistration`, `useRegister`, keys, `onApiError` reuse, invalidations | W-R3, W-R6, W-R9, W-R13, W-R23 |
| `web/src/registrations/ticket.ts` | `ticketLabel`, `registerAction` (pure) | W-R4, W-R7 |
| `web/src/registrations/RegistrationArea.tsx` | Area on the event page: login link, button, ticket panel, states, errors, focus | W-R1-W-R10, W-R22 |
| `web/src/registrations/TicketPanel.tsx` | Ticket panel (shared by the event page and the ticket page) | W-R7, W-R11 |
| `web/src/registrations/TicketPage.tsx` | Ticket page `/registrations/me?event=` | W-R11-W-R13 |
| `web/src/registrations/entries.tsx` | The two route entries with redirects, plus the entry for `/registrations/scan` | W-R15-W-R17, W-R28 |
| `web/src/registrations/qr.ts`, `QrCode.tsx` | `qrModules`, svg component, `showQr` | W-R24-W-R27 |
| `web/src/registrations/ticketCode.ts` | `parseTicketCode` (pure) | W-R31, W-R32 |
| `web/src/registrations/scanner.ts` | `startScanner(video, onText)`, the only file that imports the decoder; `cameraState` | W-R30, W-R37 |
| `web/src/registrations/ScanScreen.tsx` | Scan screen: selector, camera, manual form, result, release of the camera | W-R28-W-R36 |
| `web/package.json` | Add the encoder, the decoder and encoder types **only after question 9** | W-R24, W-R31 |
| `web/src/registrations/MyRegistrations.tsx`, `OrganizerRegistrations.tsx` | Placeholders now; lists after the API steps (blocked) | W-R18-W-R21 |
| `web/src/events/PublicEventPage.tsx` | Mount `RegistrationArea`; remove the "no registration text in M2" rule | W-R1, W-R2 |
| `web/src/auth/guards.tsx` | Export `MeGate` (no behaviour change) | W-R15, W-R16 |
| `web/src/auth/Header.tsx` | Role link "My registrations" / "Registrations" for logged-in people | W-R14 |
| `web/src/App.tsx` | Add `/registrations` and `/registrations/me` | W-R15-W-R17 |
| `web/src/styles.css` | Ticket panel, code line, button row | |
| `web/src/registrations/test-helpers.ts` | `registration()` builder (status, code, position); reuse `events/test-helpers.ts` and `auth/test-helpers.tsx` (`mockFetch`, `json`, `renderApp`, `OLGA`) | |
| `web/src/registrations/entries.test.tsx` | **Tests first:** W-R15, W-R16, W-R17 (both roles, both routes, logged out, loading, count of requests) | W-R15-W-R17 |
| `web/src/registrations/RegistrationArea.test.tsx` | **Tests first:** W-R1, W-R4 (every row of the table), W-R5 (double click, one POST), W-R6 (201, 200, seat refetch), W-R8, W-R9 (409, 401, 403), W-R10; then W-R2, W-R3, W-R7, W-R22, W-R23 | W-R1-W-R10, W-R22, W-R23 |
| `web/src/registrations/TicketPage.test.tsx` | W-R11-W-R13; QR cases (shown, not shown for waitlisted, cancelled, Cancelled event, checked in; no fetch) | W-R11-W-R13, W-R25-W-R27 |
| `web/src/registrations/qr.test.ts`, `ticketCode.test.ts` | **Tests first:** `qrModules` size and text, `parseTicketCode` (valid, lower case, spaces, I, O, 0, 1, length 9 and 11, URL), `cameraState` | W-R24, W-R30, W-R31 |
| `web/src/registrations/ScanScreen.test.tsx` | **Tests first:** W-R28 guard (in `entries.test.tsx`), W-R30 denied, no camera, insecure; W-R31 no request on invalid text; W-R33 five reads of one code give one `submitCode` call, double click on the manual button; W-R35 `stop` on unmount and while asking; then W-R29, W-R32, W-R36. `scanner.ts` and `getUserMedia` are mocked. Result cases W-R34 are `it.todo` (question 10) | W-R28-W-R37 |
| `web/src/registrations/ticket.test.ts` | `registerAction` all rows; `ticketLabel` for the three statuses and position 1, 2 | W-R4, W-R7 |
| `web/src/events/PublicEventPage.test.tsx`, `web/src/auth/Header.test.tsx` | Update the cases that said "no register control" (W-E17) and the header link cases | W-E17, W-R14 |
| `docs/brand.md` | Ticket and list styles after the canvas | |
| `README.md`, `ROADMAP.md` | Routes, what works, what is blocked (user edits) | |

Tests follow `auth-web.md` section 4 and `events-web.md` section 4: Vitest globals, files next to the code, `mockFetch`, a fresh `QueryClient` per test (`retry: false`), `MemoryRouter`, only `@testing-library/react`. Mock call counts prove the single calls (W-R5, W-R3, W-R17).

## 5. Done means

- Tests, typecheck and linter pass in `web/`.
- Every buildable behaviour (W-R1 to W-R17, W-R22 to W-R33, W-R35 to W-R37) has a test. W-R18 to W-R21 and W-R34 are `it.todo` with the question number, and the README says the two lists and the check-in result wait for the API.
- QR and scan: tests first for `qrModules`, `parseTicketCode`, `showQr`, camera denied/no camera/insecure, one request per code and stopping the camera. No component test imports the decoder library or touches a real camera.
- Manual check of the camera and QR (not testable in jsdom): the ticket page QR scanned with a phone camera app shows exactly the ticket code; the scan screen on `localhost` reads the QR from a phone screen and a printout, asks for permission after "Start camera", shows the denied message after "Block", releases the camera light when leaving the page; on a plain http LAN address the insecure message appears.
- Tests written and committed before the code: the redirects (`entries.test.tsx`: W-R15-W-R17), then the area tests (W-R1, W-R4, W-R5, W-R6, W-R8, W-R9, W-R10).
- Mock `fetch` counts prove: exactly one `POST` after a double click; no registration request for logged-out viewers and organizers; no `GET /events/:id/registrations/me` before `me` has answered; one `GET /auth/me` and no list request on a redirect; one fetch of `["public-event", id]` more after a successful register.
- A manual check against the real API: attendee A registers (ticket code shown, seats left goes down by one), reload still shows the ticket; with capacity 1, attendee B registers and gets "You are on the waiting list" with place 1; logged out the event page shows "Log in to register" and comes back after login; an organizer sees no button; a cancelled or ended event shows "Registration is closed." and no button; a made-up id gives "Event not found"; an attendee opening `/registrations` lands on `/registrations/me`; an organizer opening `/registrations/me` lands on `/registrations`.
- The README "Project status" says: register and ticket work; the two registration lists are placeholders until the API routes exist; the ticket page shows a QR code; the organizer scan screen opens the camera and checks the code format, but sending the check-in waits for the API; no cancel or email UI.

## 6. Screens for a visual mock-up

Each screen at desktop and phone width. The header is the existing one (logged out; attendee with the extra link "My registrations"; organizer with "Registrations"). Attendee screens use the teal accent, organizer screens the indigo accent. Sample data: event "Spring Meetup", "Sat, 1 Jan 2030, 10:00 CET" to "11:30 CET", "1 h 30 min", capacity 25.

**S1. Event page (public view) with the registration area.** Eyebrow "Event", `h1` "Spring Meetup", description, status badge, Starts, Ends, Duration, seats line, then the area. States:

| State | Status badge | Seats line | Area |
|---|---|---|---|
| Logged out, open | Open | "12 of 25 seats left" | link button "Log in to register" |
| Logged out, full | Full | "0 of 25 seats left" | "This event is full." + link button "Log in to join the waiting list" |
| Logged out, closed (Ended) | Ended | "Capacity: 25" | "Registration is closed." |
| Attendee, not registered, open | Open | "12 of 25 seats left" | button "Register" |
| Attendee, not registered, already started | Already started | "12 of 25 seats left" | button "Register" (no closed text) |
| Attendee, not registered, full | Full | "0 of 25 seats left" | "This event is full." + button "Join waiting list" |
| Attendee, registering | Open | "12 of 25 seats left" | disabled button "Registering..." (waiting list: "Joining...") |
| Attendee, registered | Open | "11 of 25 seats left" | panel: `h2` "You are registered", "Ticket code" `K7M2QX9TPA`, link "View ticket" |
| Attendee, waitlisted | Full | "0 of 25 seats left" | panel: `h2` "You are on the waiting list", "Your place: 3", "Ticket code" `H4Z8WR5NCD`, link "View ticket" |
| Attendee, cancelled ticket, event open | Open | "12 of 25 seats left" | panel: `h2` "Registration cancelled", "Ticket code" `K7M2QX9TPA`, "This ticket is no longer valid.", button "Register again" |
| Attendee, cancelled ticket, event closed | Cancelled or Ended | no count, "Capacity: 25" | the cancelled panel and "Registration is closed.", no button |
| Attendee, ticket on a closed event | Ended | "Capacity: 25" | the registered or waiting panel, no button |
| Loading registration | any | any | "Loading..." |
| Registration read error | any | any | "Could not load your registration" + Retry |
| Register 409 | Open until refresh | any | "Registration is closed." (button gone) |
| Register network or 5xx | Open | any | "Something went wrong. Try again." above the enabled button |
| Organizer (own or other event) | any | organizer: numbers; public: seats line | no registration area |

Other event-page states (loading, error, not found) are in `events-web.md` section 6.

**S2. Ticket page `/registrations/me?event={id}`.** No role eyebrow (RE1), `h1` "Your ticket". Event title (link), "Starts", status badge, then the ticket panel. States:

| State | Content |
|---|---|
| Registered | panel "You are registered", "Ticket code" `K7M2QX9TPA` (large), badge "Registered", then `h3` "Check-in code", the QR (white square 200 px, 4-module quiet zone, centred), "Show this QR code at the entrance.", "If the scan does not work, show the ticket code." |
| Registered, checked in | panel "You are registered", code, badge "Registered", line "Checked in", no QR |
| Waiting list | panel "You are on the waiting list", "Your place: 3", "Ticket code" `H4Z8WR5NCD`, badge "Waiting list" |
| Cancelled | panel "Registration cancelled", code, "This ticket is no longer valid.", badge "Cancelled" |
| Event cancelled or ended with a ticket | the same panel plus the event badge "Cancelled" or "Ended" |
| Never registered | "You have no ticket for this event." + link "Go to the event" |
| Event not found | "Event not found", "This link is not valid or the event does not exist.", link home |
| Loading | "Loading..." |
| Error | "Could not load your ticket" + Retry |

**S3. Attendee list `/registrations/me` (blocked until the API).** No role eyebrow (RE1), `h1` "My registrations". Table columns: Event, Starts, Status, Ticket code. Rows: "Spring Meetup" / "Sat, 1 Jan 2030, 10:00 CET" / "Registered" / `K7M2QX9TPA`; "Autumn Fair" / ... / "Waiting list: place 3" / `H4Z8WR5NCD`; "Old Talk" / ... / "Cancelled" / `P3D6FJ2VBM`. States: empty "You have no registrations yet." + "Go home"; loading "Loading..."; error "Could not load your registrations" + Retry; placeholder (now) "The list is not built yet."

**S4. Organizer registrations `/registrations` (blocked until the API).** No role eyebrow (RE1), `h1` "Registrations". Event selector (label "Event"), then a table: Name, Email, Status, Place, Ticket code, Registered. Rows: "Olga Test" / `olga@example.com` / "Registered" / empty / `K7M2QX9TPA` / date; "Ivan Test" / `ivan@example.com` / "Waiting list" / "1" / `H4Z8WR5NCD` / date. States: no events "You have no events yet." + "Create event"; nobody registered "No one has registered for this event yet."; loading "Loading..."; error "Could not load registrations" + Retry; event not found "Event not found"; placeholder (now) "The list is not built yet."

**S5. Redirects (no own screen).** Attendee on `/registrations` ends on S3/S2 (one redirect); organizer on `/registrations/me` ends on S4; logged out goes to the login pages with `next`; "Loading..." and "Could not check your login" as in the auth canvas. The organizer on `/registrations/scan` follows the same rule (attendee to S3/S2, logged out to the organizer login).

**S6. Scan screen `/registrations/scan` (organizer, indigo accent).** No role eyebrow (RE1), `h1` "Check in". Selector "Event" (value "Spring Meetup"). A camera area (4:3 preview, max 480 px wide) with the button "Start camera"; under it the `h2` "Or enter the code", label "Ticket code", input, button "Check in". Result card under the camera. States:

| State | Content |
|---|---|
| Idle | empty camera area with "Start camera" |
| Asking | "Waiting for camera permission..." |
| Active | live preview, "Point the camera at the ticket QR code." |
| Denied | "Camera access is blocked. Allow the camera in your browser settings, or enter the code below." |
| No camera | "No camera found. Enter the code below." |
| Insecure | "The camera needs a secure connection (https or localhost). Enter the code below." |
| Other error | "Could not start the camera." + "Try again" |
| Not a ticket code (scan) | "This is not a ticket code." over the active preview |
| Invalid typed code | field error "Enter a valid ticket code: 10 characters, A-Z without I and O, and 2-9." |
| Sending | preview paused, "Checking..." on the manual button (disabled) |
| Checked in | badge "Checked in", code `K7M2QX9TPA`, "Scan next" |
| Already checked in | badge "Already checked in", code, "Scan next" |
| Not found | "Ticket not found for this event." + "Scan next" |
| Not valid | "This ticket is not valid." + "Scan next" |
| Event cancelled | "This event is cancelled." + "Scan next" |
| Request failed | "Something went wrong. Try again." + "Try again" |
| No events | "You have no events yet." + "Create event" |
| Events error | "Could not load events" + Retry |
| Loading | "Loading..." |

Phone width matters most here (the organizer scans at the door): preview full width, buttons 48px.

## 7. Open questions (each with a recommended answer)

1. **Attendee list route (blocks W-R18, W-R19).** Options: (A) new `GET /me/registrations` returning `{ registrations: [...] }` where each item is the registration shape plus `event_title`, `event_starts_at`, `event_status` (`active|cancelled|passed`), for the cookie's user only, any status, so the web needs no extra call per row; (B) no list: `/registrations/me` shows only the ticket for one event via `?event={id}` (this works now), reached from the event page, and the list is dropped. **Recommended: A**, in its own API spec step (small: one query, same guards as R20, write the 401/403/shape tests first). Do not name it `GET /registrations/me`: that is the web path of the attendee screen and the two would collide on one origin. A new `/me` prefix needs one proxy line in `vite.config.ts`. Until A exists the web ships B's ticket page plus the placeholder.
2. **Organizer registrations route (blocks W-R20, W-R21).** Options: (A) `GET /events/{id}/registrations` for the owner of the event: registration shape plus `name` and `email` of the attendee, status, place; 404 when the event is not the organizer's (same as E7); screen picks the event with the existing `GET /events`; (B) `GET /organizer/registrations` with all events in one answer (bigger, needs paging soon); (C) none, organizers only see the counters. **Recommended: A** (reuses the ownership rule and the existing events list; the path `/events/{id}/registrations` already exists for `POST`, other method, and needs no proxy change). It shows attendee name and email to the owning organizer only; confirm that this is wanted. Not `GET /registrations` (collides with the web route).
3. **Logged-out visitor on `/registrations`.** Options: attendee login or organizer login (with `next`). **Recommended: `/organizer/login?next=%2Fregistrations`**, because the route is the organizer screen. A logged-out attendee who typed it can use "I am an attendee" on that page (the `next` is lost there, acceptable: the attendee screen is `/registrations/me`).
4. **Organizer opening `/registrations/me`.** Options: wrong-account message (W-A6) or redirect to `/registrations`. **Recommended: redirect (replace) to `/registrations`**, symmetrical with the attendee rule, no dead end, no loop (W-R17). The wrong-account page stays for the other guarded screens.
5. **Ticket page address.** Recommended: `/registrations/me?event={id}` (no new route; the same screen shows the list when `event` is missing). Alternative: a separate `/event/:id/ticket` (a third new route). Accept the recommended one?
6. **Header links (W-R14).** Without them the two routes are reachable only by typing. Recommended: add the one link per role (small change in `Header.tsx`). The task does not name it; say if you want it dropped.
7. **"Register again" after a cancelled ticket (W-R4, W-R7).** Cancel arrives in M4, so this state is only reachable by SQL today. Recommended: keep it (R12 allows a new row, otherwise the person is stuck). Can be dropped without effect on the rest.
8. **Effect on events-web.** Its W-E15 says the public view looks the same for everyone and W-E17 says there is no register control. This spec adds the area for logged-out viewers and attendees only; the tests that assert "no register control" are updated in the same step (section 4). Accept.

**QR and scan (new; none answered yet)**

9. **Libraries (CLAUDE.md: ask first).** Not installed; needed for W-R24 and W-R31. Checked by web search on 2026-10-18 (third-party pages, not the live npm pages, so confirm the versions before installing): `qrcode` 1.5.4 (Aug 2024), about 2.1M downloads a week, rated "sustainable", no bundled types so also `@types/qrcode` (dev). Native `BarcodeDetector`: no Firefox support, Safari "disabled by default", Chromium only partial (mainly macOS and ChromeOS in the data) so it cannot be the only path. Decoders: `jsqr` 1.4.0 (about 1.1M downloads a week, no release for years but stable, no dependencies, bundled types, decodes plain `ImageData`); `@zxing/browser` (its maintainers say ZXing JS has no active development, heavier); `html5-qrcode` (brings its own camera UI and loop, harder to style and to isolate in tests; I did not verify its maintenance state). **Recommended: add `qrcode` + `@types/qrcode` (encode, drawn as svg by us) and `jsqr` (decode), no `BarcodeDetector` branch (one code path, same behaviour in every browser).** The reason: both small, no UI of their own, and each hides behind one function (`qrModules`, `startScanner`) so jsdom tests need no camera (W-R37). Writing an own encoder or decoder is not worth it. Accept the three packages?
10. **Check-in API (blocks the request and result parts, W-R33 wiring and W-R34).** Not in `openapi.yaml`; roadmap step 26 names `POST /checkin`. Recommended smallest shape: **`POST /events/{id}/check-in`** with body `{ "ticket_code": "K7M2QX9TPA" }`, organizer who owns the event only (401/403 as R15/R20). Answers: **200** the registration shape with `checked_in_at` set (first time only: one conditional `UPDATE ... WHERE checked_in_at IS NULL`, B6); **409** `{ "error": "already_checked_in" }`; **409** `not_registered` (waitlisted or cancelled ticket); **409** `event_cancelled`; **404** `not_found` for unknown code, a ticket of another event and an event of another organizer (the same answer, no leaking); **400** `invalid_ticket_code` (bad format; the web checks first, W-R31). It is a nested path, so no proxy change and no collision with web routes. Differences to the roadmap (`POST /checkin` with the event inside the body) go to the `checkin.md` step. Do not edit `openapi.yaml` here.
11. **Who owns the check-in screen.** The roadmap puts "check-in by code and the arrivals counter" in `checkin-web.md` (step 27). Recommended: **this file owns the scan screen with its manual field** (W-R28-W-R37, built when the API exists), and `checkin-web.md` only adds the arrivals counter (B7) and its refresh to the same screen, reusing `submitCode` and `parseTicketCode`. Accept, or move W-R28-W-R37 into `checkin-web.md`?
12. **Checked-in ticket on the ticket page (W-R25).** Recommended: show "Checked in" and **hide the QR** (it is spent; avoids a person trying again), keep the code text. Alternative: keep the QR with "Checked in" above it. Also: the QR is hidden for a Cancelled event and shown for an Ended one. Accept?
13. **Addresses and entry point.** Scan screen at `/registrations/scan?event={id}` (no new header link; reached by "Check in attendees" on `/registrations`, recommended). Alternative: a panel on `/registrations`, which is blocked until question 2 and would block the camera too. Also the camera is started by a click, not on load (W-R30); accept?
14. **Stopping on a hidden tab.** Recommended: no extra rule (the camera stops on leave only, W-R35). Alternative: also stop when the tab becomes hidden. Not needed for the task.
