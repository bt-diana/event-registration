# Spec: Edit an event (API only)

Feature spec made from `SPEC_TEMPLATE.md` (sections 1-5; its behaviours are not requirements). It adds one route, `PATCH /events/:id`, that changes the **title**, the **description** and the **duration** of an own event. No migration, no new table, no new library, no new error code. The web side is `event-edit-web.md` (W-EE). Ids are **EE1, EE2, ...** (checked: no clash with `E`, `ER`, `DS`).

Rules are reused, not copied: the field rules are `events.md` E2/E3 (title, duration) and `event-description.md` DS4-DS7 (description); the closed-event codes are the ones of `registration.md` R10 (`event_cancelled`, `event_passed`, same order); ownership is `DATABASE.md` 3.8 (404, one body); the lock is the one of 3.1/3.6/3.7. The start time keeps its own route (`POST /events/:id/reschedule`, `email-reminders.md` ER61-ER70) and capacity will keep its own route (B10, `DATABASE.md` 3.9, M4): this route refuses both (EE4).

**State of the code.** `api/src/events/routes.ts` has no update today (`README.md`: "set only on create"). The M7 routes (ER61+) are specified but not built when this spec is written; EE18 is the only behaviour that needs them.

## 1. Goals and expected behaviour

**Goal.** A logged-in organizer corrects the title, the description or the length of an event they own, without creating a new event and without touching registrations, tickets, emails or the start time.

**Behaviours.** Each line is something a test can prove. "Test first" marks the ones whose test is committed before the code (the roadmap default is no).

Route, guard, ownership:

| # | Behaviour | Test first? |
|---|---|---|
| EE1 | `PATCH /events/:id`, guard `requireOrganizer` (A14, A15). No valid login answers 401 `not_logged_in`, an attendee cookie 403 `wrong_role`. The guard runs first, so for an anonymous caller a malformed id or a bad body is 401, and nothing is read or written. The organizer is the cookie's, never a body field. | |
| EE2 | **404, one body.** An id that is not a uuid, an unknown event and another organizer's event all answer 404 `{ "error": "not_found" }`, byte for byte the same. A malformed id never reaches the database. For the foreign event the test proves that the event row, its registrations and the outbox are equal before and after, also for a body that would be valid. A bad body for a foreign or unknown event is still 400 (EE8 runs before the lookup), as ER63 does. | yes |

Body and validation:

| # | Behaviour | Test first? |
|---|---|---|
| EE3 | **Partial update.** The body is a JSON object with any of `title`, `description`, `duration_minutes`. A key that is present is changed; a key that is missing is left alone. At least one of the three must be present, else 400 `invalid_input` (`{}`, a body with only unknown keys, a body that is not an object, an array, `null`). | |
| EE4 | **Fields that have their own route are refused, not ignored.** A body that has `starts_at`, `capacity` or `status` (with any value, even the current one) answers 400 `invalid_input`, writes nothing, also when valid fields are sent with it. The body is exactly `{ "error": "invalid_input" }` like every error (E17, ER86); the pointer to `POST /events/:id/reschedule` and to the capacity route (B10) is in the `description` of the route in `api/openapi.yaml`, not in the response. Other unknown keys (`organizer_id`, `schedule_version`, ...) are ignored as in E2 and change nothing. | |
| EE5 | `title`, when present: the rules of E2/E3 (a string, trimmed, 1 to 200 code points, no NUL). `null`, a number, an empty or whitespace-only string, too long or with NUL: 400 `invalid_input`. A title is never cleared. | |
| EE6 | `description`, when present: the rules of DS4-DS7 (a string or `null`, trimmed, up to 2000 code points, no NUL; wrong type or NUL: 400). `null`, `""` and whitespace-only **clear** the description to `''` (an edit can remove it; this is the one place where "present but empty" is valid). Inner line breaks are kept (DS5). | |
| EE7 | `duration_minutes`, when present: a JSON integer from 1 to 1440 (E2). A string, a decimal, `null`, 0, 1441: 400 `invalid_input`. | |
| EE8 | **All or nothing, before any query.** Body checks (EE3-EE7) run after the guard and the uuid check and before the database is touched. One bad field makes the whole request 400 and none of the other fields is written. | |

State rules, under the lock:

