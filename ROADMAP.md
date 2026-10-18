# Roadmap

Order of work for the event registration service. One row = one step = one commit (or a tests-first commit, then a code commit). Every milestone has two specs, an API spec and a UI spec, and two parts of work: the API in `api/`, then the screens in `web/`. A step is done only when tests, typecheck and linter pass. Behaviour ids (B1-B10) are from `docs/specs/SPEC_TEMPLATE.md` and `docs/DATABASE.md`.

`build_plan.md` is the first plan and is out of date (Fastify, Docker, PostgreSQL 16, no accounts). This file follows the current decisions: Express, PostgreSQL 18 on Windows, attendee and organizer accounts, signed cookie.

The web app is not a milestone of its own any more (D35). Its screens are built in the milestone of their feature. Step numbers changed with D35; the old step 28 (web login and session) is step 6 now. Older session files keep the old numbers.

## Done

- Repo, `api/` and `web/` set up, eslint, env example, database setup.
- Database schema, migrator and schema tests (`DATABASE.md`).
- M1 API: accounts and login (`auth.md`, A1-A18, A11 removed): hashing, signed cookie, seven auth routes, middleware and guards, `api/openapi.yaml`.
- M1 UI: web login and session (`auth-web.md`, W-A1-W-A20): sign-up, login and logout pages for both roles, `me` session, guards, dev proxy.
- M2 API spec: `events.md`.
- M2 API: events (`events.md`, E1-E20): migration `002_event_duration.sql`, `POST /events`, `GET /events`, `GET /events/:id` for the owner, `GET /public/events/:id`, `api/openapi.yaml`.
- M2 UI spec: `events-web.md` (W-E1-W-E21): organizer events list, create form, event page, public event page.
- M2 UI: event screens (`events-web.md`, W-E1-W-E23; `role-eyebrow.md` RE1): `/organizer` events list, `/organizer/events/new` create form, `/event/:id` with the organizer and the public view, dev proxy for `/events` and `/public`.
- M2 API: event description (`event-description.md`, DS1-DS13): migration `003_event_description.sql`, optional `description` on `POST /events`, in both event shapes, `api/openapi.yaml`.
- M2 specs for the public events list: `events-public-list.md`, `events-public-list-web.md`.
- M2 API: public events list (`events-public-list.md`, PL1-PL11): `GET /public/events` (not cancelled and not ended, by `starts_at` then `id`, at most 100, no `description`), `api/openapi.yaml`.
- M2 UI: public events list (`events-public-list-web.md`, W-L1-W-L13): `/` lists the open events as cards (title link, start, duration, badge from `publicStatus`), with loading, error with Retry and empty states; it waits for `me` and redirects an organizer to `/organizer` with no list request. The W-L13 invalidation from the register handler came with step 18.
- M3 API spec: `registration.md` (R1-R22): register, waiting list, last seat, my registration.
- M5 API spec: `checkin.md` (C1-C19): check-in by ticket code, organizer registrations list for the arrivals counter.
- M3 API: registration (`registration.md`, R1-R22): `POST /events/:id/registrations` (one transaction, `FOR UPDATE` on the event, `ticket` outbox row), `GET /events/:id/registrations/me`, shared `api/src/events/status.ts`, `api/openapi.yaml`.
- M3 UI spec: `registration-web.md` (W-R1-W-R37).
- M3 UI: register area and ticket page (`registration-web.md`, W-R1-W-R23): register button, waiting list and login link on the public event page, ticket panel, ticket page `/registrations/me?event={id}`, the `/registrations` and `/registrations/me` redirects, header links. The two lists are placeholders; the QR and the scan screen (W-R24-W-R37) are not built (new libraries need the user's OK; check-in API is step 26).

## Milestones

| # | Milestone | API spec | UI spec | Behaviours | Tests first |
|---|---|---|---|---|---|
| M1 | Accounts and login | `auth.md` | `auth-web.md` | | auth basics; session and guards |
| M2 | Events (organizer) | `events.md` | `events-web.md` | | ownership |
| M3 | Register and waiting list | `registration.md` | `registration-web.md` | B1, B2, B4 | B4 |
| M4 | Cancel, promote, capacity change | `registration.md` (extend) | `registration-web.md` (extend) | B3, B10 | |
| M5 | Check-in and arrivals counter | `checkin.md` | `checkin-web.md` | B6, B7 | B6 |
| M6 | Outbox sender and reminder worker | `email-reminders.md` | `email-reminders-web.md` | B5 | B5 |
| M7 | Reschedule and event cancel | `email-reminders.md` (extend) | `email-reminders-web.md` (extend) | B8, B9 | |
| M8 | Live updates | `checkin.md` (extend) | `checkin-web.md` (extend) | B7 | |
| M9 | Review and README | | | all | |
| M10 | Test data (seed) | `seed.md` | | | |

## Steps

Specs are not written all at once. The first steps of each milestone write (or extend) its API spec and its UI spec in `docs/specs/`, made from `SPEC_TEMPLATE.md` with the `spec-writer` agent. A spec lists only the behaviours, UI states and routes of its own feature. The UI spec says which API route each screen uses and which states it shows (loading, error, empty, and the cases of the feature). `DATABASE.md` already exists. The template stays untouched. UI steps are test first: component tests, then the screens, with typecheck and lint clean.

### M1. Accounts and login
1. API spec: `auth.md` (done).
2. Test, then code: password hashing (scrypt, random salt) and the signed cookie (7 days) (done; `cookie-parser` and `@types/cookie-parser` installed with the user's OK).
3. Test, then code: attendee sign-up, login, logout. Same for organizers. Also `GET /auth/me` ("who am I", the only "me" route) and `role` in the answers (`auth.md` A17, A18). The role-specific `GET /auth/users/me` and `GET /auth/organizers/me` (A11, A19) were removed later (done; described in `api/openapi.yaml`).
4. Auth middleware that puts `user` or `organizer` on the request. Tests: no cookie gives 401, an attendee cookie cannot use organizer routes (done).
5. UI spec: `auth-web.md` (done: login and sign-up screens, session, guards).
6. Test, then code: `react-router` (approved), app shell, API client, TanStack Query `me`, guards, sign-up and login pages for both roles (W-A1 to W-A20) (done: Vite dev proxy for `/auth` (D34)).

### M2. Events
7. API spec: `events.md` (done).
8. Test, then code: organizer creates, lists and reads own events. Another organizer's event answers 404 (`DATABASE.md` 3.8) (done: migration `002_event_duration.sql`, `api/src/events/routes.ts`; `events.md` calls this step 6).
9. Test, then code: public event route (no login): title, start, seats left, full or not (done: `GET /public/events/:id` with the derived status; `events.md` calls this step 7).
10. UI spec: `events-web.md`: organizer events list, create form and event page; the public event page (read only). (done: W-E1 to W-E21)
11. Test, then code: organizer events list, create form and event page (states: loading, error, empty list, field errors). (done: `web/src/events/`, dev proxy for `/events` and `/public`, RE1 no role eyebrow; the organizer event page is one page with the public one, `/event/:id`, built in step 12)
12. Test, then code: public event page (states: loading, not found, open, full, closed, already started). (done: `/event/:id` picks the organizer or the public view from `me`, falls back to the public view on 404, shows the description as plain text)
12a. Test, then code: event description in the API (`event-description.md`, DS1-DS13): optional plain-text `description` on create (trimmed, up to 2000 code points, no NUL, `''` when empty), answered in the organizer and public shapes. (done: tests-first commit, then migration `003_event_description.sql`, `api/src/events/routes.ts`, `api/openapi.yaml`; the web already sent and showed it)
12b. Specs for the attendee home: `events-public-list.md` (API, PL1-PL11) and `events-public-list-web.md` (UI, W-L1-W-L13) (done; mockup boards on the design canvas).
12c. Test, then code: `GET /public/events` (filter: not cancelled and not ended; order; exact key list; privacy are test first). (done: tests-first commit `api/test/events/publicList.test.ts`, then the route in `api/src/events/routes.ts` with one `now` per request as a query parameter, `api/openapi.yaml`)
12d. Test, then code: attendee home `/` with the events list (states: loading, error, empty; organizer redirect to `/organizer`) (W-L1-W-L13). (done: tests-first commit `web/src/events/PublicEventsList.test.tsx`, then `web/src/events/PublicEventsList.tsx`, `listPublicEvents` and `usePublicEvents` with the key `["public-events"]`; the register handler that invalidates this key comes with step 18)

### M3. Registration
13. API spec: `registration.md` (B1, B2, B4) (done: R1-R21).
14. **Red:** B4 concurrency test (capacity 1, 20 parallel attendees: 1 registered, 19 waitlisted; repeat). Add B1 (same account twice = same ticket, one seat) and B2 (full goes to the list). (done: `api/test/registrations/`, with the other R1-R22 tests in the same red commit)
15. **Green:** the register service in one transaction with `FOR UPDATE` on the event, a `ticket` outbox row, route `POST /events/:id/registrations`. (done: `api/src/registrations/`)
16. "My registration" route (ticket code, status, place on the list). (done: `GET /events/:id/registrations/me`)
17. UI spec: `registration-web.md`: the register button on the public event page, the ticket page. (done: spec W-R1-W-R23, mock-up boards `Reg*` in the design canvas)
18. Test, then code: registration form (states: loading, error, full so the list, already registered, not logged in) and the ticket page (code, status, place on the list). (done: tests-first commit, then `web/src/registrations/`: the registration area on the public view of `/event/:id`, the ticket page `/registrations/me?event={id}`, the route entries `/registrations` and `/registrations/me` with the role redirects, header links; W-R1-W-R23 with the recommended answers to questions 1-8; the register handler also invalidates `["public-events"]` (W-L13). Not built: the two lists are placeholders (W-R18-W-R21, `it.todo`; attendee list waits for an API route, question 1; organizer list waits for `GET /events/{id}/registrations`, step 26); the QR on the ticket page and the scan screen (W-R24-W-R37) wait for the user's OK on the `qrcode`, `@types/qrcode` and `jsqr` packages (question 9) and for `POST /checkin` (step 26))

### M4. Cancel and capacity
19. API spec: extend `registration.md` (B3, B10).
20. Test, then code: cancel a registration and promote the first waiting person with a `promotion` row (B3). Cancelling a waiting person promotes nobody. A checked-in ticket answers 409.
21. Test, then code: change capacity, promote up to the free seats, refuse below the registered count (B10).
22. UI spec: extend `registration-web.md`: cancel button on the ticket page, capacity form on the organizer event page.
23. Test, then code: cancel button (confirm, pending, error, checked-in 409) and the capacity form (field error below the registered count, new seats left).

### M5. Check-in
24. API spec: `checkin.md` (B6, B7) (done: C1-C19).
25. **Red:** B6 test (5 parallel check-ins of one code: one wins, four get 409). Also unknown code, waiting, cancelled event, another organizer's ticket.
26. **Green:** conditional UPDATE, route `POST /checkin`, organizer list `GET /events/:id/registrations` that the counter is counted from (B7; no separate arrivals route, D45).
27. UI spec: `checkin-web.md`: check-in by code and the arrivals counter (polling).
28. Test, then code: check-in screen (states: ok, already checked in, unknown code, waiting, cancelled event) and the counter that refreshes by polling.

### M6. Email and reminder
29. API spec: `email-reminders.md` (stub sender, B5).
30. Stub sender: prints unsent outbox rows and sets `sent_at`. Test: sends once, a repeat run sends nothing.
31. **Red:** B5 test (fake clock at one day before, worker run 10 times and with two workers: one `reminder` row per registered person, none for waiting people).
32. **Green:** reminder worker with `INSERT ... SELECT ... ON CONFLICT DO NOTHING`, a timer to start it, a clock that can be injected.
33. UI spec: `email-reminders-web.md`: what the screens say about emails (for example "a ticket email was sent" on the ticket page). Only what the API can tell; no new route unless the spec asks for it.
34. Test, then code: the email notes on the ticket page.

### M7. Reschedule and event cancel
35. API spec: extend `email-reminders.md` (B8, B9).
36. Test, then code: reschedule bumps `schedule_version`, writes a `reschedule` row for registered and waiting people, a same-time reschedule is a no-op (B8). Test A -> B -> A -> B gets a fresh reminder each time.
37. Test, then code: cancel the event, refuse after the start, cancelled event refuses register, check-in, reschedule and capacity change (B9).
38. UI spec: extend `email-reminders-web.md`: reschedule form and cancel-event button on the organizer event page; the cancelled and rescheduled states on the public page and the ticket page.
39. Test, then code: reschedule form, cancel-event button (confirm, error), cancelled state on the public page and the ticket page.

### M8. Live updates
40. API spec: extend `checkin.md` (live counter).
41. Server-sent events for the arrivals counter, with a test that a check-in reaches a connected client.
42. UI spec: extend `checkin-web.md`: live counter states (connecting, live, lost, polling fallback).
43. Test, then code: the counter listens to the event stream and falls back to polling. Each UI step adds the Vite dev proxy entries for the routes it uses (D34 covers `/auth` only).

### M9. Review and finish
44. Review the diff against the specs with the reviewer (correctness and requirements only). Fix what it finds.
45. Two-tab check by hand: check in on one tab, the counter moves on the other.
46. README: run instructions and the honest state (SSE in one process, polling worker, no real email). Every behaviour has a test or a README note.

### M10. Test data (seed)
47. API spec: `seed.md`: what the seed script creates (organizers, attendees, events in every state: open, full with a waiting list, started, ended, cancelled; registrations with tickets, some checked in), the command to run it, safe to run twice, development database only.
48. Test, then code: the seed script in `api/` (uses the existing services and migrator, no new libraries). Test: a run fills the tables, a second run adds nothing, it refuses to run when `DATABASE_URL` is not the development database.
49. README: how to run the seed and the demo logins.

## Rules for every step

- The API spec and the UI spec of a milestone exist before it is built, and are written at the start of the milestone.
- Tests first for B4, B5 and B6.
- Work on `main`, one Conventional Commit per finished step, tests-first commit before the code commit.
- Add the step to the session file right after it is done.
- Keep this file, `README.md` and the agent files up to date.
- No new libraries without asking.

## Open points

- The two-tab check (step 45) is by hand. Playwright was in the first plan but is not in the spec; ask before adding it.
- Email stays a stub (outbox row plus console).
- M6 has little to show in the UI (email is a stub). Step 33 may end up as a short spec.
- Specs that point to `web.md` or "M9" are updated to their `*-web.md` file (D35).
