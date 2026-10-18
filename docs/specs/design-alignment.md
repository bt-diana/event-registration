# Spec: align the web pages with the design canvas (web)

Feature spec made from `SPEC_TEMPLATE.md` (sections 1-5 plus a mobile section, an order of work, the canvas and the open questions). Frontend only: no API change, no new library, no new route. It compares the 18 downloaded boards of the design canvas (https://claude.ai/artifact/Ca1zKGzeKDGuXHhn7J5L76) with `web/src/` (`auth/`, `events/`, `registrations/`, `styles.css`) and with the existing specs, and lists what differs. Style values are `docs/brand.md`. Ids are DA1, DA2, ...

**Not in this spec.** The header (logo, account block, links, Log out, its phone layout): owned by `header-events-link.md`, `header-responsive.md`, `auth-web.md` W-A18, `registration-web.md` W-R14 and `events-web.md` W-E22. No behaviour of the SPEC_TEMPLATE is a requirement here. No live counter, no polling, no server-sent events (D50, D51: the screens read again on return).

**Finding in one line.** The pages are already built to the boards for the most part: the public list, the event pages, the ticket page with QR, the organizer registrations list, the arrivals counter and every scan state exist in code (`PublicEventsList.tsx`, `EventPage.tsx`, `TicketPage.tsx`, `OrganizerRegistrations.tsx`, `ScanScreen.tsx`). What is left is a small set of look and copy gaps, three functional gaps (one is blocked by an API that is not built), and the phone layout of the pages that have no phone board.

## 1. Goals and expected behaviour

**Goal.** Every screen except the header looks and reads like its board, and shows the states and links the boards show. Where a board and an existing spec contradict, the spec stays and the question is in section 9 (nothing is chosen silently).

**How to read the tables.** `Look` = styles or copy only, no logic (no test first; existing tests stay green, a test changes only where the copy it looks for changes). `Func` = a behaviour a test can prove. Board = the file name in the canvas (`Main` = `Main.dc.html`). "Covered by" names an existing spec row; this spec does not repeat it. Boards say `GMT+6` and old badge outlines; they are samples, not requirements.

### 1.1 Login, sign-up, wrong account (boards Main, Signup, OrganizerLogin, WrongAccount)

Already as the boards: eyebrow, card 440/520 px, fields 48 px, Show/Hide, form error box, "No account yet?" line, divider and role switch link, "Wrong account" eyebrow in the dark error colour, `h1` 30 px on the message card.

| # | Board | Behaviour | Kind | Test first? |
|---|---|---|---|---|
| DA1 | Main | `/login`: `h1` "Log in", intro "Use the email you registered with." (built: "Log in to sign up for events and see your tickets."). | Look (copy) | |
| DA2 | Signup | `/signup`: `h1` "Create your account", intro "Register for events and keep your tickets in one place." (built: "Create an account" / "Make an account to sign up for events."). `App.test.tsx` looks for the old `h1`; change it with the copy. | Look (copy) | |
| DA3 | OrganizerLogin | `/organizer/login`: `h1` "Organizer log in", intro "Manage your events and check people in.", switch line "No organizer account? Sign up" (built: `h1` "Log in", "Log in to create and manage your events.", "No account yet?"). Organizer sign-up copy is unchanged (its board was not downloadable, section 9 question 1). | Look (copy) | |
| DA4 | WrongAccount | The two links of the wrong-account card look like buttons in a wrapping row, gap 12 px: "Log in as an organizer" (or "...as an attendee") = primary button look in the accent of the needed role (48 px, padding `0 20px`, white text); "Go home" = secondary look (white, 1px `border-input`, dark text, 48 px). Text of the card stays W-A6 (section 9 question 7). | Look | |

Functional gaps: none.

### 1.2 Public events list `/` (boards PubList, PubListPhone, PubListStates)

No desktop gap: card, title link, badge words, meta line, hover border, empty "No upcoming events.", "Loading...", load error with Retry are built (`events-public-list-web.md` W-L1 to W-L13). The phone rows are in section 2 (DA25). Functional gaps: none.

### 1.3 Public event page `/event/:id` (boards RegEvent, PublicStates)

Already as the boards: eyebrow "Event", `h1`, badge, description, "Capacity: N" + "Registration is closed." for closed events, "Event not found" + "Go home", "Loading...", "Could not load this event" + Retry.

| # | Board | Behaviour | Kind | Test first? |
|---|---|---|---|---|
| DA5 | RegEvent, PublicStates | For a not closed event the seats text ("12 of 25 seats left") is a separate line under the `dl`, 600 weight, not a "Seats" row inside the `dl` (the `dl` keeps Starts, Ends, Duration). Same words as W-E16. | Look | |
| DA6 | RegEvent | The registration control (button "Register", "Register again", "Join waiting list", and the login link button of W-R2) fills the card width on every width (built: `min-width: 200px`, auto width). The divider above the area stays. | Look | |

Functional gaps: none (all registration states: covered by `registration-web.md` W-R1 to W-R10).

### 1.4 Organizer screens (boards OrgEvents, OrgCreate, OrgEvent, OrgStates)

Already as the boards: list columns, badges, "Create event" button link, empty/loading/error cards, create-form errors, "Creating..." state, `h1` "Your events", `dl` of the event page, share line.

| # | Board | Behaviour | Kind | Test first? |
|---|---|---|---|---|
| DA7 | OrgEvent | Organizer view of `/event/:id`: the "Back to events" link and the share line sit together at the bottom, under one divider (`border-top`), after the `dl` and the existing "Registrations" button (built: back link above the `h1`; the share line has its own divider). The "Registrations" button is kept (section 9 question 13). | Look | |

Functional gaps: none.

### 1.5 Ticket page `/registrations/me?event={id}` (board RegTicketQr)

Already as the boards: `h1` "Your ticket", event link, Starts, the three ticket states (registered with QR, checked in without QR, waiting list with place), `h3` "Check-in code", both QR hints, QR rules of W-R24 to W-R27.

| # | Board | Behaviour | Kind | Test first? |
|---|---|---|---|---|
| DA8 | RegTicketQr | The ticket panel on the ticket page has a 2 px border in the state colour: `--accent` for a registered ticket (also checked in), `--border-input` for the waiting list and the cancelled ticket (cancelled has no board: assumption). The panel on the event page keeps 1 px. | Look | |
| DA9 | RegTicketQr | `h3` "Check-in code": Bricolage Grotesque 18 px 700, left aligned (built: 16 px 600, centred). The QR and the two hints stay centred. | Look | |
| DA10 | RegTicketQr, RegLists, RegScanStates, RegScan | A ticket code is shown in the monospace stack `ui-monospace, Menlo, monospace`, letter spacing 0.12em: the ticket code on the ticket page (30 px, 600), in lists and tables, in the scan result (24 px) and in the scan manual input (18 px, 600). Still plain selectable text (W-R22). `docs/brand.md` gets a "Ticket code" line (separate edit). | Look | |

Functional gaps: none.

### 1.6 Attendee list `/registrations/me` (board RegLists, top half)

| # | Board | Behaviour | Kind | Test first? |
|---|---|---|---|---|
| DA11 | RegLists | The list of my registrations (one row per registration: event link, start, status, ticket code; empty "You have no registrations yet." + "Go home"; loading; error with Retry). **Covered by** `registration-web.md` W-R18, W-R19 (S3) and `my-registrations.md` MR1 to MR15. **Blocked:** the API route `GET /me/registrations` is not built (no match in `api/src`), so the screen stays the placeholder "The list is not built yet." (`MyRegistrations.tsx`). Nothing new here. | Func (blocked) | |
| DA12 | RegLists | When W-R18 is built: each row is a card like the events list (22 px title link, then the pill badge on the same row, then the second line "start, Ticket code CODE"). Badges: "Registered" (open tone), "Waiting list: place {n}" (full tone), "Cancelled" (cancelled tone, code struck through, `text-decoration: line-through`). Cards sit on the ground at the width of `/` (section 9 question 10). | Look (blocked) | |

### 1.7 Organizer registrations `/registrations` (boards RegOrg, RegLists bottom half)

Already as the boards: `h1`, event selector, table with Name, Email, Status, Place, Ticket code, Registered (and the Arrival column from `checkin-web.md` W-C16), sideways scroll inside the card, "Check in attendees", empty text, no events, loading, error with Retry, "Event not found".

| # | Board | Behaviour | Kind | Test first? |
|---|---|---|---|---|
| DA13 | RegOrg | A link "Open event page" next to "Check in attendees", to `/event/{chosen id}` (id URL-encoded, follows the selector). Shown only when an event is chosen (not in the no-events, loading and error states). Not in any spec; no request, no API. At least 44 px high. | Func (small, free) | yes |
| DA14 | RegOrg, RegScanStates | The load-error states of the registrations page and the scan screen ("Could not load registrations", "Could not load events") show the text in the error box (tint `--error-tint`, 2 px `--error` border, radius 8, padding `10px 12px`, text `--error-text-on-tint`, `role="alert"` as built) and Retry as the secondary button look (built: bold text and a primary Retry). Same words. | Look | |
| DA15 | RegOrg | A `Cancelled` row in the table (status "Cancelled", struck-through ticket code in `--text-muted`). **Blocked:** the list route only gives `registered` and `waitlisted` (`OrganizerRegistration`), and cancelling is M4 (not built). Not built here; picked up with M4. | Func (blocked) | |

### 1.8 Scan screen `/registrations/scan` (boards RegScan, RegScanStates)

All 18 states of RegScanStates exist in `ScanScreen.tsx` (idle, asking, active, blocked, no camera, insecure, other, not a ticket code, invalid typed code, sending, checked in, already checked in, refused answers, request failed, no events, events error/loading) and are covered by `registration-web.md` W-R28 to W-R37. The gaps are look only.

| # | Board | Behaviour | Kind | Test first? |
|---|---|---|---|---|
| DA16 | RegScan | The back link reads "<- Back to registrations" (arrow as built, `aria-hidden`), to `/registrations?event={id}` (built: "Registrations"). Tests that look for the old name change with it. | Look (copy) | |
| DA17 | RegScan, RegScanStates | The camera area is one dark box (`--text`, radius 8, 4:3, max 480 px) in every state: idle shows "Camera is off" inside it with "Start camera" under it; asking and active show their status text inside the box (active: a bar at the bottom, `rgba(16,28,26,.85)` with white 14 px text, `role="status"`) and the active preview carries a white square frame (58% of the width, 3 px border, radius 12). New copy: "Camera is off". The video, `aria-label="Camera preview"`, `playsInline muted` are unchanged (W-R36). | Look (one new text) | |
| DA18 | RegScanStates | The four camera problems (blocked, no camera, insecure, other) are shown in the error box of DA14 with `role="alert"` (built: muted text with `role="status"`; W-R30 names only "asking" as `role="status"`). The words stay W-R30; "Try again" (secondary) stays on "other". | Func (role) | yes |
| DA19 | RegScanStates | "This is not a ticket code." (W-R31) shows inside the camera card, under the preview, in the error box of DA14 (built: loose text under the card). Scanning goes on. | Look | |
| DA20 | RegScanStates | Result card: refused answers (not found, waiting list, cancelled ticket, cancelled event) and "Something went wrong. Try again." use the error box of DA14 with the same words as W-R34; "Scan next" is the primary button (accent, 48 px) in every result; the failed state has "Try again" as secondary (built: secondary Scan next, primary Try again). The result still shows name, event title and first check-in line (W-R34); focus still goes to the result heading or text (`tabIndex={-1}`, W-R34) and `role` stay as built. Copy conflicts: section 9 questions 5 and 6. | Look | |

Functional gaps: none.

## 2. Mobile layout (all pages except the header)

Reference: the phone boards PubListPhone (390 px) and RegScan (390 px). `LoginMobile` was not downloadable. Every other page has no phone board, so its rows are derived from `docs/brand.md` (fluid width, touch targets 44/48 px, 16 px text) and are assumptions (section 9 question 11). jsdom has no layout, so every row below is **checked by hand at 320 px and 390 px** (browser devtools, real app, desktop-size screen restored after). The header and its phone rule are out of scope (`header-responsive.md`).

Phone = `max-width: 520px`, the existing breakpoint in `styles.css` (the `.event-card` rule). No new breakpoint.

| # | Source | Behaviour (all by hand at 320 and 390 px) |
|---|---|---|
| DA21 | brand.md | No horizontal scroll of the page on any route: `/`, `/login`, `/signup`, `/organizer`, `/organizer/login`, `/organizer/signup`, `/organizer/events/new`, `/event/:id` (public and organizer view), `/registrations`, `/registrations/me` (list placeholder and ticket), `/registrations/scan`, and their loading, empty and error states. Check: `document.documentElement.scrollWidth <= clientWidth`. Only a table scrolls sideways, inside its own card (DA29). |
| DA22 | PubListPhone, RegScan | Page padding on phone: `24px 16px` (`.page`); the scan screen `16px` (RegScan `main`). Built: `64px 16px` everywhere. |
| DA23 | PubListPhone, RegScan | `h1` 30 px, line height 1.1, 16 px below it before the first block (`.public-list h1`, `.scan-page h1`, list heads). Built: 34 px (30 px on message cards only). |
| DA24 | RegScan (derived for the rest) | Cards (`.card`, `.card-message`, `.card-form`, `.card-event`) have padding 20 px on phone (built: 32 px). The ticket panel, the arrivals counter and the scan blocks keep 12 to 20 px (already). Auth forms: derived, LoginMobile missing. |
| DA25 | PubListPhone | `/`: the gap between cards is 12 px (built: 16 px). Everything else is built: card padding 16, title 20 px, order title, meta, badge, badge on its own line, whole card is the link. |
| DA26 | brand.md | Long unbroken text wraps and never widens the page: event title (`h1`), organizer event title in the table link, name, email, ticket code, share link. `h1`, card titles and these texts get `overflow-wrap: anywhere` (built only for the description, share line, code and card title). Test text: a 60-letter title, an 80-character email. |
| DA27 | brand.md | Forms (login, sign-up, create event): fields full width, 48 px high, 16 px text (no zoom on iOS), label above; the password row keeps input and Show/Hide on one line without overflow; `datetime-local` fits at 320; the role switch and back links are at least 44 px high. |
| DA28 | RegScan | Buttons inside a card are full width on phone and 48 px high: "Start camera", "Check in", "Scan next", "Try again", "Register", "Create event" in the card. Built: `auto` width with a 160-200 px minimum (`.scan-start`, `.scan-next`, `.registration-button`). |
| DA29 | brand.md | `/organizer` and `/registrations`: the table keeps `min-width: 640px` and scrolls inside `.table-card`; the page itself does not scroll sideways; the selector, counter and heading above it are full width. |
| DA30 | brand.md | `.list-head`: heading and its button wrap (button under the heading, 48 px, left aligned or full width as DA28) at 320. |
| DA31 | brand.md, W-R26 | Ticket page: ticket code 24 px on phone (monospace, DA10), wraps rather than overflows at 320; the QR is fluid between 160 and 232 px and fits inside card and panel padding at 320; hints below it wrap. |
| DA32 | RegScan | Scan screen at 390: one column in this order: back link, `h1`, selector (48 px), arrivals counter, camera box (full width up to 480, DA17), "Or enter the code" form with the code input full width. The result card sits under the camera. At 320 nothing is cut off. |
| DA33 | brand.md | Touch targets on phone: links at least 44 px high, buttons and fields 48 px (brand.md Rules); no two targets touch (gap at least 8 px between stacked buttons: "Scan next" and "Try again", "Check in attendees" and "Open event page"). |
| DA34 | brand.md | Event details `dl` (`.details`, auto-fit 200 px) is one column at 320 and 390, labels above values; the badge sits under the `h1` and wraps with the text, never cut. |

## 3. UI decisions

| Part | Decision |
|---|---|
| Source of truth | Boards for look and copy where no spec row names the words; the spec row where one does (section 9 lists every conflict). |
| Colours, type, spacing | `docs/brand.md`. New values here: ticket code font (DA10), camera box and overlay (DA17), panel border colours (DA8), phone paddings (section 2). No new colour token: `rgba(16,28,26,.85)` is `--text` at 85%. |
| Error box | One shape for DA14, DA18, DA19, DA20: `--error-tint` background, 2 px `--error` border, radius 8, padding `10px 12px`, text `--error-text-on-tint`. It reuses `.registration-error` (built) renamed or shared; no second style. |
| Copy | New: "Camera is off". Changed: DA1 to DA3, DA16. Everything else keeps its words. |
| States | Unchanged. No new loading, empty or error state is added; DA11 and DA15 wait for their APIs. |

## 4. Architecture decisions

- **Apps:** `web/` only. CSS in `styles.css` (the phone rules go into the existing `@media (max-width: 520px)` block); no new file for styles, no library.
- **Look rows are CSS or JSX class changes.** No new component except where the error box is shared (a class, not a component).
- **DA13** is a `Link` in `OrganizerRegistrations.tsx` built from the chosen event (`encodeURIComponent`), like the existing "Check in attendees" link.
- **DA18** changes only the `role` of the camera problem text in `CameraArea` (`ScanScreen.tsx`); the state machine, camera release (W-R35) and one-request rule (W-R33) are untouched.
- **Blocked rows** (DA11, DA12, DA15) get no code in this spec. `MyRegistrations.tsx` stays the placeholder until `my-registrations.md` is built and `registration-web.md` W-R18 is unblocked.
- **Tests:** existing files, existing helpers (`renderApp`, `mockFetch`, `json`, `ANN`, `OLGA`). jsdom cannot prove layout, so the look rows and all of section 2 are checked by hand; no test reads `styles.css`.

## 5. Files to touch

| File | What to do | Behaviours |
|---|---|---|
| `web/src/auth/AuthForm.tsx` | Copy table `COPY` (titles, intros) and the switch line of the organizer login | DA1-DA3 |
| `web/src/App.test.tsx` | The `h1` check on `/signup` ("Create an account") follows DA2; add `/login` and `/organizer/login` `h1` checks | DA1-DA3 |
| `web/src/auth/guards.tsx` | Wrong-account links get the button classes (text unchanged) | DA4 |
| `web/src/events/PublicEventPage.tsx`, `web/src/events/PublicEventPage.test.tsx` | Seats text as its own line outside the `dl` (open event) | DA5 |
| `web/src/registrations/RegistrationArea.tsx` | Full-width control (class only) | DA6 |
| `web/src/events/EventPage.tsx` | Organizer view: bottom block with back link and share line | DA7 |
| `web/src/registrations/TicketPanel.tsx`, `TicketPage.tsx`, `QrCode.tsx` | Panel state border (`data-status`), `h3` look, code class | DA8-DA10 |
| `web/src/registrations/OrganizerRegistrations.tsx`, `OrganizerRegistrations.test.tsx` | "Open event page" link (test first); error box + secondary Retry | DA13, DA14 |
| `web/src/registrations/ScanScreen.tsx`, `ScanScreen.test.tsx` | Back link text, camera box, `role="alert"` for problems (test first), not-a-ticket text inside the card, result look, "Camera is off" | DA14, DA16-DA20 |
| `web/src/styles.css` | All look rows; the phone block of section 2; ticket code font; error box | DA4-DA10, DA14, DA17-DA20, DA22-DA34 |
| `web/src/registrations/MyRegistrations.tsx` | No change now (blocked) | DA11, DA12 |
| `docs/brand.md`, `README.md`, `ROADMAP.md` | Ticket code font, phone values, "Not decided yet" list is out of date (separate edit by the agent that owns them) | DA10, DA22-DA24 |

## 6. Order of work

Small steps, one commit each, `type(scope): description`, tests before the code where marked. Answer the open questions of section 9 first (at least 5, 6, 7, 9, 10, 11).

1. **Tests first:** DA13 (link `href` with the chosen event, hidden without events) and DA18 (`role="alert"` for blocked, no camera, insecure, other). Commit `test(web): ...`.
2. DA13 and DA18 code. Commit `feat(web): ...`.
3. Copy: DA1 to DA3, DA16 with their test changes. Commit `fix(web): ...`.
4. Shared error box and secondary Retry (DA14, DA19, DA20), Scan next primary. Commit `fix(web): ...`.
5. Scan camera box and "Camera is off" (DA17).
6. Ticket page look and monospace code (DA8 to DA10).
7. Event pages (DA5, DA6, DA7) and wrong-account buttons (DA4).
8. Mobile pass (DA21 to DA34): CSS in the 520 px block, then the hand check at 320 and 390 px on every route of DA21; write the result in the session file.
9. Update the canvas (section 8) and `docs/brand.md`.
10. Later, not in this spec's steps: DA11, DA12 after `my-registrations.md` is built and W-R18 unblocked; DA15 after M4.

## 7. Done means

- Tests, typecheck and linter pass in `web/` (`bash scripts/verify.sh`).
- DA13 and DA18 have tests committed before the code; all existing `Header.test.tsx`, `eyebrow.test.tsx`, `ScanScreen.test.tsx`, `TicketPage.test.tsx` cases stay green.
- Look rows (DA1 to DA10, DA14, DA16 to DA20) are compared board against the real page side by side; the header is ignored.
- Section 2 is checked by hand at 320 px and 390 px on every route listed in DA21, with no horizontal page scroll.
- DA11, DA12, DA15 are marked "blocked" in `ROADMAP.md`, not done.

Gap count: look 16 (login 4, public event 2, organizer event 1, ticket 3, attendee list 1 blocked, organizer registrations 1, scan 4), functional 4 (`Open event page` link free, scan alert role free, attendee list blocked by the API, cancelled row blocked by M4), mobile 14 rows. `/` has no desktop gap.

## 8. Canvas boards

Redraw or fix on the existing canvas (no new artifact), after the open questions are answered: OrgEvents, OrgCreate and OrgEvent (eyebrows, question 2); RegEvent, OrgEvent, RegTicketQr (badge look, question 3); PublicStates (date labels, question 4); RegScanStates (copy and the "Paused" state, questions 5 and 6); WrongAccount (question 7); RegOrg (summary line and columns, questions 8 and 9); RegLists (question 10); OrgStates (event 404, question 15). Add phone boards for login, event page, organizer list, ticket and registrations at 390 px, and an updated "Check in" board with the camera box. Missing downloads: LoginMobile, OrganizerSignup, States.

## 9. Open questions (each with a recommended answer)

1. **Boards not downloadable:** LoginMobile (phone login), OrganizerSignup (copy of `/organizer/signup`), States (loading, session error, pending, logout failure). They could not be compared. **Recommended:** export them once more; until then organizer sign-up copy and the "Could not check your login" screen stay as built, and the phone login uses the derived rows of section 2.
2. **Eyebrows.** OrgEvents and OrgCreate show "Organizer", OrgEvent shows "Event" in the content; `role-eyebrow.md` RE1 removes the role word from content (the organizer event page is not named there). **Recommended:** keep RE1 and no eyebrow on the organizer pages; redraw the boards.
3. **Badge look.** RegEvent, OrgEvent and RegTicketQr draw the status as a 2 px outlined box; `brand.md` (approved 18-10) and the code use the filled pill. **Recommended:** pill; redraw the boards.
4. **Event date labels.** PublicStates shows "Started ...", "Was ..." (cancelled) and "Ended ..." with one date; W-E16 shows Starts, Ends, Duration for every status. **Recommended:** W-E16 (no change).
5. **Scan refusal copy.** RegScanStates: "Ticket not found for this event.", "This ticket is not valid."; W-R34: "Ticket not found.", "On the waiting list, no seat yet.", "This ticket is cancelled." (the API tells these apart). **Recommended:** W-R34 words; DA20 changes the look only.
6. **"Sending (preview paused)" with a "Paused" overlay** (RegScanStates) vs W-R33 (the preview keeps playing, only decoding pauses). **Recommended:** W-R33; no overlay, "Checking..." on the disabled button as built.
7. **Wrong-account card.** WrongAccount splits it into `h1` "This page is for organizers" and a line "You are logged in as ann@mail.com, an attendee account."; W-A6 and the tests use one sentence "This page is for organizers. You are logged in as ann@mail.com." under `h1` "Switch account". **Recommended:** keep W-A6 and its `h1`; only the button look (DA4).
8. **Summary line** "Registered: 2 / 25 · Waiting list: 2" (RegOrg) vs the arrivals counter "Arrived: x / y registered" + "Capacity" (`checkin-web.md`; the arrivals route has no waiting-list count). **Recommended:** keep the counter; no waiting-list count.
9. **Registrations table.** RegOrg and RegLists show a date only in "Registered", no Arrival column and a Cancelled row; W-R20 has date and time (W-E19), the Arrival column (W-C16) and only registered or waitlisted rows. **Recommended:** the spec rows (DA15 waits for M4).
10. **Attendee list shape.** RegLists nests the cards in a white 960 px card; S3 (`registration-web.md`) and PubList use cards on the ground at 760 px. **Recommended:** S3.
11. **Phone values** for pages without a phone board (padding 24/16, card padding 20, `h1` 30, full-width buttons, DA22 to DA34) are my derivation from PubListPhone, RegScan and `brand.md`. **Recommended:** accept them, then draw the missing phone boards (section 8) and correct the numbers.
12. **QR size.** RegTicketQr draws 200 px with a 1 px border and radius 8; W-R26 says 232 px (8 px per module), fluid down to 160. **Recommended:** W-R26 (no change).
13. **Organizer event page.** OrgEvent has no "Registrations" button, which the code has (it opens `/registrations?event={id}`), and its share line reads "Share link (same for everyone): /event/42" (built: "..., others see the public view" and the link is clickable; W-E21 says the share link is text). **Recommended:** keep the button (it is the only way from the event to its registrations apart from the header) and the built share line; only DA7.
14. **Small board and spec differences kept as built:** page top padding 48 px on list and form boards vs `brand.md` 64 px; create-form hints under all five fields (board only under description and start); events-list load error as `h1` "Events" + alert (PubListStates uses the error as the title); "Check in attendees" as a text link (RegOrg) vs button link; 44 px vs 48 px selector; "Created" row. **Recommended:** keep as built, no row.
15. **Organizer event 404.** OrgStates shows "Event not found" with "Back to events"; W-E11 and W-E18 show the public 404 with "Go home" for an organizer too. **Recommended:** W-E11; the board is outdated.