| # | Behaviour | Test first? |
|---|---|---|
| EE9 | **Closed events are refused.** Stored `cancelled` answers 409 `event_cancelled`; else `now >= starts_at + duration` (ended) answers 409 `event_passed`; cancelled wins over passed (same order as R10, ER64). Nothing is written, for any of the three fields, also for a no-op body. Edges: at exactly `now = ends_at` the answer is `event_passed`; one millisecond before it the edit is allowed. The 409 is decided before the end check of EE11 and before the no-op check of EE13. `event_started` is **not** used here (EE10). | |
| EE10 | **A running event (started, not ended) can be edited.** Title, description and duration are accepted for it (a typo found on the day, an event that runs long). The start does not change, so nothing about the start changes. | |
| EE11 | **The new end must be in the future.** If `duration_minutes` is present: `starts_at + new duration` must be strictly after `now`, else 400 `invalid_input` and nothing is written. This can only fail for a running event (for a future event the end is always after `now`). Edges: new end exactly `now` is 400; one millisecond after is 200. So an edit can never turn an active event into `passed`, and can never bring an ended event back (that is EE9). Reason: `passed` closes registration (R10), the public list and the reminders, which is the job of the clock and of cancel, not of an edit. | |
| EE12 | **What the new duration changes, and only that.** `ends_at` in the answer is `starts_at` plus the new duration; the derived `status` (E19), the public `has_started`/`full` rules and the filter of `GET /public/events` (PL2) use the new end at the next read. `starts_at`, `capacity`, `status` (stored), `cancelled_at`, `schedule_version`, `created_at`, `organizer_id` and every registration (status, `ticket_code`, `checked_in_at`, waiting order) are unchanged. Test: read the event, the registrations and `schedule_version` before and after. | |
| EE13 | **No-op.** If every present field, after trimming, equals the stored value, the answer is 200 with the unchanged event and **no UPDATE runs** (the test compares all columns of the row before and after). It is not an error and not a 409 for an open event. | |

Emails, answer, concurrency:

| # | Behaviour | Test first? |
|---|---|---|
| EE14 | **No emails, no outbox change.** An edit writes no `outbox` row (no new kind, no "event changed" email), deletes none and rewrites none: `outbox` rows are immutable (ER10), so a `ticket`, `promotion` or `reschedule` row written earlier keeps the title it was written with, also while still `pending`. Rows written after the edit take the title that is stored then (`ticketEmail` reads the locked row; the reminder statement reads `e.title`). `description` and `duration_minutes` are in no email text (ER19, ER68, ticket email), so those edits change nothing there. Test: a pending ticket row keeps its subject after a title edit; a registration made after it gets the new title in its ticket subject; the outbox count is equal before and after. | |
| EE15 | **Reminders are not touched.** An edit does not change `schedule_version` and does not read the start, so a reminder already written for the version blocks a second one (B5, ER31): after a title and a duration edit, `enqueueReminders` inside the window writes 0 new rows for people who already have one, and writes one row for a person who has none yet, with the new title in the subject. The reminder window uses `starts_at` only (ER24). | |
| EE16 | **Answer.** 200 with the organizer event shape (`OrganizerEvent`: exactly the keys of `events.md` section 3 plus `description`, no `organizer_id`), built from the committed state with the real `registered` and `seats_left` (E10), for every status. It equals what `GET /events/:id` answers right after. The public routes (`GET /public/events/:id`, `GET /public/events`, `GET /me/registrations`) show the new title, description and duration at their next read; no code is needed for that (they read the row), one test proves it. | |
| EE17 | **Lock, no lost update.** The write runs in one transaction that starts with the ownership `SELECT ... FOR UPDATE` (EE19), the same lock as register, cancel and reschedule. (a) Two parallel PATCHes, one with `title`, one with `duration_minutes`: both 200, the final row has both new values (the `UPDATE` sets only the columns that changed, never the whole row from a stale read). (b) Two parallel PATCHes of the title: both 200, the final title is one of the two, no 500. (c) 20 parallel registrations and one title edit: every registration succeeds, and each ticket row's subject holds the old or the new title, whole, never an error. | yes |
| EE18 | **Race with cancel and reschedule** (needs the M7 routes, ER61+; written when they exist, in step 37 or later). (a) PATCH and `POST /events/:id/cancel` at the same time: the event ends `cancelled`; the PATCH is either 200 before it (and the `event_cancelled` rows hold the new title, because the cancel reads the row after the lock) or 409 `event_cancelled` and wrote nothing; no 500. (b) PATCH of the duration and a reschedule at the same time: both 200 or the PATCH is 409; the final row has the rescheduled start **and** the new duration, `schedule_version` is `+1`, `ends_at` is `starts_at + duration`. | yes |
| EE19 | Errors use `{ "error": "<code>" }`. Codes here, all existing: `invalid_input`, `not_logged_in`, `wrong_role`, `not_found`, `event_cancelled`, `event_passed`. Order of checks: guard (401/403) -> uuid (404) -> body (400: EE3-EE8) -> transaction: ownership lock (404) -> state (409: EE9) -> end check (400: EE11) -> no-op check (EE13) -> write -> COMMIT -> read. No response contains `password_hash`. | |

