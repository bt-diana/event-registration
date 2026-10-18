# Spec: Check-in and arrivals counter (M5, organizer, API only)

Feature spec for milestone M5, made from `SPEC_TEMPLATE.md` (sections 1-5). No new table and no migration: `registrations.checked_in_at` and its CHECK are in `DATABASE.md` (section 1, rules 3.3, 3.8 and 3.10); this file does not change them. Login, guards and the error format come from `auth.md` (A13-A15); events and ownership from `events.md`; tickets from `registration.md`. Behaviours B6 and B7 of the template. Roadmap steps 24-28 (this spec is step 24). The live counter (server-sent events) is M8 and extends this file later; here the counter is a plain route that the screen polls. The counter route itself is `GET /events/:id/arrivals`, specified in `arrivals.md` (D47, which reverses D45); this file keeps check-in and the organizer list.

## 1. Goals and expected behaviour

**Goal.** An organizer types or pastes a ticket code at the door. The first time, the person is checked in and the organizer sees who it is. Any later try with the same code is refused, also when many requests come at the same moment. The organizer can also ask how many people have arrived out of how many are registered.

**Behaviours.** Each line is something that can be checked. The ids C1, C2, ... are for this feature. "Step 25" tests are written and committed before the code (red), as the roadmap says; the tests marked "yes" are the hard ones.

| # | Behaviour | Test first? |
|---|---|---|
| C1 | Guards on `POST /checkin` and `GET /events/:id/registrations`: no valid login answers 401 `not_logged_in`; an attendee cookie answers 403 `wrong_role` (`requireOrganizer`, A14, A15). No handler runs and nothing is written. The guard runs first, so a bad body from an anonymous caller is 401. | yes (step 25) |
| C2 | Body of `POST /checkin` is `{ "ticket_code": string }`. The code is trimmed and upper-cased in the app. After that it must be 10 characters from the ticket alphabet (`A-Z` without `I` and `O`, `2-9`; `registration.md` R2); anything else (missing, not a string, wrong length or characters, spaces inside) answers 400 `{ "error": "invalid_input" }` and never reaches the database. `" abcd2345wx "` finds the ticket `ABCD2345WX`. Other body fields are ignored. | |
| C3 | (B6) First check-in: an organizer sends the code of a `registered` ticket on an `active` event of their own with `checked_in_at` NULL. The row gets `checked_in_at = now()` and the answer is 200 with the check-in shape (section 3). The stored value and the answered `checked_in_at` are the same instant. | yes (step 25) |
| C4 | (B6) Five parallel `POST /checkin` with the same code: exactly one answer is 200, four are 409 `already_checked_in`. `checked_in_at` is set once and one registration row is changed. The test repeats on several fresh tickets (for example 5 rounds). | yes (step 25) |
| C5 | (B6) A second check-in with the same code, later, answers 409 `{ "error": "already_checked_in", "checked_in_at": <the first time>, "attendee_name": <name> }`. The stored `checked_in_at` is not changed. The time in the 409 is the original one, in all five answers of C4 too. | yes (step 25) |
| C6 | A code with the right shape that no registration has answers 404 `{ "error": "not_found" }`. A ticket of another organizer's event answers the same 404 with the same body, and nothing is changed (`DATABASE.md` 3.8, decision 10). The test checks that the two answers are equal. | yes (step 25) |
| C7 | A `waitlisted` ticket answers 409 `{ "error": "waitlisted" }`. Nothing is changed (the CHECK would refuse it anyway). | yes (step 25) |
| C8 | A ticket with status `cancelled` (made by SQL in the test; the cancel route is M4) answers 409 `{ "error": "registration_cancelled" }`. Nothing is changed. | yes (step 25) |
| C9 | A ticket of an event with stored status `cancelled` answers 409 `{ "error": "event_cancelled" }`, nothing is changed. This is checked before the ticket status, so a `registered` ticket and an already checked-in ticket of a cancelled event both answer `event_cancelled`. | yes (step 25) |
| C10 | A `passed` event (derived, `events.md` E19) still allows check-in: late arrivals are real. The first check-in answers 200; a repeat answers 409 `already_checked_in`. | |
| C11 | An event that has not started yet still allows check-in (early arrival): 200. There is no time window. | |
| C12 | Classification is race-safe (section 3): the conditional UPDATE decides; a zero-row result is explained by reading the row afterwards, in this order: no row for this organizer is `not_found`; event cancelled is `event_cancelled`; ticket `cancelled` is `registration_cancelled`; `waitlisted` is `waitlisted`; `checked_in_at` set is `already_checked_in`. A check-in never answers 200 for a ticket it did not change, and never answers 409 for a ticket that is still free to check in. | |
| C13 | A check-in changes only `registrations.checked_in_at` of that one row. No outbox row, no change of status, `ticket_code` or any other row. | |
| C14 | The check-in shape (200) has exactly these keys: `registration_id`, `ticket_code`, `event_id`, `event_title`, `attendee_name`, `checked_in_at`. `ticket_code` is the stored (normalised) code; `checked_in_at` is an ISO string in UTC. It never contains the attendee's email, `user_id`, `password_hash`, `queue_no` or another person's data. The test checks the exact key list. | |
| C15 | (B7) `GET /events/:id/registrations` for an event of the logged-in organizer answers 200 `{ "registrations": [ ... ] }`: one item for every `registered` and `waitlisted` row of that event (cancelled rows are left out), ordered by `created_at`, then `id`. Each item has exactly these keys: the registration shape of `registration.md` R21 (`id`, `event_id`, `status`, `ticket_code`, `waitlist_position`, `checked_in_at`, `created_at`) plus `attendee_name` and `attendee_email`. It never contains `user_id`, `queue_no`, `cancelled_at`, `password_hash` or another event's data. An event with nobody gives `[]`. The test checks the exact key list. | |
| C16 | (B7) The arrivals counter is `GET /events/:id/arrivals` (`arrivals.md`, D47); the screen no longer counts it from this list (`waitlisted` items are never arrivals). The list still follows the data: after each successful check-in that item has `checked_in_at` set and nothing else changes; a refused check-in (C4-C9) changes nothing. A `waitlisted` item always has `checked_in_at: null`. | |
| C17 | An event that is unknown, not a uuid, or owned by another organizer answers 404 `{ "error": "not_found" }` on the list route, the same body. A malformed id never reaches the database (same as E7, E8). A cancelled or passed event of the organizer still answers 200 with its rows. The attendee's name and email are shown only to the owning organizer. | yes (with C1) |
| C18 | The list is a fresh snapshot for polling: one query, no lock, no server-side caching, and the response has `Cache-Control: no-store`. Two reads with a check-in between them show the new `checked_in_at`. No paging (the capacity of an event is small); a bigger event is a later change. | |
| C19 | Errors use `{ "error": "<code>" }` as in `auth.md`. Codes here: `invalid_input`, `not_logged_in`, `wrong_role`, `not_found`, `already_checked_in`, `waitlisted`, `registration_cancelled`, `event_cancelled`. Only `already_checked_in` carries more keys (`checked_in_at`, `attendee_name`). | |

