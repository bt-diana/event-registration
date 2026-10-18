# Event Registration

A small service for event registration. An organizer creates an event with a limited number of seats. People register by email, and at the entrance they are checked in with a ticket code. When seats run out, new people go to a waiting list. When someone cancels, the first person on the list gets the seat and an email.

This is my solution for Task 9. I built it together with an AI agent.

> **Draft.** Only the database schema, accounts and login (milestone M1), the web login, sign-up and session screens (M1 step 6), the events API (milestone M2: organizer events, the public event page and the public events list, with an optional event description), the event screens in the web app (M2 steps 11 and 12: organizer events list, create form, one event page with the organizer and the public view) the registration API (milestone M3: register, waiting list, my registration), the check-in API (M5: `POST /checkin`, the organizer registrations list `GET /events/:id/registrations` and the arrivals route `GET /events/:id/arrivals`; the web does not read the arrivals route yet) and the registration screens in the web app (M3 step 18: register button, ticket page with its QR code, the organizer registrations list and the check-in scan screen; the attendee list is not built) are built so far. `[TODO]` marks what I fill in during and after the build. The "Project status" section must only say what really works.

## Features

- **Events:** description, date and time, seat limit.
- **Registration:** by email. Registering again with the same email does not create a second seat. A participant can cancel.
- **Waiting list:** when seats run out, new people go to the list. A cancellation gives the seat to the first person on the list, and they get an email.
- **Tickets:** every registered person gets a ticket with a code. A ticket can be checked in only once.
- **Check-in screen:** the organizer scans the ticket QR code with the camera, or types the ticket code.
- **Organizer screen:** how many people are registered, on the waiting list, and have arrived. The arrivals counter is read again when the organizer opens the page (not live).
- **Emails:** ticket on registration, seat from the waiting list, one reminder one day before the event, and a notice when the event is rescheduled.

## Tech stack

| Part | Choice |
|---|---|
| Backend | Node.js, TypeScript, Express 5, `pg`, `cookie-parser`, Vitest |
| Frontend | React, Vite, TypeScript, TanStack Query, `react-router` (v7, declarative routes), plain CSS, Vitest; `qr-creator` 1.0.0 (draws the ticket QR) and `qr-scanner` 1.4.2 (reads it from the camera), both by Nimiq, exact versions (D46) |
| Database | PostgreSQL 18 (Windows service, port 5433) |
| Email | Stub. Every email is saved in an `outbox` table and printed to the console |
| Accounts | Attendees and organizers sign up with email and password. Passwords are stored as an `scrypt` hash with a random salt (`node:crypto`). Login is one signed `session` cookie that lasts 7 days; no sessions table |

The backend and the frontend are separate apps. They talk over HTTP. The reasons for these choices are in the decisions in `sessions/`. The task allows stubs for external services, so email is not sent for real.

## Getting started

`[TODO: confirm versions and commands after the build]`

### Prerequisites

- Node.js 20 or newer
- PostgreSQL 18, installed as a Windows service on port 5433 (no Docker)
- Free ports: 3000 (API), 5173 (web) and 5433 (database)

### Run locally

```bash
# 1. PostgreSQL runs as a Windows service.
#    Copy .env.example to .env and set DATABASE_URL and COOKIE_SECRET
#    (at least 32 random characters; the API refuses to start without it).
#    Never commit .env.

# 2. Backend
cd api
npm install
npm run db:migrate   # applies the pending .sql files in api/src/db/migrations/ (001, 002, 003)
npm run dev

# 3. Frontend (in a new terminal)
cd web
npm install
npm run dev
```

Open http://localhost:5173.

The web app calls the API on its own origin. In development the Vite dev server proxies `/auth`, `/events`, `/public` and `/checkin` to the API on http://localhost:3000 (`web/vite.config.ts`), so no CORS is needed and `fetch` uses `credentials: "same-origin"`. This proxy exists only in `npm run dev`; a production build must be served from the same origin as the API (for example behind one reverse proxy), or the login cookie and the calls will not work.

### Open the app on a phone

The phone and the PC must be on the same Wi-Fi. Start the API as above, then start the web app so it listens on the network:

```bash
cd web
npm run dev:host        # dev server with live reload, http://<PC address>:5173
# or, for the built app:
npm run build
npm run preview:host    # http://<PC address>:4173
```

Find the PC's Wi-Fi address with `ipconfig` (the IPv4 address of the Wi-Fi adapter, for example `192.168.0.107`) and open `http://<that address>:5173` on the phone. Only the web app needs `--host`: the phone reaches the API through the Vite proxy on the PC.

- **The page does not load (Windows Firewall).** Windows blocks incoming connections to Node.js by default. When the prompt "Windows Defender Firewall has blocked some features of Node.js" appears, tick **Private networks** and click **Allow access**. If you missed the prompt, open PowerShell **as administrator** and run `New-NetFirewallRule -DisplayName "Vite dev 5173" -Direction Inbound -Protocol TCP -LocalPort 5173,4173 -Action Allow -Profile Private` (remove it later with `Remove-NetFirewallRule -DisplayName "Vite dev 5173"`). The Wi-Fi network must also be set to **Private** (Settings, Network & internet, Wi-Fi, your network). Check that the phone is not on mobile data or a guest network.
- **The camera does not start.** Browsers allow the camera only on https or `localhost`, so over `http://<PC address>` the scan screen shows "The camera needs a secure connection (https or localhost). Enter the code below." Typing the code and showing the ticket QR still work. For a camera test on Android Chrome, open `chrome://flags/#unsafe-treat-insecure-origin-as-secure`, add the address, enable it and restart Chrome (testing only). iPhone Safari has no such switch: use an https tunnel or a local certificate (not set up here).

### Try it with two clients

Open the registrations page (`/registrations`) in one browser tab and the check-in screen in another. Register a person and check the ticket in: the arrivals counter on the check-in screen goes up at once. The first tab shows the new number and the "Arrived" cell after you return to the registrations page (or reload it): nothing is live, there is no polling (D50, D51).

