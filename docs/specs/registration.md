# Spec: Register and waiting list (M3, attendee, API only)

Feature spec for milestone M3, made from `SPEC_TEMPLATE.md` (sections 1-5). The tables `registrations` and `outbox` are in `DATABASE.md` (section 1, rules 3.1, 3.4 and 3.10); this file does not change them and needs no migration. Login, guards and the error format come from `auth.md` (A13-A15); events and the public seats count come from `events.md`. Behaviours B1, B2 and B4 of the template. Roadmap steps 13-16 (this spec is step 13). Cancel and promote (B3) and capacity change (B10) are M4.

## 1. Goals and expected behaviour

**Goal.** A logged-in attendee registers for an event. If a seat is free they get a ticket with a code and a `ticket` email row. If the event is full they go on the waiting list (they also get a ticket code, no email yet). They can ask for their own registration: ticket code, status and place on the waiting list. When many attendees register at the same moment, seats are never over-sold.

**Behaviours.** Each line is something that can be checked. The ids R1, R2, ... are for this feature. "Step 14" tests are written and committed before the code (red), as the roadmap says; the tests marked "yes" are the hard ones.

| # | Behaviour | Test first? |
|---|---|---|
| R1 | `POST /events/:id/registrations` with an attendee cookie, for an open event with a free seat, creates one `registrations` row with status `registered` for the cookie's user and answers 201 with the registration shape (section 3). `user_id` is the cookie id, never a body field; the body is ignored. | |
| R2 | A new `registered` row gets a `ticket_code` of 10 characters from the alphabet `A-Z` without `I` and `O`, and `2-9` (32 characters, `DATABASE.md` decision 3). Codes are unique; if a made code is already taken the app makes another one. | |
| R3 | The same request writes exactly one `outbox` row with `kind = 'ticket'`, `registration_id` of the new row, `schedule_version` and `event_starts_at` copied from the event, `to_email` copied from `users.email`, `sent_at` NULL, and a subject and body that name the event title and contain the ticket code. A waiting registration (R6) writes no outbox row. | |
| R4 | (B1) The same account registering again for the same event, while its registration is `registered` or `waitlisted`, creates nothing and answers 200 with the same registration shape: same `id`, same `ticket_code`, same status. There is still one active row for (event, user) and still one `ticket` outbox row. | yes (step 14) |
| R5 | (B1) Five parallel requests from one account for one event with free seats give one row, one `ticket` outbox row, one 201 and four 200, all with the same `ticket_code`. Also when the event is full: one `waitlisted` row, one place. | yes (step 14) |
| R6 | (B2) When the number of `registered` rows is already equal to `capacity`, the new registration is stored as `waitlisted` and answered 201 with status `waitlisted`, a `ticket_code` and `waitlist_position` (R7). No seat is taken and no outbox row is written. | yes (step 14) |
| R7 | `waitlist_position` is the 1-based place on the waiting list: the number of `waitlisted` rows of that event with `queue_no` less than or equal to this row's. It is `null` when the status is `registered`. The first waiting person gets 1, the next 2, and so on, in the order the event lock was granted (`queue_no`, `DATABASE.md` 1). | |
| R8 | (B4) Capacity 1, 20 different attendees registering in parallel for one event: exactly one `registered` row and 19 `waitlisted` rows in the database; exactly one answer is 201 `registered` and 19 are 201 `waitlisted`; the 19 `waitlist_position` values are 1 to 19 with no repeat and no gap; exactly one `ticket` outbox row. The test repeats the run on several fresh events (for example 5 rounds) and also runs capacity 3 with 20 attendees (3 registered, 17 waitlisted). | yes |
| R9 | (B4) At no moment can `registered` rows of one event be more than `capacity`. An event with capacity 0 (made by SQL; the API cannot create it) puts everyone on the waiting list. | yes (with R8) |
| R10 | Cancelled and passed events refuse registering: an event with stored status `cancelled` answers 409 `{ "error": "event_cancelled" }`; an event whose derived status is `passed` (`now >= starts_at + duration`, `events.md` E19) answers 409 `{ "error": "event_passed" }`. Nothing is written. Cancelled wins over passed. The check reads the stored columns under the same event lock as the seat count. | |
| R11 | An event that has started but not ended (`has_started` true, derived status `active`) still accepts registrations. | |
| R12 | A registration with status `cancelled` (made by SQL in the test; the cancel route is M4) does not block: registering again creates a new row with a new `ticket_code` and the normal seat or waiting rule. The old row is unchanged. | |
| R13 | The same account on two different events gets two registrations, one per event. | |
| R14 | An event id that is unknown, or not a uuid, answers 404 `{ "error": "not_found" }`. A malformed id never reaches the database (same as E8). An organizer-owned event is registrable by any attendee: ownership plays no part. | |
| R15 | Guards on `POST /events/:id/registrations`: no valid login answers 401 `not_logged_in`; an organizer cookie answers 403 `wrong_role`; no handler runs and nothing is written (`requireUser`, A14, A15). The guard runs first, so a malformed id from an anonymous caller is 401. | yes |
| R16 | Everything in one request is one transaction: the registration row and its outbox row are both stored or neither is. | |
| R17 | `GET /events/:id/registrations/me` with an attendee cookie answers 200 with the caller's registration for that event in whatever status it has (`registered`, `waitlisted` or `cancelled`), in the registration shape: `ticket_code`, `status`, `waitlist_position`. `waitlist_position` is `null` unless the status is `waitlisted`. If the caller has an active row (`registered` or `waitlisted`) that row is answered; otherwise the newest `cancelled` row (highest `created_at`, then `queue_no`) is answered. | |
| R18 | The place on the waiting list is current: when waiting rows before it are set to `cancelled` (by SQL in the test), the next read of the same registration shows a smaller `waitlist_position`. It is a snapshot, read without a lock. | |
| R19 | `GET /events/:id/registrations/me` answers 404 `{ "error": "not_found" }` only when the event is unknown or not a uuid, or when the caller never registered for it (no row of any status for this caller and event). Another attendee's registration is never shown: attendee A reading event X while only attendee B is registered gets 404, the same as for an unknown event. | yes |
| R20 | Guards on `GET /events/:id/registrations/me`: 401 `not_logged_in` with no valid login, 403 `wrong_role` with an organizer cookie. | |
| R22 | The read in R17 does not look at the event status: for a cancelled event or a passed event the caller still gets their registration (any status) with 200, not 404 and not 409. A `cancelled` row (made by SQL in the test) is answered with `status` `cancelled`, its old `ticket_code` and `waitlist_position` `null`. After a cancelled row and a new registration (R12), the read answers the new active row, not the old one. | yes |
| R21 | The registration shape has exactly these keys: `id`, `event_id`, `status`, `ticket_code`, `waitlist_position`, `checked_in_at`, `created_at`. It never contains `user_id`, `queue_no`, `cancelled_at`, email, name, `password_hash` or any other person's data. The test checks the exact key list. Errors use `{ "error": "<code>" }` (codes here: `not_logged_in`, `wrong_role`, `not_found`, `event_cancelled`, `event_passed`). | |

