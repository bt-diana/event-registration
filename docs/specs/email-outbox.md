# Spec: Email outbox list (the reminders table, organizer, API)

Feature spec made from `SPEC_TEMPLATE.md` (sections 1-5), in the shape of `arrivals.md`. It adds one read route. No new table and no migration: it reads `outbox` (`DATABASE.md` section 1), joined to `registrations`, `events` and `users`. It **depends on migration `004_outbox_status.sql`** (columns `status`, `send_attempts`, `send_error`; defined in `email-reminders.md` ER1, which this file does not change). Login, guards and the error format come from `auth.md` (A13-A15); ownership and 404 rules from `events.md` and `checkin.md` (C17, C18); the closest model is `arrivals.md`. Decision D60 (session `18-10-1950_email-reminders-api-spec`) asks for this route. Ids are OB1, OB2, ...

Columns this spec relies on from `email-reminders.md` (as written when this file was made; if that spec changes them, change here first): `outbox.status` (`pending | sent | error_sending`), `outbox.send_attempts` (failed tries, integer), `outbox.send_error` (short reason or NULL, never body or address), `outbox.sent_at`. Everything else is in `DATABASE.md`.

## 1. Goals and expected behaviour

**Goal.** An organizer can see the emails of one of their own events: tickets, promotions, reminders and the others, with their delivery status, so they can tell what was queued, what was printed ("sent") and what ended in `error_sending`. Read only.

**Path and method: `GET /events/:id/emails`.** Why this and not `/outbox`: "outbox" is a table name, the organizer cares about emails; the path hangs under the event, like `/events/:id/registrations` and `/events/:id/arrivals`, so the ownership check is the same one; it collides with no API route (the web pages are `/event/:id` and `/organizer/...`, a different prefix, and `/registrations` stays the list of people).

**Behaviours.** Each line is something a test can prove. "Yes" means the test is written and committed before the code.

| # | Behaviour | Test first? |
|---|---|---|
| OB1 | Guards on `GET /events/:id/emails`: no valid login answers 401 `not_logged_in`; an attendee cookie answers 403 `wrong_role` (`requireOrganizer`). The guard runs first, so even a malformed id or a bad query is 401 for an anonymous caller. No query runs. | yes |
| OB2 | An event that is unknown, not a uuid, or owned by another organizer answers 404 `{ "error": "not_found" }`, the same body for all three. A malformed id never reaches the database. The test checks that unknown and foreign answers are equal, that a foreign event with emails leaks nothing, and that a foreign event with a valid filter is still 404. | yes |
| OB3 | For an event of the logged-in organizer the answer is 200 `{ "emails": [...], "truncated": false }`. Each item has exactly these keys: `id`, `registration_id`, `kind`, `status`, `send_attempts`, `send_error`, `to_email`, `subject`, `schedule_version`, `event_starts_at`, `created_at`, `sent_at`, `attendee_name`. The test checks the exact key list of an item and of the object. Dates are ISO strings (`event_starts_at`, `created_at`, `sent_at` or `null`); `send_attempts` and `schedule_version` are JSON numbers; `send_error` is a string or `null`. | yes |
| OB4 | **Never the body, never the ticket code.** No item has `body`, `ticket_code`, `user_id`, `password_hash`, `organizer_id`, `event_id` or another person's data. The test inserts a row whose body holds a ticket code and checks that neither the key nor the code string appears anywhere in the response text. | yes |
| OB5 | Default: all five kinds (`ticket`, `promotion`, `reminder`, `reschedule`, `event_cancelled`) and all three statuses. Rows of waiting and cancelled registrations are included (a `promotion` or `event_cancelled` row belongs to the registration of that event). Only rows of that event are returned: rows of another event of the same organizer and of other organizers never appear. | yes |
| OB6 | Order: newest first, `created_at` descending, then `id` ascending (a fixed tie-break, so the order is the same on every read). The test inserts rows with explicit `created_at` values, including two equal ones. | yes |
| OB7 | Filter `?kind=<kind>`: only that kind. A value outside the five kinds (also empty, repeated `kind=a&kind=b`, or another case such as `Reminder`) answers 400 `{ "error": "invalid_kind" }` and no query runs. The id is checked first (malformed id 404), the query value second; the ownership 404 is last (a bad `kind` on a foreign event is 400, which says nothing about the event). | yes |
| OB8 | Filter `?status=<status>`: only `pending`, `sent` or `error_sending` rows. Another value (empty, repeated, other case) answers 400 `{ "error": "invalid_status" }`. `kind` and `status` can be combined (both must match). A filter with no match is 200 `{ "emails": [], "truncated": false }`. Other query parameters are ignored. | yes |
| OB9 | Status values are shown as stored: a `pending` row has `sent_at: null` and `send_attempts` 0 or more (a retrying row shows its count, for example 2, and a `send_error`); a `sent` row has `sent_at` set; an `error_sending` row has `send_attempts: 3`, `send_error` set and `sent_at: null`. The test inserts all three by SQL and checks each item. | yes |
| OB10 | Cap: at most 200 rows, the newest ones. With 201 or more matching rows the answer has 200 items and `truncated: true`; with exactly 200 it has `truncated: false`. No paging, no `limit` parameter. The cap applies after the filters. | yes |
| OB11 | `to_email` is the stored copy in the outbox row (what the email was sent to when written, `DATABASE.md` decision 8), not the current `users.email`. `attendee_name` is the current `users.name` of the registration's person. Both go only to the owning organizer (they already see name and email in the registrations list, C15, C17). | |
| OB12 | An event with no emails answers 200 `{ "emails": [], "truncated": false }` (not 404). A cancelled or passed event of the organizer still answers 200 with its rows (as C17, AR9). | |
| OB13 | The route is read only: one SQL statement, no lock, no explicit transaction, no server-side cache. Test: after one read, the `outbox` rows (all columns) and the `registrations`, `events` and `users` rows are unchanged, and no row is written. It does not trigger the sender or the reminder worker and does not touch `GET /events/:id/registrations` or `/arrivals`. | |
| OB14 | `Cache-Control: no-store` on 200, 400 and 404 (set before the id check, as the list and arrivals routes). Two reads with a sender run between them (a row set to `sent` by SQL) show the new status. | |
| OB15 | Errors use `{ "error": "<code>" }` as in `auth.md`. Codes here: `not_logged_in`, `wrong_role`, `invalid_kind`, `invalid_status`, `not_found`. | |