### Run the tests

```bash
cd api && npm test      # runs against the real database (each test file uses a throw-away schema)
cd api && npm run typecheck && npm run lint
cd web && npm test      # unit tests
cd web && npm run typecheck && npm run lint
bash scripts/verify.sh      # typecheck, lint and tests for api and web, stops at the first failure
cd web && npm run e2e   # two-browser test [TODO: confirm]
```

### Environment

| Variable | Used for |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (port 5433) |
| `PORT` | API port, default 3000 |
| `COOKIE_SECRET` | Signs the login cookie. At least 32 characters, or the API does not start |
| `NODE_ENV` | `production` makes the cookie `Secure` |

The API reads the repository `.env` when `DATABASE_URL` or `COOKIE_SECRET` is not already set.

## API

Described in [api/openapi.yaml](api/openapi.yaml) (OpenAPI 3.0.3, hand-written). The behaviours are in [docs/specs/auth.md](docs/specs/auth.md), [docs/specs/events.md](docs/specs/events.md), [docs/specs/event-description.md](docs/specs/event-description.md), [docs/specs/events-public-list.md](docs/specs/events-public-list.md) and [docs/specs/registration.md](docs/specs/registration.md) and [docs/specs/checkin.md](docs/specs/checkin.md) (M5: check-in and the registrations list) and [docs/specs/arrivals.md](docs/specs/arrivals.md) (M5: the arrivals route). All bodies are JSON; errors are `{ "error": "<code>" }`.

| Route | Answer |
|---|---|
| `POST /auth/users/signup`, `POST /auth/organizers/signup` | 201 `{ role, id, email, name }` and the cookie; 400 bad input; 409 email taken |
| `POST /auth/users/login`, `POST /auth/organizers/login` | 200 `{ role, id, email, name }` and the cookie; 400 bad input; 401 wrong email or password (same answer for both) |
| `POST /auth/users/logout`, `POST /auth/organizers/logout` | 204, cookie cleared |
| `GET /auth/me` | 200 `{ role, id, email, name }` for either role (the only "me" route); 401 not logged in |

Seven auth routes. There is no role-specific `GET /auth/users/me` or `GET /auth/organizers/me`; those paths answer 404.

Events (M2, [docs/specs/events.md](docs/specs/events.md)):

| Route | Answer |
|---|---|
| `POST /events` (organizer) | Body `{ title, description, starts_at, duration_minutes, capacity }`; `description` is optional. 201 organizer event; 400 bad input; 401 not logged in; 403 attendee |
| `GET /events` (organizer) | 200 `{ events: [...] }`, only the caller's events, by `starts_at` then `id`, no pagination; 401; 403 |
| `GET /events/:id` (organizer) | 200 organizer event; 404 for an unknown id, an id that is not a uuid, or another organizer's event (same body); 401; 403 |
| `GET /public/events` (no login) | 200 `{ events: [...] }` with items `{ id, title, starts_at, ends_at, duration_minutes, capacity, status, has_started, seats_left, full }` (no `description`): only events that are not cancelled and not ended, full ones too, by `starts_at` then `id`, at most 100, query string ignored; `{ events: [] }` when none ([docs/specs/events-public-list.md](docs/specs/events-public-list.md)) |
| `GET /public/events/:id` (no login) | 200 `{ id, title, description, starts_at, ends_at, duration_minutes, capacity, status, has_started, seats_left, full }`; 404 unknown or malformed id |

The organizer event is `{ id, title, description, starts_at, ends_at, duration_minutes, capacity, registered, seats_left, status, schedule_version, cancelled_at, created_at }`. `status` is derived when the event is read: `cancelled`, else `passed` once `starts_at + duration_minutes` is reached, else `active` (nothing is stored). On the public page a cancelled or passed event has `seats_left` 0 and `full` false.

The description ([docs/specs/event-description.md](docs/specs/event-description.md)) is plain text. It is trimmed and may have up to 2000 characters (code points) and no NUL; a missing, `null` or blank one is stored as `""`. It is always a string in both shapes, the same for every status, and the API never changes or escapes it. It is set only on create (there is no edit route yet).

Registration (M3, [docs/specs/registration.md](docs/specs/registration.md)):

| Route | Answer |
|---|---|
| `POST /events/:id/registrations` (attendee) | No body (ignored). 201 new registration (`registered` while seats are left, else `waitlisted`); 200 the same registration when the account is already registered or waiting; 409 `event_cancelled` or `event_passed`; 404 unknown or malformed id; 401; 403 organizer |
| `GET /events/:id/registrations/me` (attendee) | 200 the caller's registration in any status (`registered`, `waitlisted` or `cancelled`), also for a cancelled or passed event; 404 unknown or malformed id, or never registered; 401; 403 organizer |

The registration is `{ id, event_id, status, ticket_code, waitlist_position, checked_in_at, created_at }`. `ticket_code` is 10 characters from A-Z without I and O, and 2-9; waiting people get one too. `waitlist_position` is the 1-based place on the waiting list, counted when it is read, and `null` unless the status is `waitlisted`. Registering is one transaction that locks the event row (`FOR UPDATE`), so seats are never over-sold. A new seat also stores one `ticket` row in the `outbox` table; nothing is sent yet.

Check-in (M5, [docs/specs/checkin.md](docs/specs/checkin.md) and [docs/specs/arrivals.md](docs/specs/arrivals.md); all three routes are built):

