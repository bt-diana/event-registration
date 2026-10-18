# Spec: Email outbox list (the reminders table, organizer, API)

Feature spec made from `SPEC_TEMPLATE.md` (sections 1-5), in the shape of `arrivals.md`. It adds one read route. No new table and no migration: it reads `outbox` (`DATABASE.md` section 1), joined to `registrations`, `events` and `users`. It **depends on migration `004_outbox_status.sql`** (columns `status`, `send_attempts`, `send_error`; defined in `email-reminders.md` ER1, which this file does not change). Login, guards and the error format come from `auth.md` (A13-A15); ownership and 404 rules from `events.md` and `checkin.md` (C17, C18); the closest model is `arrivals.md`. Decision D60 (session `18-10-1950_email-reminders-api-spec`) asks for this route; D61 (same session) adds the one-attendee view as the filter `registration_id` (OB16-OB18). Ids are OB1, OB2, ...

Columns this spec relies on from `email-reminders.md` (as written when this file was made; if that spec changes them, change here first): `outbox.status` (`pending | sent | error_sending`), `outbox.send_attempts` (failed tries, integer), `outbox.send_error` (short reason or NULL, never body or address), `outbox.sent_at`. Everything else is in `DATABASE.md`.

## 1. Goals and expected behaviour

**Goal.** An organizer can see the emails of one of their own events: tickets, promotions, reminders and the others, with their delivery status, so they can tell what was queued, what was printed ("sent") and what ended in `error_sending`. The list can be limited to **one attendee** (`registration_id`, D61), to see that person's reminders and other emails. Read only.

**Path and method: `GET /events/:id/emails`.** Why this and not `/outbox`: "outbox" is a table name, the organizer cares about emails; the path hangs under the event, like `/events/:id/registrations` and `/events/:id/arrivals`, so the ownership check is the same one; it collides with no API route (the web pages are `/event/:id` and `/organizer/...`, a different prefix, and `/registrations` stays the list of people).

**Behaviours.** Each line is something a test can prove. "Yes" means the test is written and committed before the code.

