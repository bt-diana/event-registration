# Spec: Cancel my registration and promote the next person (M4, attendee, API only)

Feature spec for the attendee side of milestone M4, made from `SPEC_TEMPLATE.md` (sections 1-5; its behaviours are not requirements). Roadmap steps 19 and 20 (this spec is step 19); behaviour B3. It is a **new file**, not an extension of `registration.md` (user request); `registration.md`, `DATABASE.md` 3.5 and `email-reminders.md` ER83 are the base and are not changed here. **The organizer's capacity change (B10, roadmap steps 21 and 23) is a separate spec and is not covered here.** No migration: `registrations.cancelled_at`, the `promotion` outbox kind and the waitlist index already exist (`DATABASE.md` section 1). The web side is `cancel-registration-web.md` (W-CR ids). Ids here are CR1, CR2, ...

Style model: `registration.md` (same transaction and lock, same registration shape, same error body `{ "error": "<code>" }`) and `email-reminders.md` M7 (ER61-ER87: same 409 code names and the same order of state checks).

## 1. Goals and expected behaviour

**Goal.** A logged-in attendee cancels their own registration for an event (a seat or a place on the waiting list). If they held a seat, the seat goes to the first waiting person, who gets one `promotion` email row. The seat count never goes above `capacity`, also when cancels and registrations come at the same moment.

**Route: `POST /events/:id/registrations/me/cancel`** (guard `requireUser`, no body, any body is ignored). Why a POST under `.../registrations/me`: it acts on the caller's own registration, which `GET /events/:id/registrations/me` already names (R17); the other state-changing routes of the API are action POSTs (`POST /events/:id/cancel`, `POST /events/:id/reschedule`, `POST /checkin`), and the row is **kept** (status `cancelled`, `registration.md` line 47), so a `DELETE` would be a lie. The path has no registration id, so a person can only ever address their own row: the user id is the cookie's, never a path, query or body value. `/events/:id/registrations/me/cancel` collides with no route (`/events/:id/registrations/:registrationId/emails` is a GET with a different last segment).

**Answer on 200:** the registration shape of `registration.md` R21 (`id`, `event_id`, `status`, `ticket_code`, `waitlist_position`, `checked_in_at`, `created_at`) of the cancelled row: `status` `cancelled`, the old `ticket_code`, `waitlist_position` `null`, `checked_in_at` `null`. It says nothing about who was promoted.

**Order of checks** (decided here; row state first, as ER76 does for the event cancel): guard (401/403) -> `:id` is a uuid (else 404, no query) -> `BEGIN` -> lock the event row (404 if none) -> find the caller's row (404 if none) -> row state: already `cancelled` is a 200 no-op, checked in is 409 `already_checked_in` -> event state (409) -> writes -> `COMMIT`. `now` is read once per request in the app (`new Date()`); the state comes from `deriveStatus` and `endsAt` in `api/src/events/status.ts` (as ER64).

**Behaviours.** Each line is something a test can prove (Vitest; `createApp().listen(0)` and `fetch`; rows by SQL with the helpers in `api/test/db/helpers.ts` and `api/test/auth/helpers.ts`). "Yes" means the test is written and committed before the code (red). ROADMAP lists no tests-first for B3; the exception is on purpose: the single promotion and the races are the only hard parts of B3 and decide the shape of the transaction, so they go in the red commit. All other CR tests may be in the same red commit.

Route, guards, 404:

| # | Behaviour | Test first? |
|---|---|---|
| CR1 | `POST /events/:id/registrations/me/cancel` with an attendee cookie cancels the caller's active registration of that event and answers 200 with the shape of CR27. The body is ignored. The user is the cookie's; nothing from the path, query or body names a user or a registration. | |
| CR2 | Guards: no valid login answers 401 `not_logged_in`; an organizer cookie answers 403 `wrong_role` (`requireUser`, A14, A15). The guard runs first, so a malformed id from an anonymous caller is 401. No handler runs and nothing is written. | |
| CR3 | **404, one body** `{ "error": "not_found" }`, byte for byte the same for: an id that is not a uuid (no query), an unknown event, an event where the caller never registered (no row of any status), and an event where only another attendee is registered. In the last case the other attendee's row, the outbox and the waiting list are equal before and after. Another person's registration can never be cancelled through this route. | yes |

