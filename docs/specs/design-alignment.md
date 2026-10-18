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
| DA7 | OrgEvent | Organizer view of `/event/:id`: the back link "Events" stays at the top, above the `h1` (as built; the user decided against the board, which has it at the bottom). The share line keeps its place and divider under the `dl` and the existing "Registrations" button. The "Registrations" button is kept (section 9 question 13). The "Registrations" button gets more space around it: a larger gap above it (from the `dl`) and below it (to the share line), both from the spacing scale in `docs/brand.md` (24 px suggested). Only the spacing changes in the code. | Look (decided: keep as built, more space around the button) | |

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
| DA16 | RegScan | The back link reads "← Registrations" (arrow `aria-hidden`; accessible name "Registrations", D75; first written as "<- Back to registrations"), to `/registrations?event={id}`. Tests that look for a "Back to ..." name change with it. | Look (copy) | |
| DA17 | RegScan, RegScanStates | The camera area is one dark box (`--text`, radius 8, 4:3, max 480 px) in every state: idle shows "Camera is off" inside it with "Start camera" under it; asking and active show their status text inside the box (active: a bar at the bottom, `rgba(16,28,26,.85)` with white 14 px text, `role="status"`) and the active preview carries a white square frame (58% of the width, 3 px border, radius 12). New copy: "Camera is off". The video, `aria-label="Camera preview"`, `playsInline muted` are unchanged (W-R36). | Look (one new text) | |
| DA18 | RegScanStates | The four camera problems (blocked, no camera, insecure, other) are shown in the error box of DA14 with `role="alert"` (built: muted text with `role="status"`; W-R30 names only "asking" as `role="status"`). The words stay W-R30; "Try again" (secondary) stays on "other". | Func (role) | yes |
| DA19 | RegScanStates | "This is not a ticket code." (W-R31) shows inside the camera card, under the preview, in the error box of DA14 (built: loose text under the card). Scanning goes on. | Look | |
| DA20 | RegScanStates | Result card: refused answers (not found, waiting list, cancelled ticket, cancelled event) and "Something went wrong. Try again." use the error box of DA14 with the same words as W-R34; "Scan next" is the primary button (accent, 48 px) in every result; the failed state has "Try again" as secondary (built: secondary Scan next, primary Try again). The result still shows name, event title and first check-in line (W-R34); focus still goes to the result heading or text (`tabIndex={-1}`, W-R34) and `role` stay as built. Copy conflicts: section 9 questions 5 and 6. | Look | |

Functional gaps: none.

### 1.9 Back links (all pages except the header)

Asked for: "Back to ..." buttons where possible. Routes checked (`web/src/App.tsx`): `/`, `/event/:id`, `/registrations`, `/registrations/me`, `/registrations/scan`, `/login`, `/signup`, `/organizer`, `/organizer/events/new`, `/organizer/login`, `/organizer/signup`. There is no catch-all route, so no page for an unknown URL exists (not added: nothing in the task asks for it).

**Rules.** One link per screen. Not in the header. It is the first element of the screen's card or section, above the `h1` (and above an eyebrow). Look = the existing back link: `.back-link` (15 px, 600, accent link look, `display: inline-flex`, `min-height: 44px`), arrow `&larr;` in a `span aria-hidden="true"`, then the capitalised name of the target. **Wording (D75, 22:38 +06): the word "Back" is not used.** The text is "← Events", "← Event" or "← Registrations"; the accessible name is exactly "Events", "Event" or "Registrations" (the arrow is hidden). The old "Back to ..." text is gone from every row below. A link to a parent is only drawn where the target does not depend on data we do not have. No link on top-level screens, on login and sign-up (not a flow with a parent) and on screens that already have a named exit link in the words of an existing spec (W-E11 "Go home", W-R12 "Go to the event", W-A6 "Go home"): those keep their words and get no second link. No request, no API, no new route.

**Already built (not duplicated).** The back link "Events" on the organizer event page (`EventPage.tsx`, top, `/organizer`, DA7) and on the create form (`CreateEventForm.tsx`, but below the form, DA36); "Registrations" on the scan screen (`ScanScreen.tsx`, loaded state only, below the `h1`, DA46). Their tests exist: `EventPage.test.tsx`, `ownership.test.tsx`, `CreateEventForm.test.tsx`, `ScanScreen.test.tsx`, `ArrivalsCounter.test.tsx`.

All rows are Look unless noted; every row is checked by a component test (`renderApp`, `mockFetch`, helpers as in the existing files): `within(main).getByRole("link", { name: "Events" })` (exact string, never a regex or substring: the name is a common word), its `href` attribute, and that it is the only back link in `main` (DA49, DA50). Tests-first is not needed (simple UI) except DA39 and DA46, where the target depends on the view or the chosen event.