| # | Behaviour | Test first? |
|---|---|---|
| OB1 | Guards on `GET /events/:id/emails`: no valid login answers 401 `not_logged_in`; an attendee cookie answers 403 `wrong_role` (`requireOrganizer`). The guard runs first, so even a malformed id or a bad query is 401 for an anonymous caller. No query runs. | yes |
| OB2 | An event that is unknown, not a uuid, or owned by another organizer answers 404 `{ "error": "not_found" }`, the same body for all three. A malformed id never reaches the database. The test checks that unknown and foreign answers are equal, that a foreign event with emails leaks nothing, and that a foreign event with a valid filter (`kind`, `status` or `registration_id`) is still 404. | yes |
| OB3 | For an event of the logged-in organizer the answer is 200 `{ "emails": [...], "truncated": false }`. Each item has exactly these keys: `id`, `registration_id`, `kind`, `status`, `send_attempts`, `send_error`, `to_email`, `subject`, `schedule_version`, `event_starts_at`, `created_at`, `sent_at`, `attendee_name`. The test checks the exact key list of an item and of the object. Dates are ISO strings (`event_starts_at`, `created_at`, `sent_at` or `null`); `send_attempts` and `schedule_version` are JSON numbers; `send_error` is a string or `null`. | yes |
| OB4 | **Never the body, never the ticket code.** No item has `body`, `ticket_code`, `user_id`, `password_hash`, `organizer_id`, `event_id` or another person's data. The test inserts a row whose body holds a ticket code and checks that neither the key nor the code string appears anywhere in the response text. | yes |
| OB5 | Default: all five kinds (`ticket`, `promotion`, `reminder`, `reschedule`, `event_cancelled`) and all three statuses. Rows of waiting and cancelled registrations are included (a `promotion` or `event_cancelled` row belongs to the registration of that event). Only rows of that event are returned: rows of another event of the same organizer and of other organizers never appear. | yes |
| OB6 | Order: newest first, `created_at` descending, then `id` ascending (a fixed tie-break, so the order is the same on every read). The test inserts rows with explicit `created_at` values, including two equal ones. | yes |
| OB7 | Filter `?kind=<kind>`: only that kind. A value outside the five kinds (also empty, repeated `kind=a&kind=b`, or another case such as `Reminder`) answers 400 `{ "error": "invalid_kind" }` and no query runs. The id is checked first (malformed id 404), the query values second (order: `kind`, then `status`, then `registration_id`; the first bad one decides the code); the ownership 404 is last (a bad `kind` on a foreign event is 400, which says nothing about the event). | yes |
| OB8 | Filter `?status=<status>`: only `pending`, `sent` or `error_sending` rows. Another value (empty, repeated, other case) answers 400 `{ "error": "invalid_status" }`. `kind` and `status` can be combined (both must match). A filter with no match is 200 `{ "emails": [], "truncated": false }`. Other query parameters are ignored. | yes |
| OB9 | Status values are shown as stored: a `pending` row has `sent_at: null` and `send_attempts` 0 or more (a retrying row shows its count, for example 2, and a `send_error`); a `sent` row has `sent_at` set; an `error_sending` row has `send_attempts: 3`, `send_error` set and `sent_at: null`. The test inserts all three by SQL and checks each item. | yes |
| OB10 | Cap: at most 200 rows, the newest ones. With 201 or more matching rows the answer has 200 items and `truncated: true`; with exactly 200 it has `truncated: false`. No paging, no `limit` parameter. The cap applies after the filters. | yes |
| OB11 | `to_email` is the stored copy in the outbox row (what the email was sent to when written, `DATABASE.md` decision 8), not the current `users.email`. `attendee_name` is the current `users.name` of the registration's person. Both go only to the owning organizer (they already see name and email in the registrations list, C15, C17). | |
| OB12 | An event with no emails answers 200 `{ "emails": [], "truncated": false }` (not 404). A cancelled or passed event of the organizer still answers 200 with its rows (as C17, AR9). | |
| OB13 | The route is read only: one SQL statement, no lock, no explicit transaction, no server-side cache. Test: after one read, the `outbox` rows (all columns) and the `registrations`, `events` and `users` rows are unchanged, and no row is written. It does not trigger the sender or the reminder worker and does not touch `GET /events/:id/registrations` or `/arrivals`. | |
| OB14 | `Cache-Control: no-store` on 200, 400 and 404 (set before the id check, as the list and arrivals routes). Two reads with a sender run between them (a row set to `sent` by SQL) show the new status. | |
| OB15 | Errors use `{ "error": "<code>" }` as in `auth.md`. Codes here: `not_logged_in`, `wrong_role`, `invalid_kind`, `invalid_status`, `invalid_registration_id`, `not_found`. | |
| OB16 | Filter `?registration_id=<uuid>`: only the emails of that one registration (one attendee) of this event. It combines with `kind` and `status` (all given filters must match), so `?registration_id=X&kind=reminder` is the reminders of one attendee. The items keep the same keys and order rules (OB3, OB6); the cap and `truncated` apply after the filters (OB10). A malformed value (not a uuid, empty, repeated `registration_id=a&registration_id=b`) answers 400 `{ "error": "invalid_registration_id" }` and no query runs; the check comes after `kind` and `status` (OB7), and before the ownership 404. A uuid is accepted in lower or upper case. | yes |
| OB17 | **No existence leak.** A well-formed `registration_id` that is not a registration of THIS event (unknown, of another event of the same organizer, or of another organizer) answers 200 `{ "emails": [], "truncated": false }`, byte for byte the same as a registration of this event that has no emails. It is not 404 and has no other key or header. The event 404 (OB2) stays as it is. The test compares the three bodies (unknown, other event, other organizer's event) with an attendee with no emails, and checks that a foreign registration's emails never appear. | yes |
| OB18 | The registration can be in any status (`registered`, `waiting`, `cancelled`, `checked_in`): the emails of a `cancelled` registration are still returned (for example its `ticket` and the `promotion` or `event_cancelled` rows). Every item has that `registration_id` and the `attendee_name` of that person. | |

**Out of scope.** The organizer screen for this table (a later UI spec), resend or re-queue of an `error_sending` row (same as `email-reminders.md`), paging or a `limit` parameter, viewing the body, a count per status, an attendee version, all-events view across the organizer's events, search by address, export, live updates, and changing any email row.

**Assumptions.** Change any of these first in this file.
- The organizer id is from the cookie, never from the request; a foreign or unknown event looks the same (`DATABASE.md` 3.8).
- Why no `body`: the body holds the ticket code (ticket and reminder rows), which is the secret that admits a person at the door (`checkin.md`); an organizer with the code could check in anyone. The subject already says what the email is (`Reminder: <title> starts soon`). Why `to_email` and `attendee_name` are fine: only the owner sees them and they already see both in the registrations list.
- Why all kinds by default: the table is "the emails of my event", and the organizer needs the ticket and promotion rows to understand a missing email. The `kind` filter narrows to `reminder`.
- `send_error` is safe to show: it is a short reason of the last failed try, never the body or the address (`email-reminders.md` ER17).
- Why a `truncated` flag and no paging: a bare cap would hide rows silently. One boolean is enough for the screen to say "showing the newest 200". The shape is the user's, plus this one key.
- Rows made by tests (all kinds, all statuses, errors, foreign events, equal `created_at`, 201 rows) are inserted by SQL with the helpers in `api/test/db/helpers.ts`.

## 2. UI decisions

No screen in this spec (API only). What the API gives a later screen: 200 with `emails` and `truncated` (also for one attendee with `registration_id`; an empty list is the same for "no emails" and "not this event's registration"), 400 `invalid_kind` / `invalid_status` / `invalid_registration_id` (a bug in the screen, not shown to the person), 404 (event not found), 401 (organizer login), 403 (attendees cannot see it). The screen must not say that an email "arrived": `sent` only means the stub printed the line (`email-reminders.md`).

## 3. Architecture decisions

- **Apps:** `api/` only. Express 5, TypeScript, Vitest. No new table, no migration, no library, no env variable.
- **Router: a new `api/src/email/routes.ts`** (`emailRouter(pool)`) with its logic in `api/src/email/service.ts` (`listEmails`), mounted in `api/src/app.ts` after `checkinRouter(pool)`. Why not `api/src/checkin/`: this is the email domain, `api/src/email/` is already the folder of the sender, the reminder worker and the jobs (`email-reminders.md`), and `checkin/` stays about arrivals. The cost is one `app.use` line and a copy of the small uuid regex and `fail` helper (not worth a shared module for two lines). Order of work: after the migration `004` step and the sender step (roadmap step 30), because the tests need `status`, `send_attempts` and `send_error` in the schema and the statuses mean something only with the sender.
- **Guard and order of checks:** `requireOrganizer`; `Cache-Control: no-store`; uuid check on the path (404); `kind`, `status`, then `registration_id` check (400); query (no row = 404).
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
         AND ($5::uuid IS NULL OR o.registration_id = $5)
       ORDER BY o.created_at DESC, o.id
       LIMIT 201
    ) x ON true
   WHERE e.id = $1 AND e.organizer_id = $2
   ORDER BY x.created_at DESC NULLS LAST, x.id;  -- no row = 404; one row with x.id NULL = empty list
  ```
  `$3`, `$4` and `$5` are `null` when the parameter is absent. **The `registration_id` filter sits inside the lateral subquery, not in the outer `WHERE`** (OB16, OB17): the outer `WHERE e.id = $1 AND e.organizer_id = $2` still returns the event row, so an owned event gives one row (with `x.id` NULL when nothing matches, a 200 empty list) and only an unowned event gives no row (404). A registration of another event never matches `r.event_id = e.id`, so it gives the same empty list as an attendee with no emails; there is no separate lookup of the registration, so no different answer or timing path. (A filter in the outer `WHERE` would turn "owned, no match" into 404; the test of OB17 catches it.) The service drops the all-null row, and if 201 rows came back it returns the first 200 and `truncated: true`. The body column is not selected, so it cannot leak by a mapping mistake. The join uses the unique key `(registration_id, kind, schedule_version)` (leading column `registration_id`) and `registrations.event_id`; no new index (small tables; add one when a measurement says so).
- **Shape:** items are mapped one by one with named keys (not a spread of the row), dates with `toISOString()`, so a future column can never leak (OB3, OB4).
- **Validation:** `kind` must be a single string and one of the five kinds; `status` a single string and one of three (a constant list in `service.ts`; the same strings as the CHECKs). An array value (`?kind=a&kind=b`) is invalid. `registration_id` must be a single string that matches the uuid regex (case-insensitive, the same one as the path id); it is passed to the query as a parameter, never joined into the SQL.
- **API:**

| Route | Guard | Query | Success | Errors |
|---|---|---|---|---|
| `GET /events/:id/emails` | `requireOrganizer` | `kind` (optional), `status` (optional), `registration_id` (optional, uuid) | 200 `{ emails: [...], truncated }` | 401 `not_logged_in`, 403 `wrong_role`, 400 `invalid_kind` / `invalid_status` / `invalid_registration_id`, 404 `not_found` (unknown, malformed or foreign event) |

## 4. Files to touch

| File | What to do | Behaviours |
|---|---|---|
| `api/test/email/outbox.test.ts` | **Tests first (red):** OB1 (guards; malformed id and bad query from anonymous are 401), OB2 (unknown, malformed, foreign: equal 404; foreign with a valid filter), OB3 and OB4 (exact key list, no body or ticket code in the response text), OB5 and OB6 (mixed rows by SQL, ordering with equal `created_at`), OB7 and OB8 (filters, 400 codes, combination, empty result), OB9 (all three statuses, `error_sending` with `send_error`), OB10 (200 and 201 rows), OB16 (one attendee only; malformed id 400 `invalid_registration_id` and its check order; combined with `kind=reminder`), OB17 (unknown, other-event and other-organizer registration ids give the same 200 empty body as an attendee with no emails, not 404; foreign event is still 404); then OB11 to OB15 and OB18 (a cancelled registration's emails are returned; the read-only check compares full rows before and after) | OB1-OB18 |
| `api/src/email/service.ts` | `listEmails(pool, organizerId, eventId, { kind, status, registrationId })` with the SQL above; returns `{ kind: "not_found" } \| { kind: "ok", rows, truncated }` (if the file exists from the sender step, add to it only if it is not the sender; otherwise create it) | OB2-OB13, OB16-OB18 |
| `api/src/email/routes.ts` | `emailRouter(pool)`: guard, header, uuid check, query check (`kind`, `status`, `registration_id`), mapping | OB1-OB4, OB7, OB8, OB14-OB16 |
| `api/src/app.ts` | `app.use(emailRouter(pool))` after `checkinRouter(pool)` | all |
| `api/openapi.yaml` | Add the route (tag `email`, or reuse `checkin` if tags are fixed), the `EmailItem` and `EmailList` schemas, the `kind` and `status` query parameters (enums), the `registration_id` query parameter (`type: string, format: uuid`, optional; description: "empty list if it is not a registration of this event"), the `invalid_registration_id` 400 code, and the 400/401/403/404 answers (reuse `#/components/responses/NotLoggedIn`, `WrongRole`, `NotFound`; `Error` schema for the 400). Raise the minor version: **`0.7.0` to `0.8.0`** (version read now; if another spec has raised it before this step, raise whatever is there by one minor) | all |
| `README.md` | Add the route to the list; update "Project status" | |
| `ROADMAP.md` | Add the step for this route (tests, then code) after the sender step | |