**Not in this spec.** Cancelling a registration and promoting the first waiting person (B3), changing capacity (B10), check-in and the arrivals counter (B6, B7), reminders (B5), reschedule and event cancel (B8, B9), the `promotion` email, sending the outbox rows (they are only stored), an organizer view of who registered, a list of the attendee's registrations, registering for someone else, registering without login, the web screens (`registration-web.md`), live updates.

**Assumptions.** Change any of these first in this file.
- The attendee is the signed-in account; the email comes from `users.email` (`DATABASE.md` intro). The request has no body fields that matter.
- A repeat request is idempotent: 200 with the existing registration instead of an error. 201 means "a row was created by this request". The check for a closed event (R10) comes first, so a repeat on a cancelled or passed event answers 409, not the old ticket.
- A waiting person gets a `ticket_code` at once and no `ticket` email (`DATABASE.md` decision 2); the `promotion` email comes with M4.
- Closed means cancelled or passed, as in `DATABASE.md` 3.10 ("suggested: 409, as for cancelled"). A running event is still open (R11): late registrations are real, and the check-in rules of M5 decide who may arrive.
- The ticket code alphabet has 32 characters and the code is made with `crypto.randomInt`, so there is no modulo bias; a collision is vanishingly rare and handled by trying again.
- The ticket page needs event title and time; it reads them from `GET /public/events/:id` (`events.md` E11), so the registration shape has no event details.
- `waitlist_position` is counted at read time, not stored (no new column).
- A 404 for "never registered" and for "unknown event" is the same answer on purpose. The web screen tells the two apart by first loading the public event page.
- "My registration" shows history, not only the active ticket: a cancelled registration is answered with status `cancelled`. Effect for M4: the cancel route only sets `status = 'cancelled'` and `cancelled_at`; it does not delete the row, so this read keeps working. M4 must keep the row and its `ticket_code`; the same applies to the event-cancel step (M7), where registrations of a cancelled event may become `cancelled` and are still readable.
- Rows made by tests (cancelled registrations, past events) are inserted by SQL with the helpers in `api/test/db/helpers.ts`.