| # | Screen (route, state) | Behaviour | Kind | Test first? |
|---|---|---|---|---|
| DA35 | All rows below | Shared look and placement (rules above). One small component `BackLink({ to, name })` in `EventParts.tsx` renders it; the three built links switch to it with the same markup; the text changes to the D75 wording ("← Events", "← Event", "← Registrations"), so their tests change with it (name only, hrefs stay). `name` is the capitalised destination, e.g. `name="Events"`. CSS: the spacing rule `.card-event > .back-link { margin-bottom: 8px }` also covers `.card-message`, `.card-form`, `.list-page` and `.scan-page`; the old `.card-form .back-link { margin-top: 16px }` goes. Test: the rows below. | Look | |
| DA36 | Create form `/organizer/events/new` | "← Events" (name "Events") to `/organizer`, **moved** from below the form to the top, above the `h1` "Create event" (built: after the `</form>`). Text and target unchanged (W-E21). Test: in `CreateEventForm.test.tsx` the existing href check stays; add that the link comes before the `h1` in the document (`compareDocumentPosition`). | Look (position) | |
| DA37 | Organizer event page `/event/:id`, owner view | Built: "← Events" (name "Events") to `/organizer`, top, above the `h1` (DA7). No change. Tests: `EventPage.test.tsx`, `ownership.test.tsx` (not shown to a non-owner or a logged-out person). | Built | |
| DA38 | Public event page `/event/:id`, loaded (logged out, attendee, organizer who is not the owner; open and closed events) | New "← Events" (name "Events") to `/` (the public list), above the eyebrow "Event". Conflicts with W-E21 ("the public view has no extra links"): **section 9 question 16**. Test: `PublicEventPage.test.tsx` (name, href `/`; present for a closed event too; the registration control is unchanged). | Look | |
| DA39 | Event load error "Could not load this event" (shared `EventLoadError`) | New "← Events" (name "Events") above the `h1`: to `/organizer` when the viewer is the organizer asking for the owner view (`OwnerOrPublic`), to `/` in the public view. `EventLoadError` gets a `backTo` prop from its two callers. Test: `EventPage.test.tsx` (organizer, 500 on `GET /events/:id`: href `/organizer`) and `PublicEventPage.test.tsx` (logged out, 500: href `/`); Retry unchanged. | Func (two targets) | yes |
| DA40 | Event not found (`EventNotFound`, public 404, also for an organizer and on the ticket page) | No change: keeps "Go home" to `/` (W-E11, W-E18, W-R12). No second link. Test: existing; add that there is no back link there (DA50: "Go home" has `.back-link` but no arrow, so it is not one). | None | |
| DA41 | Ticket page `/registrations/me?event={id}`, loaded (registered, checked in, waiting list, cancelled) | New "← Event" (name "Event") to `/event/{id}` (id from the URL, URL-encoded), above the `h1` "Your ticket". (The title link of W-R11 is plain text since D72, so no second link to the event.) Test: `TicketPage.test.tsx` (href `/event/42`, for a waiting-list ticket too). | Look | |
| DA42 | Ticket page, error "Could not load your ticket" | Same link, same target, above the `h1` (the id is known from the URL). Retry unchanged. Test: `TicketPage.test.tsx`. | Look | |
| DA43 | Ticket page, loading; "no ticket" state | Loading: no link (changes in a moment). "You have no ticket for this event.": no link, the button "Go to the event" (W-R12) is the exit. Test: `TicketPage.test.tsx` (no back link in `main`, DA50). | None | |
| DA44 | Organizer registrations `/registrations`, every state that has the `h1` "Registrations" (loaded, no events, loading, load error, list "Event not found") | New "← Events" (name "Events") to `/organizer`, above the `h1` (outside `.list-head`). Does not depend on the chosen event. "Open event page" (DA13) is an action next to "Check in attendees" and stays; it is not a back link. Question 17. Test: `OrganizerRegistrations.test.tsx` (href `/organizer` in the loaded and the no-events state). | Look | |
| DA45 | Attendee list placeholder `/registrations/me` (no `event`) | No link: a top-level screen reached from the header; its list is blocked (DA11). | None | |
| DA46 | Scan screen `/registrations/scan`, every state with the `h1` "Check in" (loading, load error, no events, loaded) | The built back link ("← Registrations", name "Registrations") moves above the `h1` (built: below it; DA32 already lists the order back link, `h1`) and shows in all four states, not only loaded. Target: `/registrations?event={id}` when an event is chosen (built), else `/registrations`. `Shell` gets a `backTo` prop. Camera, result and focus rules (W-R33 to W-R37) are untouched. Test: `ScanScreen.test.tsx` (loaded: href with `?event=`; no events and load error: href `/registrations`; link before the `h1`); the existing click test (line 513) stays. | Func (target by state) | yes |
| DA47 | No link: `/`, `/organizer`, `/login`, `/signup`, `/organizer/login`, `/organizer/signup`, wrong-account card, "Could not check your login" | None drawn (top-level, no parent, or state unknown). Test: one test in `App.test.tsx` that renders these routes and finds no back link in `main` (DA50). | None | |
| DA48 | Phone (<= 520 px) | The link stays at least 44 px high, its text wraps if needed (no `white-space: nowrap`), nothing touches the `h1` (8 px gap), no new breakpoint, no horizontal page scroll (DA21). Checked by hand at 320 and 390 px on every screen of DA36 to DA46. | Look (by hand) | |
| DA49 | Every screen above | At most one back link (DA50) in `main`; none in the header. | Func | |
| DA50 | Every screen above (D75: how tests find a back link) | The name has no "Back" prefix any more, so `name: /^Back to/` is gone. **A back link = an `a.back-link` inside `main` whose `textContent` starts with the arrow "←"** (`BackLink` always renders it; the "Go home" link of `EventNotFound` has `.back-link` but no arrow and is not one). Use: `within(screen.getByRole("main"))`, then `getAllByRole("link")` filtered by that rule, or `getByRole("link", { name: "Events" })` (exact string; a regex like `/events/i` is forbidden, it would also match "All events" and "My events"). "No back link" = that filtered list is empty; "only one" = its length is 1. No code change is needed for this (no new attribute); the header is outside `main`, so DA49 "none in the header" is tested as: `within(banner)` has no link with the arrow. Per-screen check of the plain names: section 1.9a. | Func (test helper) | |