Cancel a seat (`registered`) and promote:

| # | Behaviour | Test first? |
|---|---|---|
| CR4 | (B3) A `registered` row (not checked in) becomes `cancelled` with `cancelled_at = now()` (database clock). The row is kept: `id`, `queue_no`, `ticket_code`, `user_id`, `created_at` are unchanged, so `GET /events/:id/registrations/me` still answers it (R17, R22). | |
| CR5 | (B3) In the same transaction the **first waiting person**, the `waitlisted` row of the event with the lowest `queue_no`, becomes `registered`. Its `ticket_code`, `queue_no`, `created_at` and `id` do not change, `checked_in_at` stays NULL. Every other waiting row stays `waitlisted`. The test uses 3 waiting people, cancels the seat, and checks who is registered. | yes |
| CR6 | Promotion order is `queue_no`, not `created_at`, not name, not `id`; `cancelled` rows are skipped. A waiting person who cancelled earlier is never promoted. Test: waiting rows A, B, C where A is cancelled first (by this route); the seat goes to B. | yes |
| CR7 | The promotion writes exactly one `outbox` row: `kind = 'promotion'`, `registration_id` of the promoted row, `schedule_version` and `event_starts_at` copied from the **locked** event row, `to_email` from the promoted person's `users.email`, `status` `pending`, `sent_at` NULL. Subject `You have a seat at <title>`; body one item per line: the title, `Starts: <starts_at in UTC> (UTC)`, `Ticket code: <ticket_code>` (the code the person already has; same style as the ticket email). The exact words are not fixed; only that title, time and code are in them. `ON CONFLICT (registration_id, kind, schedule_version) DO NOTHING` is the second guard. The cancelling person gets no email. | yes |
| CR8 | Nobody waiting: the seat is just freed. No promotion, no outbox row. Public `seats_left` goes up by 1 (E10, E12) and `full` turns false. Test with a full event, then a non-full event. | |
| CR9 | **Capacity is respected.** A waiting person is promoted only if, after the cancel, the `registered` count under the lock is below `capacity`. Test with a state made by SQL that a lowered capacity can leave (capacity 1, two `registered` rows, one waiting): cancelling one registered person promotes nobody and writes no outbox row (`arrivals.md` AR6). At most one person is promoted per cancel. | |

Cancel a place on the waiting list:

| # | Behaviour | Test first? |
|---|---|---|
| CR10 | A `waitlisted` row becomes `cancelled` with `cancelled_at`. No seat is freed, nobody is promoted, no outbox row is written, the `registered` count and `seats_left` do not change. | |
| CR11 | The order of the others is kept and the places renumber by themselves: `waitlist_position` is counted at read time (R7, R18). With waiting A, B, C and B cancelled, the next reads show A = 1 and C = 2, no gap, no repeat. | |

Refusals and the no-op:

| # | Behaviour | Test first? |
|---|---|---|
| CR12 | **Idempotent.** The caller's newest row is already `cancelled` and they have no active row: 200 with that row (same `id`, `ticket_code`, `status`), `cancelled_at` unchanged, nothing written (registrations, outbox and events equal before and after), nobody promoted. Decided before any event-state check, so it is also 200 for a cancelled, started or passed event. If the caller registered again meanwhile (CR26), the active row is the one cancelled. | yes |
| CR13 | **Checked in.** A `registered` row with `checked_in_at` set answers 409 `{ "error": "already_checked_in" }` (no other key). Nothing changes, nobody is promoted (`DATABASE.md` 3.5, decision 4). This check comes before the event-state check (CR14), so it also holds for a started, passed or cancelled event (`DATABASE.md` 3.7: checked-in people stay registered). | yes |
| CR14 | **Event state**, under the event lock, in the order of ER64 (the same codes and the same edges): stored `cancelled` -> 409 `event_cancelled`; else `now >= starts_at + duration` -> 409 `event_passed`; else `starts_at <= now` -> 409 `event_started`. Nothing is written. It applies to a `registered` and to a `waitlisted` row alike (a person cannot leave the list of a running event either; question 3). Edges: `now = starts_at` is `event_started`; `now = ends_at` is `event_passed`; one ms before `starts_at` is allowed. A new test event is made by SQL with `starts_at` relative to `now`; the route reads the clock once. | yes |
| CR15 | **Cancelled event (ER83).** After the organizer cancels the event (M7, ER74) every non-checked-in registration is already `cancelled`, so a cancel through this route is the 200 no-op of CR12: the row stays `cancelled`, nobody is promoted, no outbox row. The test makes that state by SQL (event `cancelled`, the registration `cancelled`) and, when `POST /events/:id/cancel` exists, through it. A checked-in person of the cancelled event stays `registered` and gets 409 `already_checked_in` (CR13). A registration that is still `registered` or `waitlisted` and not checked in on a stored `cancelled` event (only possible by SQL) answers 409 `event_cancelled`. | |

Transaction, lock, reminders:

| # | Behaviour | Test first? |
|---|---|---|
| CR16 | **One transaction.** `BEGIN`; `SELECT ... FROM events WHERE id = $1 FOR UPDATE` (the lock of `registration.md` section 3 and `DATABASE.md` 3.1, same columns: `id, status, starts_at, duration_minutes, capacity, schedule_version, title`); then the caller's row `... FOR UPDATE` (so a check-in on this ticket waits, CR20); the cancel, the promotion and its outbox row, the reminder delete (CR17) and `COMMIT`. On a refusal: `ROLLBACK`, nothing written. On any error: `ROLLBACK`, release the client (drop it if the rollback fails), 500 `internal` from the app's error handler, nothing written. Order is always event row, then the caller's row, then the promoted row: no deadlock with register, check-in (which only locks the registration row it updates) or the M7 event routes. | |
| CR17 | **A cancelled person gets no reminder.** In the same transaction the outbox rows of the cancelled registration with `kind = 'reminder'` and `status = 'pending'` are deleted. `sent` and `error_sending` rows, rows of other kinds (`ticket`, `promotion`, ...) and rows of other registrations stay (as ER71, ER79). The worker already skips non-`registered` rows (`reminders.ts`, ER22), so none is written later. This is the "removing an already queued reminder when the person cancels" that `email-reminders.md` left to M4 (question 4). | yes |
| CR18 | **The promoted person gets a reminder only through the normal worker.** The cancel writes no `reminder` row. After it, `enqueueReminders` (ER18) with `now` inside the window writes one `reminder` for the promoted person (they are `registered` now) and none for the cancelled one; a second call writes none (ER20). Outside the window it writes none. | |
| CR19 | **Writes are limited.** The route changes only: the cancelled `registrations` row, the promoted `registrations` row (`status`), one inserted `promotion` `outbox` row, and the deleted pending `reminder` rows of CR17. It never changes `events`, `users`, another registration's `ticket_code` or `queue_no`, and never calls the email transport or logs an address, subject or body. | |

Concurrency (B3 with B4):