| Route | Answer |
|---|---|
| `POST /checkin` (organizer) | Body `{ ticket_code }` (trimmed, upper-cased, then 10 characters of the ticket alphabet; other fields ignored). 200 `{ registration_id, ticket_code, event_id, event_title, attendee_name, checked_in_at }` the first time; 409 `already_checked_in` (with the first `checked_in_at` and `attendee_name`), `waitlisted`, `registration_cancelled` or `event_cancelled` (checked first, also for a ticket already checked in); 404 for an unknown code or another organizer's ticket (same body); 400 `invalid_input` for a bad code (no database query); 401; 403 attendee. Allowed before the start and after the end. One conditional `UPDATE` (no lock, no transaction), so of 5 parallel calls one wins; only `checked_in_at` changes, no email |
| `GET /events/:id/registrations` (organizer) | 200 `{ registrations: [...] }`: the `registered` and `waitlisted` rows of the organizer's own event, by `created_at` then `id`, each with the registration shape plus `attendee_name` and `attendee_email`; `[]` when nobody is registered; also for a cancelled or passed event. 404 for an unknown, malformed or other organizer's event (same body); 401; 403 attendee. `Cache-Control: no-store`, one statement for the rows, no lock, no paging. The arrivals counter has its own route (next row); this list stays for the table |
| `GET /events/:id/arrivals` (organizer) | 200 `{ capacity, registered, arrived }` (three numbers, nothing else) for the organizer's own event: `capacity` as stored (not reduced, not clamped), `registered` the taken seats, `arrived` those of them checked in; waiting and cancelled rows are in neither number; `0` and `0` for an event with nobody; also for a cancelled or passed event. 404 for an unknown, malformed or other organizer's event (same body); 401; 403 attendee. One statement (so `arrived` is never above `registered`), no lock, `Cache-Control: no-store` on 200 and 404, writes nothing |

Later routes use the middleware in `api/src/auth/middleware.ts`: `authenticate` puts `req.user` or `req.organizer` on the request, and `requireUser` / `requireOrganizer` answer 401 (no login) or 403 (other role).

## Web routes

From [docs/specs/auth-web.md](docs/specs/auth-web.md), [docs/specs/events-web.md](docs/specs/events-web.md) and [docs/specs/registration-web.md](docs/specs/registration-web.md) section 2, styled by [docs/brand.md](docs/brand.md). The web paths avoid the API prefixes `/events` and `/public` (one origin).