## 2. UI decisions

No screens in M3 API (API only). The register button and the ticket page are in `registration-web.md` (step 17). What the API gives them: 201 (new ticket, show code and status), 200 (already registered, show the same ticket), `waitlisted` with `waitlist_position` (show "you are number N on the waiting list"), 409 `event_cancelled` / `event_passed` (event closed), 401 (go to attendee login), 403 (organizers cannot register), 404 (not found, or on the ticket route: never registered). On the ticket route a `cancelled` status is shown as a cancelled ticket (the web decides the wording in `registration-web.md`), also when the event is cancelled or passed.

## 3. Architecture decisions

- **Apps:** `api/` only. Express 5, TypeScript, Vitest. No new table, no migration, no library, no env variable.
- **Router:** a new `registrationsRouter(pool)` mounted after `eventsRouter(pool)`. The paths `/events/:id/registrations` and `/events/:id/registrations/me` do not collide with the organizer `GET /events/:id` (different path depth). Guard `requireUser` is per route.
- **Register service (B4, B1, B2): one function in one transaction** on a client from the pool (`BEGIN` ... `COMMIT`, `ROLLBACK` on any error, client released in `finally`):
  1. `SELECT id, status, starts_at, duration_minutes, capacity, schedule_version, title FROM events WHERE id = $1 FOR UPDATE`. No row: rollback, 404. Concurrent callers for the same event queue on this row (`DATABASE.md` 3.1); other events are not blocked. The `users` row is not locked.
  2. Closed check with one `now` from the app: stored `cancelled` gives 409 `event_cancelled`; else `now >= starts_at + duration` gives 409 `event_passed` (same rule as the derived status of `events.md`).
  3. Existing active row: `SELECT ... FROM registrations WHERE event_id = $1 AND user_id = $2 AND status <> 'cancelled'`. If found: commit, answer 200 with it (B1). No insert, no outbox row. The partial unique index `registrations_one_active_per_user` is the safety net behind this check.
  4. `SELECT count(*) FROM registrations WHERE event_id = $1 AND status = 'registered'`. If below `capacity` the status is `registered`, otherwise `waitlisted`.
  5. Insert the row with a new `ticket_code` using `INSERT ... ON CONFLICT (ticket_code) DO NOTHING RETURNING ...`; on no row, make another code and try again (a few attempts, then fail with 500). `ON CONFLICT` with a target does not abort the transaction. `queue_no` is assigned by the identity column inside the lock, so it follows lock order.
  6. If `registered`: insert the `ticket` outbox row (`ON CONFLICT (registration_id, kind, schedule_version) DO NOTHING` as a second guard).
  7. `COMMIT`, then answer 201.
  The count and the insert are never done outside the lock. The capacity is read from the locked row, not from an earlier query.