| # | Behaviour | Test first? |
|---|---|---|
| CR20 | **Cancel against check-in** of the same ticket at the same moment (one registered ticket, one waiting person): the answers agree. Either check-in is 200 and cancel is 409 `already_checked_in` (the person stays `registered`, nobody is promoted, no promotion row), or cancel is 200 and check-in is 409 `registration_cancelled` (`checked_in_at` NULL, the waiting person is promoted). Never both 200, never a 500. Repeat several rounds. | yes |
| CR21 | **Single promotion.** Capacity 1, one `registered` person A, waiting W1 and W2. Five parallel cancels of A's ticket (one cookie): all five answer 200 with the same row (CR12 for the four repeats); W1 is `registered`, W2 is still `waitlisted` (place 1); exactly one `promotion` row exists, for W1; `registered` count is 1. Repeat on several fresh events. | yes |
| CR22 | **Two seats, two cancels.** Capacity 2, A and B registered, W1, W2 and W3 waiting; A and B cancel in parallel: both 200; W1 and W2 are `registered`, W3 is `waitlisted` (place 1); two `promotion` rows, one each; `registered` is 2. | yes |
| CR23 | **Cancel against register on the last seat (B4 keeps holding).** (a) Capacity 1, A registered, W waiting, C new. A cancels while C registers: W is `registered`, C is `waitlisted` (place 1), whatever the order; never two `registered`. (b) Same without W: A ends `cancelled` and C ends `registered`, whatever the order. If C registered first it was `waitlisted` and got a `promotion` row; otherwise it got a `ticket` row; exactly one of the two rows exists for C. (c) 20 parallel registrations by other attendees against one cancel, capacity 3 with 3 registered: at no point (and at the end) are more than 3 `registered`; exactly one of the 20 gets the freed seat, the other 19 are `waitlisted` with places 1 to 19 and no gap. Repeat each on several fresh events. | yes |
| CR24 | **Cancel against the event being cancelled or moved (M7).** Deterministic: the test holds the event lock in a transaction, starts the cancel (its promise stays pending), then cancels the event (status `cancelled`, the registrations `cancelled`) and commits: the cancel answers 200 as the no-op of CR12/CR15 and promotes nobody. With a reschedule instead (`starts_at` moved into the past by SQL, which cannot happen through the route): 409 `event_started`. The promotion row of CR7 always carries the `schedule_version` read after the lock. | |

Reads afterwards, and registering again (regression tests, no code change expected):