**1.9a Plain names against other links (D75).** Exact-string role queries scoped to `main` find each back link without ambiguity. Names of the other links, by screen (header links are outside `main`: "Event Registration" logo, "All events", "My events", "My registrations", "Log in", "Sign up", "For attendees", "For organizers"; none is "Events", "Event" or "Registrations").

| Screen | Back link | Other links in `main` | Clash? |
|---|---|---|---|
| Create form | "Events" | none | No |
| Organizer event page | "Events" | "Registrations" (the DA7 button link, `/registrations?event={id}`) | No (names differ, exact query). Note: the h1 or the button is never the back link; find the back link by name "Events", the button by "Registrations" |
| Public event page, event load error | "Events" | "Log in to register", "View ticket" (names unchanged), "Retry" is a button | No |
| Ticket page (loaded, error) | "Event" | none (event name is plain text, D72); "Go to the event" only in the no-ticket state, which has no back link | No ("Event" vs "Events": a screen never has both; query by exact string) |
| Organizer registrations | "Events" | "Check in attendees", "Open event page" (DA13), "View emails of {name}" (email-reminders-web.md) | No |
| Scan screen | "Registrations" | none | No |
| Attendee emails page (email-reminders-web.md) | "Registrations" | none | No |

An event titled exactly "Events" or "Registrations" is a heading or plain text on these screens, never a link next to the back link, except in the organizer list `/organizer` and public list `/`, which have no back link (DA47). Open question 20 is the accessible-name concern.

Reference: the phone boards PubListPhone (390 px) and RegScan (390 px). `LoginMobile` was not downloadable. Every other page has no phone board, so its rows are derived from `docs/brand.md` (fluid width, touch targets 44/48 px, 16 px text) and are assumptions (section 9 question 11). jsdom has no layout, so every row below is **checked by hand at 320 px and 390 px** (browser devtools, real app, desktop-size screen restored after). The header and its phone rule are out of scope (`header-responsive.md`).

Phone = `max-width: 520px`, the existing breakpoint in `styles.css` (the `.event-card` rule). No new breakpoint.

| # | Source | Behaviour (all by hand at 320 and 390 px) |
|---|---|---|
| DA21 | brand.md | No horizontal scroll of the page on any route: `/`, `/login`, `/signup`, `/organizer`, `/organizer/login`, `/organizer/signup`, `/organizer/events/new`, `/event/:id` (public and organizer view), `/registrations`, `/registrations/me` (list placeholder and ticket), `/registrations/scan`, and their loading, empty and error states. Check: `document.documentElement.scrollWidth <= clientWidth`. Only a table scrolls sideways, inside its own card (DA29). |
| DA22 | PubListPhone, RegScan | Page padding on phone: `16px` on all four sides (`.page`, the scan screen too; user decision, replaces `24px 16px`). Built: `64px 16px` everywhere. |
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