- **Ticket code:** `makeTicketCode()` in a small module, `crypto.randomInt(32)` ten times over the alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`.
- **Outbox text:** subject `Your ticket for <title>`; body has the title, the start time (ISO, UTC) and the ticket code. The exact words are not fixed by this spec; only that the title and the code are in them.
- **My registration read:** no lock, no event status check, one query: the caller's rows for the event (any status), `ORDER BY (r.status <> 'cancelled') DESC, r.created_at DESC, r.queue_no DESC LIMIT 1`, so an active row wins and otherwise the newest cancelled row is used (`DATABASE.md` index `registrations_one_active_per_user` allows many cancelled rows plus at most one active row per event and user, so the order is needed). The `ticket_code` of a cancelled row is kept as stored. Includes `waitlist_position` from `CASE WHEN r.status = 'waitlisted' THEN (SELECT count(*) FROM registrations w WHERE w.event_id = r.event_id AND w.status = 'waitlisted' AND w.queue_no <= r.queue_no) END` (cast to number; `count` is a bigint string in `pg`). The index `registrations_waitlist` serves the count. A malformed uuid is answered 404 before any query.
- **Derived status reuse:** the passed rule must be the same function that `events.md` uses. `derive` in `api/src/events/routes.ts` is private today; move it (or just the passed check) to a shared module such as `api/src/events/status.ts` and import it from both routers, with the events tests still green. No behaviour change in `events.md`.
- **Shape** (all JSON): registration `{ id, event_id, status, ticket_code, waitlist_position, checked_in_at, created_at }`. `status` is `registered`, `waitlisted` or `cancelled`; `cancelled` is answered only by the read route (never by `POST`, which answers an existing active row or a new row); `checked_in_at` is `null` or an ISO string; `created_at` is an ISO string in UTC.
- **API:**

| Route | Guard | Body | Success | Errors |
|---|---|---|---|---|
| `POST /events/:id/registrations` | `requireUser` | none (ignored) | 201 registration (new row), 200 registration (already registered) | 401 `not_logged_in`, 403 `wrong_role`, 404 `not_found`, 409 `event_cancelled`, 409 `event_passed` |
| `GET /events/:id/registrations/me` | `requireUser` | none | 200 registration (any status, any event status) | 401, 403, 404 `not_found` (unknown or malformed event, or the caller never registered) |

  Two routes. "My registration" is the caller's own row only: the user id always comes from the cookie.

## 4. Files to touch

| File | What to do | Behaviours |
|---|---|---|
| `api/test/registrations/register.test.ts` | Tests first (step 14, red): R8, R9 (20 parallel attendees, capacity 1 and 3, repeated on fresh events), R4, R5 (same account, sequential and parallel), R6, R7 (waitlist by SQL-made seats or by registering). Needs many users: create them with the helpers and delete them in the test | R4-R9 |
| `api/test/registrations/rules.test.ts` | Step 15: R1-R3, R10-R16, R21 (outbox row content, closed events, cancelled row by SQL, two events, 404, guards, exact key list) | R1-R3, R10-R16, R21 |
| `api/test/registrations/me.test.ts` | Step 16: R17-R20, R22 (shape, position moves, cancelled row by SQL answered with 200, cancelled and passed events, new row wins after re-register, 404 only for never registered or other attendee's, guards). R19, R22 and R15 are written before their code | R17-R20, R22 |
| `api/src/registrations/ticket.ts` | `makeTicketCode()` | R2 |
| `api/src/registrations/service.ts` | `registerForEvent(pool, eventId, userId, now)`: the transaction above; returns `{ created, registration }` or a closed/not-found result | R1-R14, R16 |
| `api/src/registrations/routes.ts` | `registrationsRouter(pool)`: the two routes, uuid check, `requireUser`, row to shape mapping, `waitlist_position` query | R14-R21 |
| `api/src/events/status.ts` (new) and `api/src/events/routes.ts` | Move the derived-status rule so both routers share it. No change in answers | R10 |
| `api/src/app.ts` | Mount `registrationsRouter(pool)` after `eventsRouter(pool)`, before the 404 handler | all |
| `api/openapi.yaml` | Add the two routes and the registration shape | all |
| `README.md` | Add the two routes under the events routes; update "Project status" | |
| `ROADMAP.md` | Step 13 done now; steps 14, 15, 16 when finished | |

Tests use the existing style (`createApp().listen(0)` and `fetch`, the helpers in `api/test/auth/helpers.ts` and `api/test/db/helpers.ts`; no new test library). The parallel test uses `Promise.all` over 20 `fetch` calls, each with its own attendee cookie. The pool must allow at least that many waiting connections (they queue on the lock; nothing may time out). Rows made by a test are deleted by that test (outbox, registrations and events first, then accounts).

## 5. Done means

- Tests, typecheck and linter all pass in `api/`.
- Every behaviour R1-R22 has a test, or a note in the README that says it is not covered.
- R8 and R9 (B4) have their test written and committed before the register service; R4, R5 and R6 (B1, B2) go in the same red commit (roadmap step 14). R15, R19 and R22 are written before their code.
- The red run is shown failing for the right reason (no route, or over-sold seats), then green after step 15.
- `api/openapi.yaml` and the README list the two routes; "Project status" says that cancel, promotion and the email sender are not built yet (rows are stored, nothing is sent).

## 6. Open questions (all answered)

All answered. None open.

1. Running event: accepts registrations until it ends (R11). Answered: accept.
2. Repeat request on a closed event: 409 (R10). Answered: accept.
3. Repeat request: 200 for an existing registration, 201 for a new one (R4). Answered: accept.
4. "My registration" returns the registration in whatever status it has, including `cancelled`, also for cancelled and passed events; 404 only when the attendee never registered (R17, R19, R22). Answered: changed from the first draft (which gave 404 for cancelled). Effect for M4: cancel keeps the row and its ticket code.
5. Route `GET /events/:id/registrations/me` (nested). Answered: accept.