| # | Behaviour | Test first? |
|---|---|---|
| CR25 | After a cancel: `GET /events/:id/registrations/me` answers 200 with `status` `cancelled`, the old `ticket_code`, `waitlist_position` `null` (R17, R22); `GET /me/registrations` keeps the row with `status` `cancelled` (`my-registrations.md` MR5, MR13) and the promoted person's row with `status` `registered`; `GET /events/:id/registrations` (the organizer list, `checkin.md` C15) lists the promoted person and no longer the cancelled one; `GET /events/:id/arrivals` counts `registered` as `registered` rows (AR3); `GET /events/:id` shows `registered` and `seats_left` (E10); `GET /public/events/:id` shows `seats_left` and `full` (E12); `GET /public/events` is unchanged in shape. A waiting person's place read before and after shows the renumbering of CR11. | |
| CR26 | **Registering again** after a cancel makes a **new row** with a new `ticket_code` and the normal rule (free seat -> `registered`, else `waitlisted`), exactly as R12 says; the partial unique index `registrations_one_active_per_user` allows it because the cancelled row is not active. The new row has a new `queue_no`, so a person who cancels and registers again to a full event stands at the **end** of the waiting list. The old row is unchanged. `GET .../me` then answers the new active row. A second cancel cancels the new row (CR12's "active row wins"). | |
| CR27 | **Shape.** The 200 body has exactly the seven keys of R21 and none of `user_id`, `queue_no`, `cancelled_at`, email, name or `password_hash`; nothing about the promoted person appears anywhere in it. Error bodies are exactly `{ "error": "<code>" }`; the codes here are `not_logged_in`, `wrong_role`, `not_found`, `already_checked_in`, `event_cancelled`, `event_passed`, `event_started`. | |

**Out of scope.** The organizer's capacity change and its promotions (B10, a separate spec, for example `capacity-change.md`, with `capacity-change-web.md`); the capacity form; an organizer removing or cancelling someone else's registration; cancelling by ticket code; an email to the person who cancelled; a cancellation window ("up to N hours before"); undoing a cancel (they register again, CR26); keeping the old place when registering again; bulk cancel; a "Cancelled" row in the organizer table (`design-alignment.md` DA15 stays blocked: the organizer list leaves cancelled rows out, `checkin.md` C15); a new migration, outbox kind or status; changing the sender or the reminder worker (ER72 is M7, see question 4); the web screens (`cancel-registration-web.md`); live updates.

**Assumptions.** Change any of these first in this file.
- The attendee is the signed-in account; "my registration" for an event is the active row, else the newest cancelled one (R17). One active row per event and user (the partial unique index), so the route always has at most one row to act on.
- `event_started` is the code of ER64 (new in M7). Whichever of M4 step 20 and M7 step 37 is built first adds it to the shared helper and `openapi.yaml`; the other reuses it. `api/src/events/status.ts` gets a `hasStarted(startsAt, now)` helper if it has none, shared by both.
- A repeat of a cancel request is a success (200), as for the event cancel (ER76) and the register route (R4).
- The cancel email for the cancelling person is not asked for and not added. The promoted person's email is B3.
- The promotion email's wording is not fixed; the test checks that title, start and ticket code are in it.
- A cancel request that arrives after the same person registered again cancels the new registration. The web sends the request only from the ticket page of the current active ticket.
- "Pending `reminder` rows of the registration" are deleted, not marked; deleting is what ER71 and ER79 already do for events and keeps the outbox free of emails that would be wrong.

## 2. UI decisions

No screens in this spec (API only). The screens are in `cancel-registration-web.md`. What the API gives them: 200 with the cancelled registration (show "Cancelled"), the same 200 for a repeat, 409 `already_checked_in` (the ticket was used), 409 `event_started` / `event_passed` / `event_cancelled` (the event no longer takes cancels; show a line), 404 (no ticket), 401 (attendee login), 403 (organizers have no ticket). Nothing in the answer says whether somebody was promoted.

## 3. Architecture decisions

- **Apps:** `api/` only. Express 5, TypeScript, Vitest, `pg`. No library, no migration, no env variable.
- **Router:** one more route in `registrationsRouter(pool)` (`api/src/registrations/routes.ts`), `requireUser`, uuid check with the existing `UUID` pattern, `fail(res, ...)`, `registrationShape` for the answer. No `Cache-Control` (a POST).
- **Service:** `cancelRegistration(pool, eventId, userId, now)` in `api/src/registrations/service.ts`, next to `registerForEvent` and written the same way (client from the pool, `BEGIN`, `ROLLBACK` on error, `release(broken)` in `finally`). It returns a union: `{ kind: "not_found" }`, `{ kind: "refused"; error: "already_checked_in" | "event_cancelled" | "event_passed" | "event_started" }` or `{ kind: "ok"; registration: RegistrationRow }`. The steps, in one transaction:
  1. `SELECT id, status, starts_at, duration_minutes, capacity, schedule_version, title FROM events WHERE id = $1 FOR UPDATE`. No row: rollback, `not_found`.
  2. The caller's row: `SELECT ${REGISTRATION_COLUMNS} FROM registrations r WHERE r.event_id = $1 AND r.user_id = $2 ORDER BY (r.status <> 'cancelled') DESC, r.created_at DESC, r.queue_no DESC LIMIT 1 FOR UPDATE OF r` (the same ordering as the read in `routes.ts`). No row: `not_found`. Status `cancelled`: commit, answer `ok` with it (CR12). `checked_in_at` set: `refused` `already_checked_in` (CR13).
  3. Event state with the one `now`: `deriveStatus(...)` gives `cancelled` or `passed`; else `starts_at <= now` is `event_started` (CR14). Rollback on a refusal.
  4. `UPDATE registrations SET status = 'cancelled', cancelled_at = now() WHERE id = $1 AND checked_in_at IS NULL AND status <> 'cancelled' RETURNING id` (the `checked_in_at` guard repeats the CHECK as a second safety net; zero rows is impossible under the row lock and is treated as an error).
  5. Only if the row was `registered`: `SELECT count(*)::int FROM registrations WHERE event_id = $1 AND status = 'registered'`; if the count is below the locked `capacity`: `SELECT r.id, u.email, r.ticket_code FROM registrations r JOIN users u ON u.id = r.user_id WHERE r.event_id = $1 AND r.status = 'waitlisted' ORDER BY r.queue_no LIMIT 1` (served by `registrations_waitlist`); if found: `UPDATE registrations SET status = 'registered' WHERE id = $2`, then `INSERT INTO outbox (registration_id, kind, schedule_version, event_starts_at, to_email, subject, body) VALUES ($id, 'promotion', <locked schedule_version>, <locked starts_at>, <email>, ...) ON CONFLICT (registration_id, kind, schedule_version) DO NOTHING`.
  6. `DELETE FROM outbox WHERE registration_id = $1 AND kind = 'reminder' AND status = 'pending'` (the cancelled row).
  7. Read the cancelled row again with `REGISTRATION_COLUMNS`, `COMMIT`, answer.
- **Concurrency (B3, B4):** the event row lock serialises cancels, registrations and the M7 and B10 writes of one event; different events never block each other. The caller's row lock makes a check-in of the same ticket wait; the check-in's conditional UPDATE then re-reads the row and finds `cancelled` (-> `registration_cancelled`) or, if it committed first, the cancel sees `checked_in_at` (CR20). A repeat or parallel cancel of one ticket waits on the event lock, then finds the row `cancelled` and ends in the no-op, so the promotion happens once (CR21). The promoted row is locked by the `UPDATE`; nothing else takes the registration row of a waiting person (check-in's UPDATE does not match it).
- **Reminders:** the reminder worker reads `registered` rows without the event lock today (`reminders.ts`). Without ER72's `FOR SHARE OF e` a worker that read the old state before the cancel could insert a reminder for the just-cancelled person after the delete of step 6. ER72 is built in M7 (step 37). Until then this one race is open and written in the README; it is not tested here (question 4).
- **Shared code:** `deriveStatus` and `endsAt` from `api/src/events/status.ts` (add `hasStarted` there if M7 has not). The outbox text builder sits next to `ticketEmail` in `service.ts` (`promotionEmail(event, ticketCode)`).
- **API:**

| Route | Guard | Body | Success | Errors |
|---|---|---|---|---|
| `POST /events/:id/registrations/me/cancel` | `requireUser` | none (ignored) | 200 registration (`cancelled`; also the repeat) | 401 `not_logged_in`, 403 `wrong_role`, 404 `not_found`, 409 `already_checked_in`, 409 `event_cancelled`, 409 `event_passed`, 409 `event_started` |

## 4. Files to touch

| File | What to do | Behaviours |
|---|---|---|
| `api/test/registrations/cancel.test.ts` | **Tests first (red):** CR3, CR5-CR7, CR12-CR14, CR17, CR20-CR23 (the hard ones), then CR1, CR2, CR4, CR8-CR11, CR15, CR16, CR18, CR19, CR24-CR27 in the same red commit. Needs many users and events with `starts_at` relative to a fixed `now`: create them with the helpers and delete them in the test (outbox, then registrations, events, accounts) | CR1-CR27 |
| `api/src/registrations/service.ts` | `cancelRegistration(...)` and `promotionEmail(...)` (section 3) | CR1, CR4-CR19, CR22-CR24 |
| `api/src/registrations/routes.ts` | The route, uuid check, result to status mapping, `registrationShape` | CR1-CR3, CR12-CR15, CR27 |
| `api/src/events/status.ts` | `hasStarted(startsAt, now)` if not there yet (shared with M7 `event_started`) | CR14 |
| `api/openapi.yaml` | New path `/events/{id}/registrations/me/cancel`, operationId `cancelMyRegistration`, the 200 `Registration`, a new response (for example `RegistrationNotCancellable`) with the four 409 codes and examples, the guards and `NotFound`; the description names the idempotent 200, the lock, the promotion and the reminder delete; bump the version to the next minor (the file says 0.8.0 now) | all |
| `README.md` | Add the route under the registration routes; "Project status": cancel and promote work, the promotion email is stored and sent by the sender, the worker race of question 4 | |
| `ROADMAP.md`, `docs/specs/registration.md` | Point M4 and `registration.md` ("Not in this spec", assumptions) at this file (done by the build step, not by this spec): see the proposed M4 text in the hand-off | |

Tests follow `registration.md` section 4: `createApp().listen(0)` and `fetch`, one cookie per attendee, `Promise.all` for the parallel cases, the pool large enough for 20 waiting connections, no new test library. The check-in race (CR20) calls `POST /checkin` with an organizer cookie of the event's owner. The reminder case (CR18) calls `enqueueReminders(pool, now)` directly with a fixed `now`.

## 5. Done means

- Tests, typecheck and linter pass in `api/`.
- Every behaviour CR1 to CR27 has a test, or a note in the README that says it is not covered.
- The tests-first set (CR3, CR5-CR7, CR12-CR14, CR17, CR20-CR23) is committed red, before `cancelRegistration`, and shown failing for the right reason (no route, a second promotion, or two `registered` on one seat), then green.
- `api/openapi.yaml` and the README list the route and the four 409 codes.
- `git diff --stat` shows no change in `api/src/db/migrations/`, `package.json`, `api/src/email/` or `web/`.

## 6. Open questions (each with a recommended answer)

1. **Route.** `POST /events/:id/registrations/me/cancel` or `DELETE /events/:id/registrations/me`. **Recommended: the POST** (action POSTs are the API's style; the row is kept; `/me` already names the caller's row). Alternative: DELETE answering 200 with a body (unusual, and the thing still exists afterwards).
2. **Second cancel of the same ticket.** **Recommended: 200 with the same row** (CR12; same as ER76, R4; the web retries and double clicks are harmless). Alternative: 409 `already_cancelled` (a new code; the web would need a case for it).
3. **A waiting person after the event has started.** **Recommended: refused like a seat (`event_started`)**, one rule, as asked. Alternative: allow leaving the list of a running event (no seat is freed, so nothing is lost); one more branch and one more test.
4. **Delete the cancelled person's pending reminder (CR17) and the worker race.** **Recommended: delete in the transaction; build the cancel route after M7's ER72, or accept the small race until then and note it in the README.** Alternative: leave the queued reminder (the cancelled person may get an email for a ticket that is no longer valid).
5. **Registering again after a cancel.** **Recommended: a new row at the end of the list (CR26)**, as R12 and the unique index say; no "keep my place". Alternative: re-activate the old row (breaks "a cancelled row is history" and B1's one-active-row model).
6. **Order of two 409s for a checked-in person on a cancelled or ended event.** **Recommended: `already_checked_in` first** (CR13; `DATABASE.md` 3.7 says checked-in people "still get 409"). Note this is the opposite order to `POST /checkin` (C9: `event_cancelled` first); there the organizer is told the event is closed, here the attendee is told the ticket was used. Alternative: `event_*` first, for symmetry with C9.
7. **Email for the person who cancels.** **Recommended: none** (not asked; no new kind). Alternative: a `cancelled` outbox kind needs a migration; not worth it.
8. **Promotion email wording** (CR7). **Recommended:** subject `You have a seat at <title>`, body title, start (UTC) and ticket code. Alternative: any wording that has those three.