**Out of scope.** Changing `starts_at` (reschedule, ER61-ER70) and `capacity` (B10); cancelling the event; deleting an event; a history or "edited" marker, `updated_at`, or an audit log; telling attendees by email that the title, description or duration changed; rewriting emails already in the outbox; editing a cancelled or ended event; editing the organizer or any registration; optimistic locking (`If-Match`, a version in the body); `PUT`; bulk edits; the web screens (`event-edit-web.md`).

**Assumptions.** Change any of these first in this file.
- `PATCH` is the route style asked for. `email-reminders.md` question 10 preferred action routes for reschedule and cancel because a general PATCH "would have to define every other field"; this spec does that by naming exactly three editable fields and refusing the two that have a route (EE4).
- Last write wins on the same field (EE17b); there is no version check. Two organizer tabs editing the same event is an accepted case.
- The title is shown in emails at the time the row is written; an attendee who got a ticket before the edit has the old title in that email. Accepted (EE14); the ticket page and the public page show the current title.
- A changed duration is not announced to anyone. No email says when the event ends (EE14).
- `now` is read **once, after the lock is held** (not before the transaction as the M7 text says for its routes), so a request that waited for the lock cannot extend an event that ended while it waited. The answer's derived fields use the same `now`.
- A no-op on an open event is 200, not an error (a retry or a double click is not wrong; same as ER65).

## 2. UI decisions

No screens here (API only); they are in `event-edit-web.md`. What the API gives them: 200 with the full organizer event (put into the cache as it is); 400 `invalid_input` (no field names; the client checks first, so a 400 is rare); 409 `event_cancelled` / `event_passed` (the page shows the closed state); 404 (not found); 401/403 (re-check `me`).

## 3. Architecture decisions

- **Apps:** `api/` only. Express 5, TypeScript, Vitest. No migration (the three columns exist, `002`, `003`), no library, no env variable.
- **Where:** in `eventsRouter` in `api/src/events/routes.ts`, next to the other routes, reusing `cleanText`, `parseDescription`'s rules, `isIntegerIn`, `fields`, `UUID`, `COLUMNS`, `SELECT_WITH_COUNT`, `organizerShape`, `fail` and the limits constants. `parseDescription` maps a missing value to `''` for create; the patch parser checks "key present" first (`Object.hasOwn`), so for the patch `null` and `''` clear and a missing key does nothing. Do not duplicate the limits. If the file gets too long, move the shared parts to a small module in `api/src/events/` without changing their behaviour (the existing tests stay green).
- **Body parser:** one pure function `parseEventPatch(body)` that returns `{ title?, description?, durationMinutes? }` or `null` (EE3-EE8, EE4 included). It does not know `now`; the end check (EE11) needs the locked row and is done in the transaction.
- **Transaction** (like `registerLocked`: `pool.connect()`, `BEGIN`, `ROLLBACK` on any thrown error, release in `finally`):
  1. `SELECT id, title, description, starts_at, duration_minutes, status FROM events WHERE id = $1 AND organizer_id = $2 FOR UPDATE` (ownership and lock in one statement, `DATABASE.md` 3.8). No row: `ROLLBACK`, 404.
  2. `now = new Date()` (after the lock).
  3. `deriveStatus(...)` from `api/src/events/status.ts`: `cancelled` -> 409 `event_cancelled`; `passed` -> 409 `event_passed` (EE9).
  4. If a duration was sent and `endsAt(starts_at, duration) <= now`: 400 (EE11).
  5. Keep only the fields whose value differs from the row. None: skip the write (EE13).
  6. `UPDATE events SET <changed columns> WHERE id = $1`. The column names come from a fixed whitelist of three in the code, the values are `pg` parameters; no part of the body is put into the SQL text. `schedule_version`, `status`, `starts_at`, `capacity` are never in the `SET`.
  7. `COMMIT`.
- **Answer:** after the commit, `SELECT_WITH_COUNT ... WHERE e.id = $1 AND e.organizer_id = $2 GROUP BY e.id` and `organizerShape(row, now)` with the same `now`. `Cache-Control` is not set (as for the other event routes).
- **Why no outbox work:** see EE14. The sender, the reminder worker and the registration service are not changed.
- **API:**

| Route | Guard | Body | Success | Errors |
|---|---|---|---|---|
| `PATCH /events/:id` | `requireOrganizer` | `{ title?, description?, duration_minutes? }`, at least one | 200 organizer event | 400 `invalid_input`, 401 `not_logged_in`, 403 `wrong_role`, 404 `not_found` (malformed, unknown or not yours), 409 `event_cancelled` / `event_passed` |

## 4. Files to touch