| Route | Who sees it | Shows |
|---|---|---|
| `/` | Everyone (public); an organizer is sent to `/organizer` | Attendee home: the public events list |
| `/login`, `/signup` | Logged out, or an organizer | Attendee login and sign-up form (`POST /auth/users/login`, `/signup`) |
| `/organizer/login`, `/organizer/signup` | Logged out, or an attendee | Organizer login and sign-up form (`POST /auth/organizers/login`, `/signup`) |
| `/organizer` | Organizers (guarded) | The organizer's events (`GET /events`): title (link to the event page), start, status, registered / capacity; an empty state; "Create event". Logged out: redirect to `/organizer/login?next=/organizer`. Attendee: a wrong-account message |
| `/organizer/events/new` | Organizers (guarded) | Create form: title, description (optional), start (local time), duration, capacity (`POST /events`). Client checks with the API limits; a 400 shows one form-level message. On success it goes to `/event/{id}` |
| `/event/:id` | Everyone, no guard | One link for everyone. It waits for `me`, then: the owner (a logged-in organizer whose `GET /events/:id` answers 200) sees the organizer view (all numbers, status, created date, "Back to events", the share link); everybody else, also an organizer on a 404, sees the public view (`GET /public/events/:id`): start, end, duration, Open / Full / Already started / Cancelled / Ended, seats left or only the capacity when closed. 404 on both: "Event not found". The description is shown as plain text with its line breaks. Under the public view: the registration area (below) |
| `/registrations/me?event={id}` | Attendees | The ticket page (`GET /public/events/:id` and `GET /events/:id/registrations/me`): "Your ticket", the event title (link), start, status, then the ticket (heading, status badge, place on the waiting list, the ticket code large). A `registered` ticket that is not checked in, on an event that is not cancelled, also shows "Check-in code": a QR of the ticket code only (drawn in the page on a canvas by `qr-creator`, no request) with the hints "Show this QR code at the entrance." and "If the scan does not work, show the ticket code."; a checked-in ticket shows "Checked in" and no QR. "You have no ticket for this event." when not registered; "Event not found"; loading; error with Retry |
| `/registrations/me` | Attendees. Logged out: redirect to `/login?next=` (path and query). Organizer: redirect to `/registrations` | Without `event`: "My registrations", a placeholder ("The list is not built yet."); the list needs an API route that does not exist yet |
| `/registrations` | Organizers. Logged out: redirect to `/organizer/login?next=%2Fregistrations`. Attendee: redirect to `/registrations/me` (the query is dropped) | "Registrations": a selector "Event" (the organizer's events from `GET /events`; default the `event` query parameter when it is one of them, else the first event; a change goes into `?event=`), then the arrivals counter ("Arrived: 12 / 20 registered" and "Capacity: 25" from `GET /events/{id}/arrivals`, plus "Everyone has arrived." when all registered people are in), then a table of that event's registrations from `GET /events/{id}/registrations` in the API order: Name, Email, Status ("Registered", "Waiting list", plus "Checked in"), Place, Arrival ("Arrived" and the time, "Not yet", empty for the waiting list), Ticket code, Registered. Both are read again every time the page is opened or returned to (the old rows and numbers stay until the answer comes; a failed read keeps them with "Could not refresh"); nothing refreshes by itself. States: "You have no events yet." + "Create event"; "No one has registered for this event yet." (the counter shows `0 / 0` above it); "Loading..."; "Could not load registrations" + Retry; "Event not found". A link "Check in attendees" opens the scan screen for the chosen event |
| `/registrations/scan?event={id}` | Organizers. Logged out: redirect to `/organizer/login?next=`. Attendee: redirect to `/registrations/me` | "Check in": the selector "Event" and under it the arrivals counter (the same numbers and cache as on `/registrations`; read when the screen opens and again after each successful check-in, the organizer stays on the screen and the list is not read); "Start camera" asks for the back camera only after the click (states: waiting for permission, live preview, blocked, no camera, not a secure connection, other error with "Try again"); the camera reads the QR with `qr-scanner`; the text must be a ticket code ("This is not a ticket code." otherwise, no request). Under it "Or enter the code" with the field "Ticket code" and "Check in". One code sends one `POST /checkin`; reads are ignored until "Scan next". Results: "Checked in" (name, event, code), "Already checked in" (name, first time), "Ticket not found.", "On the waiting list, no seat yet.", "This ticket is cancelled.", "This event is cancelled.", "Something went wrong. Try again." with "Try again". The camera is stopped when leaving the screen or changing the event |

Registration area on the public view of `/event/:id` ([docs/specs/registration-web.md](docs/specs/registration-web.md)): logged out sees a link "Log in to register" (or "Log in to join the waiting list" when full) that comes back to the event after login. An attendee's registration is read once (key `["registration", me.id, eventId]`, 404 means "not registered"); then a button "Register", "Join waiting list" (when full, with "This event is full.") or "Register again" (after a cancelled ticket), or the ticket panel ("You are registered" / "You are on the waiting list" with the place / "Registration cancelled", the ticket code and "View ticket"). A closed event (Cancelled, Ended) has no button. One click sends one `POST` (the button is disabled while pending, also on a double click); 201 and 200 both show the ticket from the answer, and the event and the home list are read again. 409 shows "Registration is closed.", 404 turns the page into "Event not found", 401/403 re-check `me`, a network error or 5xx shows "Something went wrong. Try again.". An organizer sees no registration area and makes no registration request.

At start the app calls `GET /auth/me` once (TanStack Query key `["me"]`); 401 means logged out. Login and sign-up put the answer into that cache, so no second call is made, and then go to a safe `?next=` path or the role's home. A person already logged in with the page's role is sent on from the login and sign-up pages. The header shows "Log in", "Sign up" and "For organizers" (or "For attendees" on `/organizer` pages) when logged out, and, when logged in, a link "My registrations" (attendee) or "My events" (organizer), the name and role together (the name on one line with an ellipsis, the full name in `title`) and "Log out". Up to 640 px the header is the logo and a Menu button; the button, or a click on the header row, opens a modal drawer the full width of the page that opens downward out of the header row, which stays visible (D69, D70, then user requests), with Close menu, "All events" (to `/`) and then these items stacked in that order. While it is open the page behind is `inert`, the body does not scroll and Tab stays inside the drawer; Close menu, the backdrop, Escape or a new page close it (`header-responsive.md`, D65-D70). Over 640 px everything is in one row and there is no Menu button, drawer or "All events". The logo links to `/` for everyone (D64). A logged-in organizer keeps the organizer look on every screen, also on `/` and `/event/:id`: the logo and tab icon are the organizer ones (W-E22).

## Project structure

Partly planned. `[TODO: update after the build]`

```
api/                 backend (Express, TypeScript)
  openapi.yaml       the API description (auth, event, registration and check-in routes)
  src/app.ts         createApp: JSON, cookie-parser, authenticate, routes
  src/auth/          password hashing, session cookie, middleware, auth routes
  src/events/        routes.ts: the organizer event routes, the public event page and
                     the public events list;
                     status.ts: the derived status (active, cancelled, passed)
  src/registrations/ routes.ts (register, my registration), service.ts (the locked
                     register transaction), ticket.ts (ticket codes)
  src/checkin/       routes.ts (POST /checkin with the code check, the organizer
                     registrations list, the arrivals route), service.ts (checkIn: the
                     conditional UPDATE and the classify read; listRegistrations;
                     getArrivals)
  src/db/            pool, migrator, migrations (SQL: 001_init, 002_event_duration,
                     003_event_description)
  test/              Vitest tests (auth/, db/, events/, registrations/, checkin/)
web/                 frontend (React, Vite, TypeScript)
  src/main.tsx       QueryClientProvider, BrowserRouter, styles.css
  src/App.tsx        header and routes
  src/auth/          api.ts (fetch wrapper), session.ts (useMe and the login, sign-up and
                     logout mutations), validate.ts (client checks, safeNext), guards.tsx
                     (RequireRole, RedirectIfLoggedIn), AuthForm, Header, and their tests
  src/events/        api.ts (event routes), queries.ts (hooks, 401/403 re-check me),
                     format.ts (dates in the viewer's zone, durations), validate.ts,
                     publicStatus.ts (the public status line), EventsList,
                     CreateEventForm, EventPage (picks the view), PublicEventPage,
                     EventParts, StatusBadge, and their tests
  src/registrations/ api.ts (register, my registration), queries.ts (hooks, keys by
                     account), ticket.ts (registerAction, ticketLabel, showQr),
                     RegistrationArea, TicketPanel, TicketPage, qr.ts (drawQr, the only
                     qr-creator import), QrCode, entries.tsx (the role redirects of
                     /registrations and /registrations/me), OrganizerRegistrations (the
                     organizer list with the Arrival column), EventSelect, arrivals.ts
                     (useEventArrivals), ArrivalsCounter, ScanScreen (/registrations/scan),
                     scanner.ts (the only qr-scanner import), camera.ts, ticketCode.ts,
                     the attendee list placeholder,
                     and their tests
  src/styles.css     brand tokens and styles from docs/brand.md
ROADMAP.md           the order of work, milestones and steps
sessions/            the work log: one markdown file per session
.claude/             agent rules (CLAUDE.md), agents and skills
docs/
  specs/             the specs the build follows (SPEC_TEMPLATE.md)
  planning/          the first build plan (out of date, see ROADMAP.md)
  research/sdd/      research about AI-driven development approaches
  skills/            the skill I used (audited-research)
```

## How it works

The hard cases are handled in the database, not in application code.

- **Last seat, two people at once:** registration runs in one transaction that locks the event row first. The second person waits, then sees that the seat is gone and goes to the waiting list.
- **One seat per account:** registering needs a login, so the same email is the same account. Inside the locked transaction an active registration of the account is answered again (200, same ticket); a partial unique index on (event, user) for active rows is the safety net.
- **Cancel and promote:** one locked transaction cancels the seat, promotes the first person on the list (by registration time) and saves the email.
- **Check in once:** one `UPDATE ... WHERE checked_in_at IS NULL` statement. If it changes zero rows, the ticket was already used.
- **One reminder:** a worker runs on a timer and saves a reminder with a unique key per registration and event start time. Two workers, or repeated runs, still give one reminder.
- **Reschedule:** the date changes, and everyone registered or on the waiting list gets an email. A moved event can get a new reminder for the new time.

## How the behaviour is proven

All of these are automatic tests. `[TODO: fill the Status column with real results and link the test files]`

| Expected behaviour | How it is proven | Status |
|---|---|---|
| Ticket email on registration; same email twice gives one seat | Register twice, and 5 times at once from one account. One registration, one `ticket` outbox row, same code (the email is stored, not sent yet) | Passes (API): `api/test/registrations/register.test.ts`, `rules.test.ts` |
| Seats full, new people go to the waiting list | Capacity 2, register 5, check the statuses and the places 1, 2, 3 | Passes (API): `api/test/registrations/register.test.ts` |
| Cancel gives the seat to the first person and sends an email | Cancel one. The oldest waiting person is registered and gets an email. The next one is unchanged | ☐ |
| Two people compete for the last seat | Capacity 1, 20 attendees register at once through the API. Exactly 1 registered and 19 waiting with places 1 to 19, one ticket email. Repeated on 5 fresh events, plus capacity 3 (3 and 17) and capacity 0 | Passes (API): `api/test/registrations/register.test.ts` |
| One reminder, one day before | Fake clock to 24 hours before. Run the worker many times and with two workers. One reminder per person | ☐ |
| Ticket checks in once | 5 check-ins of one code at once through the API. One succeeds, four are refused with `already_checked_in` and the first time; repeated on 5 fresh tickets | Passes (API): `api/test/checkin/checkin.test.ts` |
| Arrivals counter after a check-in | Check in on the scan page, go back to the registrations page: the list and the numbers are requested again and include the new arrival | Passes (web, `fetch` mocked): `web/src/registrations/ArrivalsCounter.test.tsx`, `OrganizerRegistrations.test.tsx`, `ScanScreen.test.tsx`; by hand against the real API: not done yet |
| Reschedule emails everyone | Reschedule. One email per registered and waiting person | ☐ |
| Works with two clients open | The two-browser test above, plus a screenshot | ☐ |

## Project status

`[TODO: fill in honestly after the build. Do not copy the plan here.]`

- **Works:** the database schema and migrator. Accounts and login (API only, M1): sign-up, login and logout for attendees and organizers, `GET /auth/me` for either role, the signed 7-day cookie (expiry checked on the server), and the `authenticate`, `requireUser` and `requireOrganizer` middleware. Behaviours A1-A18 of `docs/specs/auth.md` (except the removed A11) have tests in `api/test/auth/` and `api/test/app.test.ts`.
- **Works (web, M9 step 28):** sign-up, login and logout in the browser for both roles, the session from one `GET /auth/me`, the `RequireRole` and `RedirectIfLoggedIn` guards (loading, error with Retry, redirect with `next`, wrong-account message), client checks, the API error texts (400, 401, 409, 5xx and network), pending buttons, focus and aria. Behaviours W-A1 to W-A20 of `docs/specs/auth-web.md` have component tests in `web/src/` (`fetch` mocked). Not covered by a test: the W-A20 part "the cookie is `httpOnly` and the app never reads it" (an API fact, tested in `api/`; the web code has no cookie access). The contract was checked by hand through the dev proxy with `curl` (sign-up 201, a second sign-up 409, `me` 200 with the cookie, logout 204, `me` 401 after it, wrong password 401, bad body 400); the full browser walk-through (reload, redirect back after login) is still to be done by hand.
- **The UI guards are not security.** They only decide what the screen shows. The API is the real guard (`requireUser`, `requireOrganizer`): a person who edits the page in the browser still gets 401 or 403 from the API.
- **Works (API, M2):** an organizer creates events (`POST /events`, with title, start, duration and capacity) and lists and reads only their own (`GET /events`, `GET /events/:id`; another organizer's event answers 404 like a missing one). Anyone reads the public event page (`GET /public/events/:id`, no login) with the start and end, capacity, seats left, `full`, `has_started` and the status `active`, `cancelled` or `passed` (derived from the start and the duration with the server clock, not stored). Migration `002_event_duration.sql` adds `events.duration_minutes`. Behaviours E1-E20 of `docs/specs/events.md` have tests in `api/test/events/` and `api/test/db/`. Events cannot be edited, cancelled or rescheduled through the API yet (M4, M7).
- **Works (API, event description):** `POST /events` takes an optional plain-text `description` (trimmed, up to 2000 code points, no NUL; missing, `null` or blank gives `""`), and both event shapes answer it (organizer: create, read and list; public page: for every status). Migration `003_event_description.sql` adds `events.description` (`NOT NULL DEFAULT ''`, `CHECK (char_length(description) <= 2000)`); older rows get `""`. Behaviours DS1-DS13 of `docs/specs/event-description.md` have tests in `api/test/events/description.test.ts`, `api/test/db/constraints.test.ts` and `api/test/db/migrate.test.ts` (DS13, no new error code, is covered by the `invalid_input` checks). The description cannot be changed after create (no edit route yet).
- **Works (API, public events list):** anyone, without login, gets `GET /public/events`: the events that are not cancelled and have not ended (upcoming and running, full ones too), by `starts_at` then `id`, at most 100, with one server `now` per request. Each item is the public event without `description` (exactly ten keys, no organizer or registration data). Behaviours PL1-PL11 of `docs/specs/events-public-list.md` have tests in `api/test/events/publicList.test.ts`. There is no pagination: with more than 100 open events the later ones are not in the list. The attendee home screen that shows the list is not built yet (step 12d).
- **Works (web, M2 steps 11 and 12):** the organizer events list (`/organizer`: one `GET /events`, rows in the API order, Active / Cancelled / Ended, "registered / capacity", empty, loading and error with Retry) and the create form (`/organizer/events/new`: client checks with the API limits, the start entered in local time and sent in UTC, one `POST /events` also after a double click, 400 and 5xx/network messages at form level, focus and aria). A 401 or 403 from an event call re-checks `me`, so the guard redirects to the login or shows the wrong-account message. The event page `/event/:id` is one link for everyone: the owner sees the organizer view with the real numbers, everybody else (logged out, an attendee, another organizer, or `me` failed) the public view with the status line (Cancelled, Ended, Already started, Full, Open, in that order; only Cancelled and Ended say "Registration is closed."), loading, "Event not found" and load errors with Retry. The form sends `description`; both views show it as plain text with its line breaks (never as HTML), the list does not. The API sends `description` in both shapes now; the web still treats a missing one as empty. Dates are shown in the viewer's time zone with the zone name. Behaviours W-E1 to W-E23 of `docs/specs/events-web.md` (W-E22 from an earlier step) and RE1 of `docs/specs/role-eyebrow.md` have component tests in `web/src/events/` and `web/src/auth/Header.test.tsx` (`fetch` mocked). The organizer pages are read only; the public view got the registration area in M3 step 18 (below). Not done yet: the manual check against the real API with two organizers (`events-web.md` section 5).
- **Works (web, M2 step 12d):** the attendee home `/` shows the public events list (`GET /public/events`, key `["public-events"]`): a card per upcoming or running event with the title (a link to `/event/:id`), the start, the duration and a badge (seats left, Full or Already started), plus loading, empty ("No upcoming events.") and error with Retry. A logged-in organizer is redirected to `/organizer` with no list request. A registration marks the list stale, so it is read again when the person goes back (W-L13). Not done yet: the manual check against the real API.
- **Works (API, M3):** a logged-in attendee registers for an event (`POST /events/:id/registrations`) and reads their own registration (`GET /events/:id/registrations/me`): ticket code, status and place on the waiting list. The register transaction locks the event row, so 20 attendees at once for the last seat give exactly one seat and 19 waiting places (tested). Registering again answers the same ticket (200). Cancelled and passed events answer 409; a running event still accepts registrations. A new seat stores one `ticket` row in the `outbox` table. Behaviours R1-R22 of `docs/specs/registration.md` have tests in `api/test/registrations/`. Not built yet: cancelling a registration and promoting the first waiting person (M4), and the email sender (outbox rows are only stored, nothing is sent or printed, M6).
- **Works (API, M5 steps 25 and 26, check-in):** an organizer checks a ticket in at the door (`POST /checkin` with `{ ticket_code }`, trimmed and upper-cased). The first time answers 200 with the registration id, the code, the event id and title, the attendee's name (no email) and `checked_in_at`; one conditional `UPDATE` without a lock or a transaction makes sure that of 5 parallel calls with one code exactly one succeeds and the others get 409 `already_checked_in` with the first time and the name (tested on 5 fresh tickets). A waiting ticket answers `waitlisted`, a cancelled one `registration_cancelled`, a ticket of a cancelled event `event_cancelled` (also when it was already checked in); an unknown code and another organizer's ticket give the same 404; a bad code answers 400 before any query. Passed and not yet started events allow check-in. Only `checked_in_at` changes, no outbox row. Behaviours C1-C14 and C19 of `docs/specs/checkin.md` have tests in `api/test/checkin/checkin.test.ts` (C12: the retry after a waitlist promotion is tested by promoting the ticket between the `UPDATE` and the read). Not covered by a test: the C12 ordering between check-in and cancelling a registration, because cancelling is not built yet (M4).
- **Works (API, M5 step 26, registrations list):** an organizer reads the registrations of one of their own events (`GET /events/:id/registrations`): the `registered` and `waitlisted` rows by `created_at` then `id`, each with the registration shape plus the attendee's name and email, `[]` for an event with nobody, also for cancelled and passed events. An unknown, malformed or other organizer's event answers the same 404; a malformed id never reaches the database. The rows come from one statement with no lock, and the answer has `Cache-Control: no-store`, so every return to the page reads it fresh. The arrivals counter has its own route (next point); nothing is live (no polling, no server-sent events, D51). Behaviours C1 (for this route) and C15-C19 (list side) of `docs/specs/checkin.md` have tests in `api/test/checkin/registrationsList.test.ts` and `api/test/checkin/checkin.test.ts` (C16: a refused check-in changes nothing in the list, a check-in changes only that item).
- **Works (API, M5, arrivals route):** an organizer reads `GET /events/:id/arrivals` for one of their own events and gets `{ capacity, registered, arrived }`: the stored capacity, the taken seats and how many of them are checked in. Waiting and cancelled rows never count (tested also with a wrong `checked_in_at` on them, in a test schema where the table CHECK is dropped). Both numbers come from one SQL statement, so `arrived` is never above `registered`; after a 200 check-in the next read is one higher, a refused or repeated check-in changes nothing, 5 parallel check-ins of one code raise it by one and of 5 codes by five (5 rounds). Unknown, malformed and foreign events give the same 404; the answer has `Cache-Control: no-store` and the route writes nothing. Behaviours AR1-AR15 of `docs/specs/arrivals.md` have tests in `api/test/checkin/arrivals.test.ts`. The web app reads it for the arrivals counter (next points).
- **Works (web, M5 step 28, arrivals counter and Arrival column):** the scan screen and the registrations page show "Arrived: {arrived} / {registered} registered", "Capacity: {capacity}" and, when everyone registered is in, "Everyone has arrived.", exactly as `GET /events/:id/arrivals` sends them (the browser counts nothing). Both screens share one query per account and event (`["event-arrivals", me.id, eventId]`). It is read when a screen opens, on every return (`staleTime: 0`, `refetchOnMount: "always"`) and after a 200 check-in (only `["event-arrivals"]` is invalidated, a running read is cancelled first; the organizer stays on `/registrations/scan` and the list is not read there); a 409, 404, 400 or error reads nothing. The registrations list is read again on every return too, and its new "Arrival" column ("Arrived" and the time, "Not yet", empty for the waiting list) comes from the rows. Nothing refreshes by itself: no interval, no refetch on focus or on reconnect (tested with fake timers). A return shows the cached numbers and rows until the answer comes; a failed read keeps them with "Could not refresh"; a new event or account never shows the old numbers. States: "Loading arrivals...", "Could not load arrivals" + Retry, "Event not found" (once per page), 401/403 to the guard. Behaviours W-C1 to W-C18 of `docs/specs/checkin-web.md` have component tests in `web/src/registrations/ArrivalsCounter.test.tsx`, `OrganizerRegistrations.test.tsx` and `ScanScreen.test.tsx` (`fetch` mocked). Not covered by a test: the style values (W-C2 sizes, the 48px Retry of W-C18, W-C19; jsdom has no layout) and W-C17 "rows are keyed by `id`" (seen in the code only). Not done yet: the manual check against the real API (`checkin-web.md` section 5) and the design canvas board.
- **Works (web, M3 step 18):** register and ticket work. On the public event page a logged-out person gets a login link that comes back to the event; an attendee gets "Register", "Join waiting list" (full) or "Register again" (cancelled ticket), or their ticket panel (code, status, place on the waiting list, "View ticket"); closed events have no button; an organizer sees nothing of it. One click sends one `POST`, also on a double click; the server decides the seat (a "Register" answered with a waiting place shows the waiting ticket); 409, 404, 401/403, 5xx and network errors are handled; the registration cache is keyed by the account. The ticket page `/registrations/me?event={id}` shows the event and the ticket. `/registrations/me` (attendees) and `/registrations` (organizers) redirect the other role to its own screen and logged-out people to the login with `next`. The header has "My registrations" or "Registrations". Behaviours W-R1 to W-R23 of `docs/specs/registration-web.md` (open questions 1-8 taken as recommended) have component tests in `web/src/registrations/`, `web/src/events/PublicEventPage.test.tsx` and `web/src/auth/Header.test.tsx` (`fetch` mocked). The organizer screen `/registrations` shows the registrations of a chosen event as a table (W-R20, W-R21, tests in `web/src/registrations/OrganizerRegistrations.test.tsx`). Not built: the attendee list `/registrations/me` is a placeholder ("The list is not built yet.", tests `it.todo`) until an API route exists (question 1); The organizer scan screen `/registrations/scan` (W-R28 to W-R37, `qr-scanner`, D46) checks tickets in with the camera or a typed code through `POST /checkin` (tests in `web/src/registrations/ScanScreen.test.tsx`, `entries.test.tsx`, `scanner.test.ts`, `camera.test.ts`, `ticketCode.test.ts`; the camera and the decoder are mocked in jsdom). Not checked yet: the real camera read and the QR scan with a phone (`registration-web.md` section 5, by hand). The ticket page shows a QR of the ticket code (W-R24 to W-R27, `qr-creator`, D46): only for a `registered` ticket that is not checked in, on an event that is not cancelled; tests mock the drawing (jsdom has no canvas), so the QR itself is checked by hand with a phone (not done yet). No cancel or email UI. Not done yet: the manual check against the real API (`registration-web.md` section 5).
- **Works (web, design alignment, `docs/specs/design-alignment.md`):** the registrations page has an "Open event page" link to the chosen event (DA13); the scan screen shows the four camera problems as alerts (DA18). Both have component tests in `OrganizerRegistrations.test.tsx` and `ScanScreen.test.tsx`. The login and sign-up pages use the board copy ("Use the email you registered with.", "Create your account", "Organizer log in", "No organizer account?", DA1-DA3, checked in `App.test.tsx`); the scan back link reads "Back to registrations" (DA16). Load errors of the registrations page and the scan screen, the camera problems, "This is not a ticket code." (now inside the camera card) and the refused or failed scan results use one error box (2 px error border), Retry and Try again are secondary, Scan next is primary (DA14, DA19, DA20). The scan camera is one dark 4:3 box: "Camera is off" when idle, the permission text while asking, the preview with a white square frame and a status bar while active (DA17). The ticket page panel has a 2 px border (accent for a seat, gray for the waiting list or a cancelled ticket), the "Check-in code" heading is 18 px and left aligned, and every ticket code (ticket page, event page panel, organizer table, scan result, typed code) is in a monospace font (DA8-DA10). On the public event page the seats text ("12 of 25 seats left") is its own line under the details (DA5) and the register button or login link fills the card width (DA6); the organizer event page keeps "Back to events" at the top (D70) and has 24 px above and below the "Registrations" button (DA7); the wrong-account card shows its two links as a primary and a secondary button (DA4). Phone layout (up to 520 px, DA21-DA34): 16 px page padding (D71), `h1` 30 px, 20 px card padding, 12 px between event cards, full-width buttons in cards, stacked list heads, full-width event selector, 24 px ticket code, long titles, names and emails wrap, and only the tables scroll sideways. Written as CSS only; not checked by hand at 320 and 390 px yet. Back links (DA35-DA49): one shared `BackLink` ("<- Back to ...", above the `h1`); the create form link is above the `h1` now (DA36), the scan screen shows "Back to registrations" above the `h1` in every state (to `/registrations` when no event is chosen, DA46), and "Could not load this event" has "Back to events" to `/organizer` or `/` (DA39); New: "Back to events" to `/` on the public event page (DA38), "Back to event" on the ticket page and its load error (DA41, DA42), "Back to events" to `/organizer` on the registrations page in every state (DA44); "Event not found", the "no ticket" state, loading, the top-level and the login pages have none (DA40, DA43, DA47), and no screen has two (DA49). Tests in `EventPage.test.tsx`, `PublicEventPage.test.tsx`, `ownership.test.tsx`, `TicketPage.test.tsx`, `OrganizerRegistrations.test.tsx`, `ScanScreen.test.tsx`, `eyebrow.test.tsx` and `App.test.tsx`. These are look rows with no test; not compared with the boards in a browser yet. Not built: DA11, DA12 (wait for `GET /me/registrations`) and DA15 (waits for M4).
- **Does not work, or not done, and why:** cancel and promotion, sending emails, the attendee registrations list in the web app, and the rest of the web app are not built yet (milestones M4, M6 and M7 in `ROADMAP.md`). Live updates are not planned (D51): another device's check-ins show after a return to the page or a reload.
- **Known limits of the login:** logout only clears the cookie in the browser (the web app then shows the logged-out header; it cannot do more). A copy of the cookie stays valid until its 7 days end, because there is no sessions table (a test shows this). `sameSite=lax` is the only CSRF defence, which is not full protection (for example a hostile subdomain). No rate limiting, password reset or email verification.
- **Known limits (expected, confirm after the build):** nothing is live (D51), so the counter of a second window is as fresh as its last open, return or check-in. The reminder worker checks on a timer and uses the server clock. Email is a stub.
- **Assumption:** the task does not say what happens to reminders after a reschedule. I assume one reminder per person per start time.

## How it was built

I built this project together with an AI agent, and I do not hide it.

- **Tool:** Claude Code `[TODO: confirm]`
- **Models:** my default session model is Sonnet 5.5 at medium effort. I use it for research, for writing the spec and for basic work with text. For code I switch to Opus 5.5 at high effort. Both are set as agents in `.claude/agents/`: `spec-writer` and `code-writer`. `[TODO: confirm the exact model names shown by /status at build time]`
- **Why these models:** I use Sonnet for basic work with text, so not many tokens are spent on it. I keep Opus for the code, because from my experience it works well with code, and the code is the part where quality is very important. The research and the first README draft were done in a Claude chat with Sonnet, before the build.
- **Why Claude Code:** from my experience, Claude works best with code. I also have a subscription, and I am used to Claude Code.

My process is a light version of spec-driven development:

1. One spec document. It has the goals and expected behaviour, the UI decisions, the architectural decisions, and the files to touch with what to do in each.
2. Tests first for the hard parts: the last seat, the single reminder and the single check-in.
3. A `SubagentStop` hook on `code-writer` (`.claude/settings.json`, `.claude/hooks/verify-then-review.sh`): it runs `scripts/verify.sh` (typecheck, lint, tests) and blocks until it passes, then makes the agent run a code review and fix the findings.

Why I chose this process is in decision D1 in [sessions/17-10-1532_research.md](sessions/17-10-1532_research.md). The research is in `docs/research/sdd/`, and the skill I used for it is in `.claude/skills/audited-research/`.

## Documentation

- `sessions/*.md`: one file per session with its prompts and decisions (time, reason)
- [ROADMAP.md](ROADMAP.md): the order of work, milestones and steps
- [docs/specs/SPEC_TEMPLATE.md](docs/specs/SPEC_TEMPLATE.md): the template for feature specs (one spec per feature)
- [docs/brand.md](docs/brand.md): colours, type, spacing and components for the web UI. It comes from the [design artifact](https://claude.ai/artifact/Ca1zKGzeKDGuXHhn7J5L76) (login and sign-up screens, made from `docs/specs/auth-web.md`); change `brand.md` first when a value changes
- [docs/DATABASE.md](docs/DATABASE.md), [docs/specs/auth.md](docs/specs/auth.md), [docs/specs/auth-web.md](docs/specs/auth-web.md), [docs/specs/events.md](docs/specs/events.md), [docs/specs/event-description.md](docs/specs/event-description.md), [docs/specs/events-public-list.md](docs/specs/events-public-list.md), [docs/specs/registration.md](docs/specs/registration.md), [docs/specs/checkin.md](docs/specs/checkin.md), [docs/specs/arrivals.md](docs/specs/arrivals.md), [docs/specs/header-events-link.md](docs/specs/header-events-link.md), [docs/specs/header-responsive.md](docs/specs/header-responsive.md), [docs/specs/email-reminders.md](docs/specs/email-reminders.md), [docs/specs/design-alignment.md](docs/specs/design-alignment.md): the database schema, the accounts and login API, the login screens, the events API, the event description, the public events list API, the registration API, the check-in API and the organizer registrations list, the arrivals route (all three built), the stub email sender with retries and the reminder worker (M6, spec only, not built yet), the header logo as the link to the events list (D64, built), the header grouping and the phone drawer from the right (D65-D70, built; layout and animation not checked by hand yet), the alignment of all other screens and the phone layout with the design canvas (being built, see "Project status")
- [api/openapi.yaml](api/openapi.yaml): the API description (OpenAPI 3.0.3)
- [docs/planning/build_plan.md](docs/planning/build_plan.md): the first build plan, out of date (Fastify, Docker); `ROADMAP.md` replaces it
- [docs/research/sdd/summary.md](docs/research/sdd/summary.md): the research summary (the full report and sources are in the same folder)
- [.claude/skills/audited-research/SKILL.md](.claude/skills/audited-research/SKILL.md): the skill I used for the research
- `sessions/`: the work log, one markdown file per session

## Progress over time

The task asks to see how the work went from start to end. I record it in two places, so that no single one has to be perfect:

- **Git commits:** one commit after every finished step. Commit times are the independent clock. The timeline is `git log --date=iso`.
- **`sessions/`:** one markdown file per session. Each step has my prompt, a short description of what Claude did and which tools it used, and my decision if there was one, with the time. The work before the build was done in a Claude chat, so those steps were written by hand. During the build the agent writes the steps itself, as the rules in `.claude/CLAUDE.md` say.

I do not export the raw session files, only these markdown logs. The agent writes them, so it can forget a step. At the end I compare `git log` with the session files to find gaps.

- **Research and process decision (D1):** the day before, after 15:32 +06 `[TODO: exact time]`
- **Build started:** `[TODO: time and timezone]`
- **Build finished:** `[TODO: time and timezone]`

## Next steps

`[TODO: fill after the build. Ideas from the plan:]`

- Send real emails instead of the outbox stub.
- Add a message queue and a shared event stream, so more than one server instance works.
- Send reminders in each participant's own time zone.

## Credits and disclosure

- The project was built together with an AI agent (Claude Code). The prompts, what the agent did and my decisions are in `sessions/`.
- `[TODO: confirm. Planned: no template or generator, except the standard Vite React scaffold.]`