**Out of scope.** The organizer screen for this table (a later UI spec), resend or re-queue of an `error_sending` row (same as `email-reminders.md`), paging or a `limit` parameter, viewing the body, a count per status, an attendee version, all-events view across the organizer's events, search by address, export, live updates, and changing any email row.

**Assumptions.** Change any of these first in this file.
- The organizer id is from the cookie, never from the request; a foreign or unknown event looks the same (`DATABASE.md` 3.8).
- Why no `body`: the body holds the ticket code (ticket and reminder rows), which is the secret that admits a person at the door (`checkin.md`); an organizer with the code could check in anyone. The subject already says what the email is (`Reminder: <title> starts soon`). Why `to_email` and `attendee_name` are fine: only the owner sees them and they already see both in the registrations list.
- Why all kinds by default: the table is "the emails of my event", and the organizer needs the ticket and promotion rows to understand a missing email. The `kind` filter narrows to `reminder`.
- `send_error` is safe to show: it is a short reason of the last failed try, never the body or the address (`email-reminders.md` ER17).
- Why a `truncated` flag and no paging: a bare cap would hide rows silently. One boolean is enough for the screen to say "showing the newest 200". The shape is the user's, plus this one key.
- Rows made by tests (all kinds, all statuses, errors, foreign events, equal `created_at`, 201 rows) are inserted by SQL with the helpers in `api/test/db/helpers.ts`.

## 2. UI decisions

No screen in this spec (API only). What the API gives a later screen: 200 with `emails` and `truncated`, 400 `invalid_kind` / `invalid_status` (a bug in the screen, not shown to the person), 404 (event not found), 401 (organizer login), 403 (attendees cannot see it). The screen must not say that an email "arrived": `sent` only means the stub printed the line (`email-reminders.md`).

## 3. Architecture decisions

- **Apps:** `api/` only. Express 5, TypeScript, Vitest. No new table, no migration, no library, no env variable.
- **Router: a new `api/src/email/routes.ts`** (`emailRouter(pool)`) with its logic in `api/src/email/service.ts` (`listEmails`), mounted in `api/src/app.ts` after `checkinRouter(pool)`. Why not `api/src/checkin/`: this is the email domain, `api/src/email/` is already the folder of the sender, the reminder worker and the jobs (`email-reminders.md`), and `checkin/` stays about arrivals. The cost is one `app.use` line and a copy of the small uuid regex and `fail` helper (not worth a shared module for two lines). Order of work: after the migration `004` step and the sender step (roadmap step 30), because the tests need `status`, `send_attempts` and `send_error` in the schema and the statuses mean something only with the sender.
- **Guard and order of checks:** `requireOrganizer`; `Cache-Control: no-store`; uuid check on the path (404); `kind` and `status` check (400); query (no row = 404).
- **One query, no lock, no transaction (OB2, OB5, OB10, OB12, OB13).** The event row is the ownership check; the lateral join keeps one row when the event is owned but has no emails, so "no row" is only the 404:
  ```sql
  SELECT x.*
    FROM events e
    LEFT JOIN LATERAL (
      SELECT o.id, o.registration_id, o.kind, o.status, o.send_attempts, o.send_error,
             o.to_email, o.subject, o.schedule_version, o.event_starts_at,
             o.created_at, o.sent_at, u.name AS attendee_name
        FROM outbox o
        JOIN registrations r ON r.id = o.registration_id
        JOIN users u ON u.id = r.user_id
       WHERE r.event_id = e.id
         AND ($3::text IS NULL OR o.kind = $3)
         AND ($4::text IS NULL OR o.status = $4)
       ORDER BY o.created_at DESC, o.id
       LIMIT 201
    ) x ON true
   WHERE e.id = $1 AND e.organizer_id = $2
   ORDER BY x.created_at DESC NULLS LAST, x.id;  -- no row = 404; one row with x.id NULL = empty list
  ```
  `$3` and `$4` are `null` when the parameter is absent. The service drops the all-null row, and if 201 rows came back it returns the first 200 and `truncated: true`. The body column is not selected, so it cannot leak by a mapping mistake. The join uses the unique key `(registration_id, kind, schedule_version)` (leading column `registration_id`) and `registrations.event_id`; no new index (small tables; add one when a measurement says so).