**Not in this spec.** The check-in screen and the counter screen (`checkin-web.md`, M5 step 27), live updates by server-sent events (M8), undo of a check-in, checking in by name or by attendee id, a list of who arrived or who is missing, a camera or QR scanner, a self check-in by the attendee, sending an email on check-in, cancelling a checked-in ticket (409, `DATABASE.md` 3.5, M4), check-in of the waiting list, a time window around the start.

**Assumptions.** Change any of these first in this file.
- Early and late check-in are allowed (C10, C11). `DATABASE.md` 3.10 suggested "allow" for passed events. The note in `registration.md` R11 ("the check-in rules of M5 decide who may arrive") is answered here: anyone with a `registered` ticket can arrive at any time as long as the event is not cancelled. New tickets for a passed event are still refused by R10; only existing tickets can arrive late.
- The organizer needs a name at the door, so the answer has `attendee_name` (from `users.name`). The email is not sent; the organizer does not need it.
- The first check-in time is what the organizer sees on a repeat (C5). It is the stored value, not the time of the repeat.
- Code lookup is exact after trim and upper-case. Look-alike letters are not mapped (an `O` or `I` is `invalid_input`, because no ticket has them).
- The code is unique across all events (`ticket_code UNIQUE`), so no event id is needed in the body; the organizer's ownership decides which tickets are visible.
- "Waiting" has a distinct error (`waitlisted`) so the screen can say "on the waiting list, no seat yet". It is not a 404, because the organizer owns that event.
- The counter is the separate route `GET /events/:id/arrivals` (`arrivals.md`; D45 "no arrivals route" was reversed by D47). `GET /events/:id/registrations` stays as the organizer list. That route is the organizer registrations list that `registration-web.md` (open question 2, option A) asked for, so this spec defines it and `registration-web.md` W-R20 and W-R21 can use it; `events.md` shapes (E10) stay unchanged. Name and email go to the owning organizer only (same decision as option A).
- `registration-web.md` asked for both routes (its open questions 2 and 10). This spec answers them and `registration-web.md` was changed to match: the scan screen sends `POST /checkin` with the code only, the error codes are the ones in C19, and the organizer screen reads the list of C15. A ticket of another of the organizer's own events can be checked in at the scan screen; the answer names its `event_title` so the organizer sees it. The web steps add the `/checkin` entry to the Vite dev proxy (`/events` is proxied already).
- Rows made by tests (cancelled tickets, cancelled and passed events, other organizers) are inserted by SQL with the helpers in `api/test/db/helpers.ts`.

