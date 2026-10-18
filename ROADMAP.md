# Roadmap

Order of work for the event registration service. One row = one step = one commit (or a tests-first commit, then a code commit). Every milestone starts with its feature spec. A step is done only when tests, typecheck and linter pass. Behaviour ids (B1-B10) are from `docs/specs/SPEC_TEMPLATE.md` and `docs/specs/DATABASE.md`.

`build_plan.md` is the first plan and is out of date (Fastify, Docker, PostgreSQL 16, no accounts). This file follows the current decisions: Express, PostgreSQL 18 on Windows, attendee and organizer accounts, signed cookie.

## Done

- Repo, `api/` and `web/` set up, eslint, env example, database setup.
- Database schema, migrator and schema tests (`DATABASE.md`).

## Milestones

| # | Milestone | Spec | Behaviours | Tests first |
|---|---|---|---|---|
| M1 | Accounts and login | `auth.md` | | auth basics |
| M2 | Events (organizer) | `events.md` | | ownership |
| M3 | Register and waiting list | `registration.md` | B1, B2, B4 | B4 |
| M4 | Cancel, promote, capacity change | `registration.md` (extend) | B3, B10 | |
| M5 | Check-in and arrivals counter | `checkin.md` | B6, B7 | B6 |
| M6 | Outbox sender and reminder worker | `email-reminders.md` | B5 | B5 |
| M7 | Reschedule and event cancel | `email-reminders.md` (extend) | B8, B9 | |
| M8 | Live updates | `checkin.md` (extend) | B7 | |
| M9 | Web app | `web.md` | all | |
| M10 | Review and README | | all | |

## Steps

Specs are not written all at once. The first step of each milestone writes (or extends) its feature spec in `docs/specs/`, made from `SPEC_TEMPLATE.md` with the `spec-writer` agent. A spec lists only the behaviours, UI states and routes of its own feature. `DATABASE.md` already exists. The template stays untouched.

### M1. Accounts (`api/`)
1. Spec: `auth.md` (done).
2. Test, then code: password hashing (scrypt, random salt) and the signed cookie (7 days).
3. Test, then code: attendee sign-up, login, logout, "who am I". Same for organizers.
4. Auth middleware that puts `user` or `organizer` on the request. Tests: no cookie gives 401, an attendee cookie cannot use organizer routes.

### M2. Events
5. Spec: `events.md`.
6. Test, then code: organizer creates, lists and reads own events. Another organizer's event answers 404 (`DATABASE.md` 3.8).
7. Public event page route (no login): title, start, seats left, full or not.

### M3. Registration
8. Spec: `registration.md` (B1, B2, B4).
9. **Red:** B4 concurrency test (capacity 1, 20 parallel attendees: 1 registered, 19 waitlisted; repeat). Add B1 (same account twice = same ticket, one seat) and B2 (full goes to the list).
10. **Green:** the register service in one transaction with `FOR UPDATE` on the event, a `ticket` outbox row, route `POST /events/:id/registrations`.
11. "My registration" route (ticket code, status, place on the list).

### M4. Cancel and capacity
12. Spec: extend `registration.md` (B3, B10).
13. Test, then code: cancel a registration and promote the first waiting person with a `promotion` row (B3). Cancelling a waiting person promotes nobody. A checked-in ticket answers 409.
14. Test, then code: change capacity, promote up to the free seats, refuse below the registered count (B10).

### M5. Check-in
15. Spec: `checkin.md` (B6, B7).
16. **Red:** B6 test (5 parallel check-ins of one code: one wins, four get 409). Also unknown code, waiting, cancelled event, another organizer's ticket.
17. **Green:** conditional UPDATE, route `POST /checkin`, arrivals counter route (B7).

### M6. Email and reminder
18. Spec: `email-reminders.md` (stub sender, B5).
19. Stub sender: prints unsent outbox rows and sets `sent_at`. Test: sends once, a repeat run sends nothing.
20. **Red:** B5 test (fake clock at one day before, worker run 10 times and with two workers: one `reminder` row per registered person, none for waiting people).
21. **Green:** reminder worker with `INSERT ... SELECT ... ON CONFLICT DO NOTHING`, a timer to start it, a clock that can be injected.

### M7. Reschedule and event cancel
22. Spec: extend `email-reminders.md` (B8, B9).
23. Test, then code: reschedule bumps `schedule_version`, writes a `reschedule` row for registered and waiting people, a same-time reschedule is a no-op (B8). Test A -> B -> A -> B gets a fresh reminder each time.
24. Test, then code: cancel the event, refuse after the start, cancelled event refuses register, check-in, reschedule and capacity change (B9).

### M8. Live updates
25. Spec: extend `checkin.md` (live counter).
26. Server-sent events for the arrivals counter, with a test that a check-in reaches a connected client. Polling stays as the fallback in the web app.

### M9. Web (`web/`)
27. Spec: `web.md` (screens, states, which API route each one uses).
28. App shell, API client, TanStack Query, sign-up and login for both roles.
29. Public event page and registration form (states: loading, error, full, already registered).
30. Ticket page: code, status, place on the list, cancel button.
31. Organizer: events list, create, reschedule, capacity, cancel event.
32. Organizer: check-in by code and the live arrivals counter (states: already checked in, unknown code).
33. Component tests for the states above. Typecheck and lint clean.

### M10. Review and finish
34. Review the diff against the feature specs with the reviewer (correctness and requirements only). Fix what it finds.
35. Two-tab check by hand: check in on one tab, the counter moves on the other.
36. README: run instructions and the honest state (SSE in one process, polling worker, no real email). Every behaviour has a test or a README note.

## Rules for every step

- The feature spec exists before the feature is built, and is written at the start of its milestone.
- Tests first for B4, B5 and B6.
- Work on `main`, one Conventional Commit per finished step, tests-first commit before the code commit.
- Add the step to the session file right after it is done.
- Keep this file, `README.md` and the agent files up to date.
- No new libraries without asking.

## Open points

- The two-tab check (step 35) is by hand. Playwright was in the first plan but is not in the spec; ask before adding it.
- Email stays a stub (outbox row plus console).