- **Shape:** items are mapped one by one with named keys (not a spread of the row), dates with `toISOString()`, so a future column can never leak (OB3, OB4).
- **Validation:** `kind` must be a single string and one of the five kinds; `status` a single string and one of three (a constant list in `service.ts`; the same strings as the CHECKs). An array value (`?kind=a&kind=b`) is invalid.
- **API:**

| Route | Guard | Query | Success | Errors |
|---|---|---|---|---|
| `GET /events/:id/emails` | `requireOrganizer` | `kind` (optional), `status` (optional) | 200 `{ emails: [...], truncated }` | 401 `not_logged_in`, 403 `wrong_role`, 400 `invalid_kind` / `invalid_status`, 404 `not_found` (unknown, malformed or foreign event) |

## 4. Files to touch

| File | What to do | Behaviours |
|---|---|---|
| `api/test/email/outbox.test.ts` | **Tests first (red):** OB1 (guards; malformed id and bad query from anonymous are 401), OB2 (unknown, malformed, foreign: equal 404; foreign with a valid filter), OB3 and OB4 (exact key list, no body or ticket code in the response text), OB5 and OB6 (mixed rows by SQL, ordering with equal `created_at`), OB7 and OB8 (filters, 400 codes, combination, empty result), OB9 (all three statuses, `error_sending` with `send_error`), OB10 (200 and 201 rows); then OB11 to OB15 (the read-only check compares full rows before and after) | OB1-OB15 |
| `api/src/email/service.ts` | `listEmails(pool, organizerId, eventId, { kind, status })` with the SQL above; returns `{ kind: "not_found" } \| { kind: "ok", rows, truncated }` (if the file exists from the sender step, add to it only if it is not the sender; otherwise create it) | OB2-OB13 |
| `api/src/email/routes.ts` | `emailRouter(pool)`: guard, header, uuid check, query check, mapping | OB1-OB4, OB7, OB8, OB14, OB15 |
| `api/src/app.ts` | `app.use(emailRouter(pool))` after `checkinRouter(pool)` | all |
| `api/openapi.yaml` | Add the route (tag `email`, or reuse `checkin` if tags are fixed), the `EmailItem` and `EmailList` schemas, the `kind` and `status` query parameters (enums), and the 400/401/403/404 answers (reuse `#/components/responses/NotLoggedIn`, `WrongRole`, `NotFound`; `Error` schema for the 400). Raise the minor version: **`0.7.0` to `0.8.0`** (version read now; if another spec has raised it before this step, raise whatever is there by one minor) | all |
| `README.md` | Add the route to the list; update "Project status" | |
| `ROADMAP.md` | Add the step for this route (tests, then code) after the sender step | |

Not touched: migrations, `web/`, the sender, the worker, `api/src/checkin/`, other specs. Tests use the existing style (`createApp().listen(0)` and `fetch`, helpers in `api/test/auth/helpers.ts` and `api/test/db/helpers.ts`; no new library). A test deletes the rows it made (outbox first, then registrations and events, then accounts).

## 5. Done means

- Tests, typecheck and linter pass in `api/`.
- Every behaviour OB1-OB15 has a test, or a note in the README that says it is not covered.
- The tests for OB1-OB10 are written and committed before the route code and shown failing for the right reason (route missing, then wrong rows or order).
- `api/openapi.yaml` (version 0.8.0) and the README list the route; "Project status" says the route exists and that no screen uses it yet.
- The migration `004` and the sender step are already done (the build order above).

## 6. Open questions (each with a recommended answer)

1. **`truncated` key.** The asked shape is `{ emails: [...] }`; this spec adds `truncated`. **Recommended: keep it** (one boolean, no paging). If you want exactly `{ emails }`, drop `truncated` from OB3, OB10 and OB12; the cap stays.
2. **Default kinds.** **Recommended: all five** (OB5), with `?kind=reminder` for the reminders table the request names. Alternative: default to `reminder` only.
3. **Bad `status` as its own code.** **Recommended: `invalid_status`** next to `invalid_kind`, so each 400 names its parameter.
4. **Cap size.** **Recommended: 200** (an event is small; the cap is a safety net). Change the number in OB10 and the SQL `LIMIT` (cap + 1) together.
5. **Folder.** **Recommended: `api/src/email/`** (new `routes.ts`, one line in `app.ts`) rather than `api/src/checkin/`.