| File | What to do | Behaviours |
|---|---|---|
| `api/test/events/update.test.ts` (new) | **Tests first (red):** EE2 (two organizers, the foreign event equals the unknown one, nothing changed), EE17 (parallel PATCHes, registrations during an edit); then EE1, EE3-EE16, EE19 (edges with rows inserted by SQL: running event, `now = ends_at`, new end exactly `now`; the outbox, the registrations and the schedule version compared before and after; `enqueueReminders` after an edit). Uses the existing style (`createApp().listen(0)`, `fetch`, helpers in `api/test/auth/helpers.ts` and `api/test/db/helpers.ts`) | EE1-EE17, EE19 |
| `api/test/events/updateRace.test.ts` (new, later) | EE18, written when the M7 routes exist; until then it is `it.todo` or absent, and the README says EE18 waits for M7 | EE18 |
| `api/src/events/routes.ts` | `parseEventPatch`, the `PATCH /events/:id` route and its transaction (section 3). Existing routes and tests unchanged | EE1-EE19 |
| `api/openapi.yaml` | Add `patch` to `/events/{id}`, request schema `EventPatch` (`minProperties: 1`, the three properties, a description that names `POST /events/{id}/reschedule` and the capacity route for the refused keys), responses 200 (`OrganizerEvent`), 400, 401, 403, 404, 409 (`event_cancelled`, `event_passed`); minor version bump | EE1-EE19 |
| `README.md` | Add the route next to the other event routes; replace "set only on create (there is no edit route yet)" in the description paragraph; "Project status" | |
| `docs/DATABASE.md` | Section 3.8: add the edit route to the list of ownership checks (one line) | EE2 |
| `ROADMAP.md` | Steps for this feature (proposed in the report of this spec), marked when done | |

Not touched: migrations, `api/src/registrations/`, `api/src/email/`, `api/src/checkin/`, `web/`, `package.json`.

## 5. Done means

- Tests, typecheck and linter all pass in `api/` (`bash scripts/verify.sh`).
- Every behaviour EE1 to EE19 has a test, or a note in the README that says it is not covered (EE18 until the M7 routes exist).
- EE2 and EE17 have their tests written and committed before the code (red first, then green).
- All existing tests of `events.md`, `event-description.md`, `registration.md` and `email-reminders.md` stay green without edits.
- `git diff --stat` of the code step shows no migration, no change in `package.json`, nothing under `web/`.
- `api/openapi.yaml` and the README list the route; `README.md` no longer says there is no edit route.

## 6. Open questions (each with a recommended answer)

1. **Should PATCH also accept `starts_at` and `capacity`?** **Recommended: no** (EE4, 400). The start has side effects (version bump, `reschedule` emails, reminders for a new version) that live in the reschedule route (ER65-ER70); capacity has promotions (B10, M4). Folding them into PATCH would duplicate those rules or hide them. Alternative: accept them and call the same service functions; that makes this route depend on M4 and M7 being built.
2. **Edit a cancelled or ended event?** **Recommended: refuse every field with 409** (EE9), the same as register, reschedule and the hidden button. Alternative: allow title and description (not duration) on an ended event to fix a typo in an archive; cheap to add later, and it would change EE9 and W-EE1.
3. **Edit a running event?** **Recommended: yes** (EE10) for all three fields, with the end rule of EE11. Alternative: refuse with `event_started` like reschedule; that blocks fixing a typo or extending a running event.
4. **Shorten a running event so the new end is not in the future.** **Recommended: 400 `invalid_input`** (EE11): an edit does not end an event. Alternative: allow it (the event becomes `passed` at once, closing registration); then there is a second way to "end now" without a cancel.
5. **Unknown keys.** **Recommended: ignore them, except `starts_at`, `capacity` and `status`, which are refused** (EE4), because those three would be silently dropped by a client that believes it changed them. Alternative: reject every key outside the three (a typo in a field name is then a 400 too).
6. **Clearing the description.** **Recommended: `null`, `""` and whitespace clear it** (EE6). Alternative: only `""` clears; `null` is an error.
7. **Notify registered people when title or duration changes.** **Recommended: no** (EE14, out of scope). A new email kind needs migration `005` (the `kind` CHECK) and a spec for the text; no ER text contains the end time or the description.
8. **Pending emails with the old title.** **Recommended: leave them** (EE14, outbox rows are immutable, ER10). Alternative: update `subject` and `body` of `pending` ticket and promotion rows in the same transaction; this touches the sender's contract and is not asked for.
9. **Read `now` after the lock.** **Recommended: yes** (assumptions). It differs from the "once per request" wording of the M7 section; the difference is only where in the request the one `now` is taken.
10. **Name of the new test files and the roadmap steps.** **Recommended:** `update.test.ts` for this route; steps as proposed in the report of this spec.