Not touched: migrations, `web/`, the sender, the worker, `api/src/checkin/`, other specs. Tests use the existing style (`createApp().listen(0)` and `fetch`, helpers in `api/test/auth/helpers.ts` and `api/test/db/helpers.ts`; no new library). A test deletes the rows it made (outbox first, then registrations and events, then accounts).

## 5. Done means

- Tests, typecheck and linter pass in `api/`.
- Every behaviour OB1-OB18 has a test, or a note in the README that says it is not covered.
- The tests for OB1-OB10, OB16 and OB17 are written and committed before the route code and shown failing for the right reason (route missing, then wrong rows or order).
- `api/openapi.yaml` (version 0.8.0) and the README list the route; "Project status" says the route exists and that no screen uses it yet.
- The migration `004` and the sender step are already done (the build order above).

## 6. Open questions (each with a recommended answer)

1. **`truncated` key.** The asked shape is `{ emails: [...] }`; this spec adds `truncated`. **Recommended: keep it** (one boolean, no paging). If you want exactly `{ emails }`, drop `truncated` from OB3, OB10 and OB12; the cap stays.
2. **Default kinds.** **Recommended: all five** (OB5), with `?kind=reminder` for the reminders table the request names. Alternative: default to `reminder` only.
3. **Bad `status` as its own code.** **Recommended: `invalid_status`** next to `invalid_kind`, so each 400 names its parameter.
4. **Cap size.** **Recommended: 200** (an event is small; the cap is a safety net). Change the number in OB10 and the SQL `LIMIT` (cap + 1) together.
5. **Folder.** **Recommended: `api/src/email/`** (new `routes.ts`, one line in `app.ts`) rather than `api/src/checkin/`.
6. **One attendee: filter or path route.** D61 asks for the emails of one attendee. Options: the optional query filter `registration_id` on `GET /events/:id/emails` (this spec, OB16-OB18) or a second route `GET /events/:id/registrations/:registrationId/emails`. **Recommended: the filter.** It is one route, one SQL statement and one set of tests; it combines with `kind` and `status` for free; and a registration that is not of this event is an empty list (OB17), so the route never says whether the id exists elsewhere. A path route would need its own "registration not found" 404, which either leaks existence or needs the same empty answer anyway, and it would double the guard, ordering and shape tests. Cost of the filter: a wrong id gives an empty list, not an error, so the screen cannot tell "no emails" from "wrong attendee" (it only passes ids it got from the registrations list, so this is acceptable).