**Event selector arrow and padding (user request 18-10).** The selector (`EventSelect.tsx`, `.field select`, W-R20, W-R29) now has no `appearance`, so the arrow is the browser's and sits against the border. Same look in every browser; no new library, no new element, no behaviour change. The select is never disabled today, so there is no disabled row. Input padding in `brand.md` and `.field input` is `0 12px`, so the left padding stays 12 px.

| # | Behaviour | Check |
|---|---|---|
| DA51 | `.field select` has `appearance: none` (and `-webkit-appearance: none`) and draws its own chevron as a `background-image` (inline SVG data URI, stroke in the text colour `#101C1A`, no `currentColor` because it does not work in a data URI), `no-repeat`, `background-position: right 12px center`, `background-size: 16px 16px`. The chevron is a background, so it is not in the accessibility tree and not focusable; the select keeps its native role (combobox/listbox), label and keyboard use. Height 48 px, `width: 100%`, border, radius 8, 16 px text and the `:focus-visible` ring (2 px accent, offset 2 px) stay as built. | Look. By hand (browser). jsdom: see DA54. |
| DA52 | Padding of `.field select` is `0 36px 0 12px`: 12 px left like `.field input`; right = 12 px inset + 16 px arrow + 8 px gap. Long event titles are cut at the text box (`text-overflow: ellipsis`, `white-space: nowrap`, `overflow: hidden` on the select) and never run under the arrow. | Look. By hand: pick the longest title, at 320 px too. |
| DA53 | Forced colours (Windows High Contrast): under `@media (forced-colors: active)` the select gets `appearance: auto` again, so the system draws its own arrow and colours (a background image is dropped there). Phone (<= 520 px): no change, the selector stays full width (DA29, DA32), 48 px, same padding; no new breakpoint (the 520 px block keeps its `.field select` font and width lines). | Look. By hand: devtools "Emulate CSS forced-colors: active"; 320, 390 px. |
| DA54 | Tests (jsdom has no computed layout): no new behaviour test is needed. Add one small test in `EventSelect.test.tsx` (or the existing registrations test): the select is inside `.field.event-select`, has the label "Event", is a `combobox`, `onChange` still gets the chosen id; and no `img`/`svg` role element appears inside the field (the arrow is not markup). The existing `RegistrationsPage` and `ScanScreen` tests stay green unchanged. CSS values (DA51 to DA53) are checked by hand. | Func (small) + by hand |

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
| `web/src/events/EventParts.tsx` | New `BackLink`; `EventLoadError` gets a `backTo` prop | DA35, DA39 |
| `web/src/events/CreateEventForm.tsx`, `CreateEventForm.test.tsx` | Link moved above the `h1`, uses `BackLink`; order test | DA36 |
| `web/src/events/EventPage.tsx`, `EventPage.test.tsx` | Organizer view uses `BackLink` (no visible change); `backTo="/organizer"` for the load error; its test | DA37, DA39 |
| `web/src/events/PublicEventPage.tsx`, `PublicEventPage.test.tsx` | Back link "Events" to `/` on the loaded view; `backTo="/"` for the load error; tests | DA38, DA39 |
| `web/src/registrations/TicketPage.tsx`, `TicketPage.test.tsx` | Back link "Event" in the loaded and error states; no-link checks | DA41-DA43 |
| `web/src/registrations/OrganizerRegistrations.tsx`, `OrganizerRegistrations.test.tsx` | Back link "Events" above the `h1` in every state | DA44 |
| `web/src/registrations/ScanScreen.tsx`, `ScanScreen.test.tsx` | `Shell` shows the back link "Registrations" above the `h1` in all four states (test first) | DA46 |
| `web/src/App.test.tsx` | No-link check for the top-level and auth routes | DA47 |
| `web/src/styles.css`, `web/src/registrations/EventSelect.test.tsx` | `.field select` arrow, padding, forced-colors; one small test | DA51-DA54 |
| `web/src/styles.css` | Back link spacing for all containers; remove the `.card-form .back-link` top margin | DA35, DA48 |

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
11. **Back links (DA35 to DA49).** Answer questions 16 and 17 first. (a) Tests first: DA39 (two targets) and DA46 (target by state, all four states, link before the `h1`), commit `test(web): ...`. (b) `BackLink` component, the three built links switch to it, DA36 (move), DA46, DA39, commit `feat(web): ...`. (c) New links DA38, DA41, DA42, DA44 with their tests, commit `feat(web): ...`. (d) CSS spacing and the hand check at 320 and 390 px (DA48), result in the session file. Can run any time after step 2; it touches `ScanScreen.tsx` and `OrganizerRegistrations.tsx`, so not while another step edits those files.

