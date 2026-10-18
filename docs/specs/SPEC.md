# Spec: Event Registration

One document, kept short. The agent reads it before every step. Change it first when a decision changes, then the code. `[TODO]` marks what I still fill in.

## 1. Goals and expected behaviour

**Goal.** `[TODO: one or two sentences. Who uses this and what they get.]`

**Behaviours.** Each line is something that can be checked. The hard ones (marked "test first") get a test before the code.

| # | Behaviour | Test first? |
|---|---|---|
| B1 | A signed-in attendee registers and gets a ticket with a code and a ticket email. The same person twice gives one seat. | |
| B2 | When seats are full, new people go to the waiting list. | |
| B3 | Cancelling gives the seat to the first person on the list and sends them an email. | |
| B4 | Two people compete for the last seat: exactly one gets it. | yes |
| B5 | One reminder per person, one day before the event, even if the worker runs many times. | yes |
| B6 | A ticket can be checked in only once. | yes |
| B7 | The arrivals counter on the organizer screen updates live. | |
| B8 | Rescheduling emails everyone registered and on the waiting list. | |
| B9 | Cancelling an event cancels and emails everyone registered and on the waiting list (not those already checked in), and the event accepts no registrations, reminders or check-ins. Rejected with 409 once the event has started. | |
| B10 | An organizer can change an event's capacity. Lower than the registered count is rejected with 409 and a warning that says how many are registered. Higher promotes the first waiting people. | |

**Out of scope.** `[TODO: accounts, real email sending, payments, camera scanner ...]`

**Assumptions.** `[TODO: for example: one reminder per person per start time, also after a reschedule]`

## 2. UI decisions

| Screen | What it shows and does |
|---|---|
| Sign-up (attendee) | Email, name, password; creates the account and signs in. |
| Sign-up (organizer) | Email, name, password; creates the organizer account and signs in. |
| Event page (public) | `[TODO]` |
| Registration form | `[TODO]` |
| Ticket / registration status | `[TODO]` |
| Organizer: events and counters | `[TODO]` |
| Organizer: check-in | `[TODO]` |

`[TODO: states to handle on every screen: loading, error, empty, full, already checked in.]`

## 3. Architecture decisions

- **Apps:** `api/` (Express, TypeScript) and `web/` (React, Vite, TypeScript, TanStack Query). They talk over HTTP. `[TODO: confirm]`
- **Database:** PostgreSQL 18, installed on Windows (port 5433), no Docker. The connection string is in `DATABASE_URL`. Five tables: `organizers`, `users` (attendees), `events`, `registrations` (one row is one ticket), `outbox`. All ids are `uuid DEFAULT uuidv7()`; waiting-list order is `registrations.queue_no`. Details in [DATABASE.md](DATABASE.md).
- **Concurrency:** B4 uses `SELECT ... FOR UPDATE` on the event row, then count and insert. B5 uses `UNIQUE (registration_id, kind, schedule_version)` on `outbox` (`events.schedule_version` goes up by 1 on every reschedule) with `ON CONFLICT DO NOTHING`. B6 uses a conditional `UPDATE ... WHERE checked_in_at IS NULL RETURNING`. B1 uses a partial unique index on `(event_id, user_id)` (the user is the signed-in attendee). See [DATABASE.md](DATABASE.md) section 3.
- **Login and sessions:** attendees and organizers sign up and log in. Login sets a signed cookie (`cookie-parser`, secret in env var `COOKIE_SECRET`; httpOnly, sameSite lax, expiry in the payload, 7 days by default, the user can change it) holding `role` (`attendee` or `organizer`) and `id`. No sessions table; logout clears the cookie. Passwords are hashed with Node's built-in `crypto.scrypt` (random salt, stored in `password_hash`). `cookie-parser` is the only new library, approved by the user.
- **Email:** `[TODO: stub, outbox table and console]`
- **Organizer access:** organizers are rows in `organizers` and sign up themselves. Each event has an `organizer_id`, and an organizer can manage (cancel, reschedule, change capacity, check in, see counters) only their own events; other organizers' events answer 404. Attendees are rows in `users` with their own login; registering needs a signed-in attendee and the email comes from the account. Rules in [DATABASE.md](DATABASE.md) section 3.8.
- **Live updates:** `[TODO: server-sent events with polling as a fallback]`
- **API:** `[TODO: list of routes, one line each]`

## 4. Files to touch

What to create or change, and what to do in each. Updated as the build goes.

| File | What to do | Behaviours |
|---|---|---|
| `api/src/db/migrations/001_init.sql` | Create `organizers`, `users`, `events`, `registrations`, `outbox` (five tables, uuid ids, `queue_no`, password hashes) with the constraints and indexes in `DATABASE.md`. | B1-B10 |
| `api/src/...` | `[TODO]` | |
| `api/test/...` | `[TODO: tests for B4, B5, B6 first]` | B4, B5, B6 |
| `web/src/...` | `[TODO]` | |
| `README.md` | Run instructions and the honest state | |

## 5. Done means

- Tests, typecheck and linter all pass.
- Every behaviour above has a test, or a note in the README that says it is not covered.
- The README "Project status" says what really works.