## 2. UI decisions

No screens in M5 API (API only). The check-in screen and the counter are in `checkin-web.md` (step 27). What the API gives them: 200 (checked in: show `attendee_name`, `ticket_code`, `event_title`), 409 `already_checked_in` (show the name and the first time), 409 `waitlisted`, 409 `registration_cancelled`, 409 `event_cancelled`, 404 (unknown code, same for another organizer's), 400 (not a valid code, say "check the code"), 401 (go to organizer login), 403 (attendees cannot check in). For the counter: read `GET /events/:id/arrivals` (`arrivals.md`) again every few seconds (polling; M8 adds the live stream).

## 3. Architecture decisions

- **Apps:** `api/` only. Express 5, TypeScript, Vitest. No new table, no migration, no library, no env variable.
- **Router:** a new `checkinRouter(pool)` mounted after `registrationsRouter(pool)`. Guard `requireOrganizer` per route. `POST /checkin` does not collide with any `/events/...` path; `GET /events/:id/registrations` has the same path as the `POST` of `registrationsRouter` and another method, so it is added in `checkinRouter` without a clash (the `/me` route is a different path).
- **Check-in service (B6): one conditional UPDATE, no lock, no explicit transaction** (`DATABASE.md` 3.3):
  ```sql
  UPDATE registrations r SET checked_in_at = now()
  FROM events e, users u
  WHERE r.event_id = e.id AND u.id = r.user_id
    AND e.organizer_id = $organizer AND e.status = 'active'
    AND r.ticket_code = $code AND r.status = 'registered' AND r.checked_in_at IS NULL
  RETURNING r.id, r.ticket_code, r.event_id, e.title, u.name, r.checked_in_at;
  ```
  `e.status = 'active'` is the stored column, so a passed event is allowed (C10); there is no time test. One row back is 200. Under READ COMMITTED a second statement that waits for the row lock re-checks the WHERE after the first commits and then matches no row, so of 5 parallel calls exactly one returns a row (C4). The `users` row is read, not locked.
- **Zero rows (C12):** read the row afterwards, one query, joined to the events of this organizer: `SELECT r.status, r.checked_in_at, e.status AS event_status, u.name FROM registrations r JOIN events e ON e.id = r.event_id JOIN users u ON u.id = r.user_id WHERE r.ticket_code = $1 AND e.organizer_id = $2`. No row is `not_found` (unknown and foreign look the same). Otherwise classify in the order of C12. This is race-safe because every state that makes the UPDATE fail only moves one way: `checked_in_at` is never cleared, a cancelled registration and a cancelled event never come back, and a checked-in ticket cannot be cancelled (`DATABASE.md` 3.5, 3.7). So whatever the read shows was already true when the UPDATE failed, or is a later state that is still a valid reason. One move can go the other way: a `waitlisted` ticket promoted to `registered` between the UPDATE and the read (B3). If the read shows `registered`, active event, `checked_in_at` NULL, the app runs the UPDATE once more and classifies the result the same way; it never invents an error for a free ticket. Cancel and check-in on one registered ticket are ordered by the row lock: if the check-in wins, the cancel (M4) must find `checked_in_at` set and answer 409; if the cancel wins, the check-in matches no row and reads `registration_cancelled`. M4 must make that check under its own lock.
- **Code normalisation:** `trim()` then `toUpperCase()`, then a regex over the 32-character alphabet from `api/src/registrations/ticket.ts` (reuse the alphabet constant, do not copy it).
- **Registrations list (B7): one query, no lock:** `SELECT r.id, r.event_id, r.status, r.ticket_code, r.checked_in_at, r.created_at, r.queue_no, u.name, u.email FROM events e JOIN registrations r ON r.event_id = e.id JOIN users u ON u.id = r.user_id WHERE e.id = $1 AND e.organizer_id = $2 AND r.status IN ('registered','waitlisted') ORDER BY r.created_at, r.id`. A missing event is checked with the ownership read first (no row is 404; an owned event with no rows is `[]`). `waitlist_position` is computed as in `registration.md` R17 and is `null` for `registered`. One statement for the rows, so they come from one snapshot. Response header `Cache-Control: no-store`.
- **Polling now, SSE later:** the screen calls the arrivals route (`arrivals.md`) every few seconds (`checkin-web.md` sets the interval). M8 adds a stream next to it and keeps this route as the fallback; the keys do not change.
- **Shapes** (all JSON):
  - check-in 200: `{ registration_id, ticket_code, event_id, event_title, attendee_name, checked_in_at }`
  - list 200: `{ registrations: [ { id, event_id, status, ticket_code, waitlist_position, checked_in_at, created_at, attendee_name, attendee_email } ] }`
- **API:**

| Route | Guard | Body | Success | Errors |
|---|---|---|---|---|
| `POST /checkin` | `requireOrganizer` | `{ ticket_code }` | 200 check-in shape | 400 `invalid_input`, 401 `not_logged_in`, 403 `wrong_role`, 404 `not_found`, 409 `already_checked_in` (+ `checked_in_at`, `attendee_name`), 409 `waitlisted`, 409 `registration_cancelled`, 409 `event_cancelled` |
| `GET /events/:id/registrations` | `requireOrganizer` | none | 200 list shape | 401, 403, 404 `not_found` (unknown, malformed or foreign event) |

  Two routes. `$organizer` is always the id from the cookie, never from the body.

## 4. Files to touch

| File | What to do | Behaviours |
|---|---|---|
| `api/test/checkin/checkin.test.ts` | Tests first (step 25, red): C4 and C5 (5 parallel calls, repeated on fresh tickets, original time in every 409), C3, C6 (unknown and foreign equal), C7, C8, C9, C1 (guards), C2 (normalisation, bad shapes), C10, C11, C13, C14 (exact key list). The test shows red for the right reason (no route, or two 200s) | C1-C14 |
| `api/test/checkin/registrationsList.test.ts` | Step 26, written before the list route: C15-C18 (rows with registered, waiting, cancelled and checked-in rows by SQL, exact key list, order, moves after a check-in, 404 for unknown, malformed and foreign event, guards, `no-store`) | C15-C19 |
| `api/src/checkin/service.ts` | `checkIn(pool, organizerId, code)`: the UPDATE, the read and classify step, the one retry; returns a result type, no HTTP. `listRegistrations(pool, organizerId, eventId)` | C3-C13, C15, C16 |
| `api/src/checkin/routes.ts` | `checkinRouter(pool)`: the two routes, code normalisation, uuid check, `requireOrganizer`, result to status and shape mapping, the header | C1, C2, C14, C17-C19 |
| `api/src/registrations/ticket.ts` | Export the alphabet (and length) so the check-in regex uses the same one. No other change | C2 |
| `api/src/app.ts` | Mount `checkinRouter(pool)` after `registrationsRouter(pool)`, before the 404 handler | all |
| `api/openapi.yaml` | Add the two routes, the two shapes and the 409 bodies | all |
| `docs/specs/registration-web.md` | Done with this spec: questions 2 and 10, W-R20, W-R33, W-R34 and the scan texts follow `checkin.md` | C3-C9, C15 |
| `README.md` | Add the two routes; update "Project status" | |
| `ROADMAP.md` | Step 24 done now; steps 25, 26 when finished | |

Tests use the existing style (`createApp().listen(0)` and `fetch`, the helpers in `api/test/auth/helpers.ts` and `api/test/db/helpers.ts`; no new test library). The parallel test uses `Promise.all` over 5 `fetch` calls with one organizer cookie. Rows made by a test are deleted by that test (outbox, registrations and events first, then accounts).

## 5. Done means

- Tests, typecheck and linter all pass in `api/`.
- Every behaviour C1-C19 has a test, or a note in the README that says it is not covered.
- C3-C9 (B6) have their tests written and committed before the check-in service (roadmap step 25); C4 and C5 are the core of that red commit. The red run is shown failing for the right reason, then green after step 26.
- `api/openapi.yaml` and the README list the two routes; "Project status" says that the counter is read from the arrivals route and polled and that live updates are not built yet.

## 6. Open questions

For the user to confirm (a recommendation is already in this spec):

1. Passed event allows check-in, and so does an event that has not started (C10, C11). Recommended: allow both.
2. The success answer shows `attendee_name` and no email (C14). Recommended: name only.
3. Error codes `waitlisted`, `registration_cancelled`, `event_cancelled`, and `already_checked_in` with the original `checked_in_at` and `attendee_name` (C5, C19). Recommended: as written.
4. A malformed code is 400 `invalid_input`, a well-formed unknown code is 404 `not_found`; no mapping of look-alike letters (C2). Recommended: as written.
5. Decided by the user (D45), then reversed (D47): the counter comes from `GET /events/:id/arrivals` (`arrivals.md`); `GET /events/:id/registrations` (C15-C18) stays as the organizer list.