## 7. Done means

- Tests, typecheck and linter pass in `web/` (`bash scripts/verify.sh`).
- DA13 and DA18 have tests committed before the code; all existing `Header.test.tsx`, `eyebrow.test.tsx`, `ScanScreen.test.tsx`, `TicketPage.test.tsx` cases stay green.
- Look rows (DA1 to DA10, DA14, DA16 to DA20) are compared board against the real page side by side; the header is ignored.
- Section 2 is checked by hand at 320 px and 390 px on every route listed in DA21, with no horizontal page scroll.
- DA11, DA12, DA15 are marked "blocked" in `ROADMAP.md`, not done.
- Back links: DA39 and DA46 have tests committed before the code. Each row DA36 to DA44 has a component test (role link, exact name, `href`); DA47 has the no-link test; no screen has two back links (DA49, DA50); the header is unchanged. The built links take the D75 words ("Events", "Registrations"); their tests change (names, and the `/^Back to/` counts become the DA50 rule) and pass again. DA48 checked by hand at 320 and 390 px.

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
11. **Phone values** for pages without a phone board (padding 16, card padding 20, `h1` 30, full-width buttons, DA22 to DA34) are my derivation from PubListPhone, RegScan and `brand.md`. **Recommended:** accept them, then draw the missing phone boards (section 8) and correct the numbers.
12. **QR size.** RegTicketQr draws 200 px with a 1 px border and radius 8; W-R26 says 232 px (8 px per module), fluid down to 160. **Recommended:** W-R26 (no change).
13. **Organizer event page.** OrgEvent has no "Registrations" button, which the code has (it opens `/registrations?event={id}`), and its share line reads "Share link (same for everyone): /event/42" (built: "..., others see the public view" and the link is clickable; W-E21 says the share link is text). **Recommended:** keep the button (it is the only way from the event to its registrations apart from the header) and the built share line; only DA7.
14. **Small board and spec differences kept as built:** page top padding 48 px on list and form boards vs `brand.md` 64 px; create-form hints under all five fields (board only under description and start); events-list load error as `h1` "Events" + alert (PubListStates uses the error as the title); "Check in attendees" as a text link (RegOrg) vs button link; 44 px vs 48 px selector; "Created" row. **Recommended:** keep as built, no row.
15. **Organizer event 404.** OrgStates shows "Event not found" with "Back to events" (board text, old wording); W-E11 and W-E18 show the public 404 with "Go home" for an organizer too. **Recommended:** W-E11; the board is outdated.
16. **Public event page back link (DA38).** `events-web.md` W-E21 says "the public view has no extra links (no public list exists)". The public list `/` exists now (`events-public-list-web.md`). **Recommended (answered, built as "← Events"):** add the back link "Events" to `/` and update the W-E21 sentence (separate edit of `events-web.md`, not in this file).
17. **Target of the registrations back link (DA44).** "Events" (`/organizer`) works in every state; the event page (`/event/{id}`) needs a chosen event and "Open event page" (DA13) already goes there. **Recommended:** `/organizer`, so the chain is scan, registrations, events list, and no screen has two links to the same place.
18. **Wording of the ticket link (DA41).** "Event" (fixed word) or the event title (long titles wrap). **Recommended and decided (D75 wording):** "Event".
19. **Stale text in the files table.** The DA7 row of section 5 still says "bottom block with back link and share line", but DA7 says the back link stays at the top. **Recommended:** the DA7 row of section 1.4 (top); fix the files row in a separate edit by whoever owns DA7. DA16 also says the built text is "Registrations", but the code already read "Back to registrations" (D75: now "Registrations").
20. **Back links without a "Back" word (D75).** A link whose whole name is "Events", "Event" or "Registrations" says where it goes but not that it is a way back; a screen reader user hears only the place, and "Event" vs "Events" differs by one letter. Tests are not at risk (exact strings, DA50, 1.9a). **Recommended:** keep the user's wording; the arrow and the top-of-card place carry the meaning for sighted people, and the link name is a valid link purpose. If it is wanted, `aria-label` or visually hidden text "Back to events" would bring the word back for assistive tech only, but that contradicts D75 ("accessible name exactly ...") and is not proposed.
