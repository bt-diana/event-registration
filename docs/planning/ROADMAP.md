# Roadmap

Order of work for the event registration service. One row = one step = one commit (or a tests-first commit, then a code commit). A step is done only when tests, typecheck and linter pass. Behaviour ids (B1-B10) are from `docs/specs/SPEC_TEMPLATE.md` and `docs/specs/DATABASE.md`.

`build_plan.md` is the first plan and is out of date (Fastify, Docker, PostgreSQL 16, no accounts). This file follows the current decisions: Express, PostgreSQL 18 on Windows, attendee and organizer accounts, signed cookie.

## Done

- Repo, `api/` and `web/` set up, eslint, env example, database setup.
- Database schema, migrator and schema tests (`DATABASE.md`).

## Milestones

| # | Milestone | Behaviours | Tests first |
|---|---|---|---|
| M1 | Write the real spec | all | |
| M2 | Accounts and login | | auth basics |
| M3 | Events (organizer) | | ownership |
| M4 | Register and waiting list | B1, B2, B4 | B4 |
| M5 | Cancel, promote, capacity change | B3, B10 | |
| M6 | Check-in and arrivals counter | B6, B7 | B6 |
| M7 | Outbox sender and reminder worker | B5 | B5 |
| M8 | Reschedule and event cancel | B8, B9 | |
| M9 | Live updates | B7 | |
| M10 | Web app | all | |
| M11 | Review and README | all | |

## Steps

### M1. Spec
1. Copy `SPEC_TEMPLATE.md` to `SPEC.md` and fill the `[TODO]`s: goal, B9 and B10 as listed in `DATABASE.md`, out of scope, assumptions (one reminder per person per schedule version), UI states, API route list. Use the `spec-writer` agent. The template stays untouched.

### M2. Accounts (`api/`)
2. Test, then code: password hashing (scrypt, random salt) and the signed cookie (7 days).
3. Test, then code: attendee sign-up, login, logout, "who am I". Same for organizers.
4. Auth middleware that puts `user` or `organizer` on the request. Tests: no cookie gives 401, an attendee cookie cannot use organizer routes.

### M3. Events
5. Test, then code: organizer creates, lists and reads own events. Another organizer's event answers 404 (`DATABASE.md` 3.8).
6. Public event page route (no login): title, start, seats left, full or not.

### M4. Registration
7. **Red:** B4 concurrency test (capacity 1, 20 parallel attendees: 1 registered, 19 waitlisted; repeat). Add B1 (same account twice = same ticket, one seat) and B2 (full goes to the list).
8. **Green:** the register service in one transaction with `FOR UPDATE` on the event, a `ticket` outbox row, route `POST /events/:id/registrations`.
9. "My registration" route (ticket code, status, place on the list).

### M5. Cancel and capacity
10. Test, then code: cancel a registration and promote the first waiting person with a `promotion` row (B3). Cancelling a waiting person promotes nobody. A checked-in ticket answers 409.
11. Test, then code: change capacity, promote up to the free seats, refuse below the registered count (B10).

### M6. Check-in
12. **Red:** B6 test (5 parallel check-ins of one code: one wins, four get 409). Also unknown code, waiting, cancelled event, another organizer's ticket.
13. **Green:** conditional UPDATE, route `POST /checkin`, arrivals counter route (B7).

### M7. Email and reminder
14. Stub sender: prints unsent outbox rows and sets `sent_at`. Test: sends once, a repeat run sends nothing.
15. **Red:** B5 test (fake clock at one day before, worker run 10 times and with two workers: one `reminder` row per registered person, none for waiting people).
16. **Green:** reminder worker with `INSERT ... SELECT ... ON CONFLICT DO NOTHING`, a timer to start it, a clock that can be injected.

### M8. Reschedule and event cancel
17. Test, then code: reschedule bumps `schedule_version`, writes a `reschedule` row for registered and waiting people, a same-time reschedule is a no-op (B8). Test A -> B -> A -> B gets a fresh reminder each time.
18. Test, then code: cancel the event, refuse after the start, cancelled event refuses register, check-in, reschedule and capacity change (B9).

### M9. Live updates
19. Server-sent events for the arrivals counter, with a test that a check-in reaches a connected client. Polling stays as the fallback in the web app.

### M10. Web (`web/`)
20. App shell, API client, TanStack Query, sign-up and login for both roles.
21. Public event page and registration form (states: loading, error, full, already registered).
22. Ticket page: code, status, place on the list, cancel button.
23. Organizer: events list, create, reschedule, capacity, cancel event.
24. Organizer: check-in by code and the live arrivals counter (states: already checked in, unknown code).
25. Component tests for the states above. Typecheck and lint clean.

### M11. Review and finish
26. Review the diff against `SPEC.md` with the reviewer (correctness and requirements only). Fix what it finds.
27. Two-tab check by hand: check in on one tab, the counter moves on the other.
28. README: run instructions and the honest state (SSE in one process, polling worker, no real email). Every behaviour has a test or a README note.

## Rules for every step

- Tests first for B4, B5 and B6.
- Work on `main`, one Conventional Commit per finished step, tests-first commit before the code commit.
- Add the step to the session file right after it is done.
- No new libraries without asking.

## Open points

- The two-tab check (step 27) is by hand. Playwright was in the first plan but is not in the spec; ask before adding it.
- Email stays a stub (outbox row plus console).
