# Spec: My registrations list (attendee, API)

Feature spec made from `SPEC_TEMPLATE.md` (sections 1-5). It adds one read route. No new table and no migration: it reads `registrations` and `events` (`DATABASE.md` section 1), which this file does not change. Login, guards and the error format come from `auth.md` (A13-A15); the registration shape and the guards of the single-event read from `registration.md` (R17, R19-R22); the derived event status from `events.md` (E19). It unblocks `registration-web.md` W-R18 and W-R19 (that file's open question 1, option A, chosen by the user). Ids are MR1, MR2, ...

## 1. Goals and expected behaviour

**Goal.** A logged-in attendee asks for all their own registrations in one call. Each row already carries the event title, start time and event status, so the web screen needs no extra request per row.

**Behaviours.** Each line is something a test can prove. "Yes" means the test is written and committed before the code (red).

| # | Behaviour | Test first? |
|---|---|---|
| MR1 | Guards on `GET /me/registrations`: no valid login answers 401 `not_logged_in`; an organizer cookie answers 403 `wrong_role` (`requireUser`, same as `registration.md` R20). No query runs and nothing is written. | yes |
| MR2 | With an attendee cookie the answer is 200 `{ "registrations": [ ... ] }` with exactly one key at the top. An attendee with no registrations gets 200 and `{ "registrations": [] }`, not 404. | |
| MR3 | Every item has exactly these keys: the registration shape of `registration.md` R21 (`id`, `event_id`, `status`, `ticket_code`, `waitlist_position`, `checked_in_at`, `created_at`) plus `event_title`, `event_starts_at`, `event_status`. It never contains `user_id`, `queue_no`, `cancelled_at`, `organizer_id`, the event's capacity or description, any email or name, `password_hash`, or another person's data. The test checks the exact key list. | |
| MR4 | Own rows only: the list holds every row whose `user_id` is the cookie's user and nothing else. Attendee A with two registrations and attendee B with one: A sees exactly A's two, B sees exactly B's one. The user id comes from the cookie, never from a query string or body (a `?user_id=` or body is ignored). | yes |
| MR5 | Any registration status is listed: `registered`, `waitlisted` and `cancelled` rows (the last made by SQL in the test; the cancel route is M4). A cancelled row keeps its old `ticket_code` and has `waitlist_position` `null`, as in `registration.md` R22. If the attendee cancelled and registered again for the same event, both rows are listed (history, two items with the same `event_id`, two different `ticket_code`). | |
| MR6 | `waitlist_position` is the same number as `registration.md` R7/R17 for each waiting item (1-based place by `queue_no`), and `null` for `registered` and `cancelled`. Waiting rows before it set to `cancelled` by SQL give a smaller number on the next read. | yes |
| MR7 | `event_status` is `active`, `cancelled` or `passed`, derived with the shared rule of `events.md` E19 (`deriveStatus` in `api/src/events/status.ts`): stored `cancelled` wins, else `now >= starts_at + duration` is `passed`, else `active`. The route reads `now` once per request. A running event is `active`. The status of the event is shown for every row, whatever the registration status. | yes |
| MR8 | `event_title` is the stored title; `event_starts_at` is an ISO string in UTC, the same instant as `starts_at` of the event (`events.md`). They follow the event: after the event title or start is changed by SQL in the test, the next read shows the new values (no copy, no cache). | |
| MR9 | Order is deterministic: `created_at` of the registration, newest first, then `id` descending as tie-break (`id` is unique, so the order is total). Two rows with the same `created_at` (set by SQL in the test) come out in `id` descending order, on every read. The order does not depend on the event's start time or status, nor on the registration status. | yes |
| MR10 | One SQL statement for the whole list: `registrations` joined to `events`, with `waitlist_position` as a column of that statement, no query per row (no N+1), no lock, no explicit transaction. A test with an attendee who has 5 registrations (mixed statuses) counts the queries through the pool (or a spy on `pool.query`) and sees exactly 1 query for the route after the guard. | yes |
| MR11 | The response has `Cache-Control: no-store` on 200 (same as the organizer list, `checkin.md` C18). Two reads with a registration made between them show the new item. No server-side cache. | |
| MR12 | The route changes nothing: no row written, no outbox row, no change of `GET /events/:id/registrations/me` or `POST /events/:id/registrations` (shapes and behaviour stay as in `registration.md`). | |
| MR13 | The route does not look at any event as a target: a cancelled or passed event does not remove its registrations from the list (they show `event_status` `cancelled` or `passed`). | |
| MR14 | Errors use `{ "error": "<code>" }` as in `auth.md`. Codes here: `not_logged_in`, `wrong_role`. No 400 and no 404: there is no input. | |
| MR15 | The path `/me/registrations` is not shadowed by another route: it is reached with a plain `GET`, and `/auth/me`, `/events/:id/registrations/me` and the 404 handler still answer as before. | |

**Not in this spec.** Cancelling a registration (M4), the web screen and its tests (`registration-web.md` W-R18, W-R19), live updates, polling or server-sent events (D50, D51), a filter or sort by query string, paging (see assumptions), an organizer view of other people's registrations (`checkin.md` C15), the event description, venue, capacity or seats left (the web reads `GET /public/events/:id` for those), a "my tickets" count.

**Assumptions.** Change any of these first in this file.
- **No pagination.** An attendee has few registrations (one active row per event; history rows only after cancel and re-register). The one statement reads only the caller's rows, so the answer stays small. A cap or `limit` would hide tickets without a way to reach them (no paging controls in the web spec). If it ever grows, add paging in a later spec.
- **Newest registration first** (`created_at DESC, id DESC`) was chosen because the list answers "what did I just register for"; the web does not sort (W-R18 shows the API order). Sorting by event start would need a rule for passed and cancelled events and is not asked for. `id` is a uuidv7, unique, so it is a total tie-break.
- **History is listed.** The same event can appear twice (a cancelled row and a new active one, `registration.md` R12). The web links both to `/registrations/me?event={event_id}`, which shows the active one (R17). Hiding old cancelled rows when an active one exists is a later change if the user wants it (open question 2).
- `event_status` is derived on the server for the instant of the request, not stored. `event_cancelled` rows are not removed by this route.
- The attendee is the signed-in account. An organizer has no registrations and gets 403, as for the single read (R20).
- No new index: `registrations` has no index on `user_id`, so the statement scans `registrations` filtered by `user_id`. This is fine at the size of this project; an index `(user_id, created_at DESC, id DESC)` is a later migration if the table grows (open question 3).
- Rows made by tests (cancelled registrations, past and cancelled events, many registrations, equal `created_at`) are inserted by SQL with the helpers in `api/test/db/helpers.ts`.

## 2. UI decisions

No screen in this spec (API only). What the API gives the web (`registration-web.md` W-R18): 200 with items (one row per item: `event_title` as a link, `event_starts_at`, status text from `status` and `waitlist_position`, `ticket_code`; `event_status` can add an "Event cancelled" or "Ended" note), 200 with `[]` (the empty text "You have no registrations yet."), 401 (go to the attendee login with `next`), 403 (the organizer is redirected before the call, W-R15). The web screen states (loading, error with Retry) stay in `registration-web.md`.

## 3. Architecture decisions

- **Apps:** `api/` only, plus one proxy line in `web/vite.config.ts`. Express 5, TypeScript, Vitest. No new table, no migration, no library, no env variable.
- **Router:** the route is added in the existing `registrationsRouter(pool)` (`api/src/registrations/routes.ts`) with `requireUser`, next to the two single-event routes. `/me/registrations` shares no path with any other route (`/auth/me` and `/events/:id/registrations/me` are different paths). It is declared before the app's 404 handler, which is already the case for that router.
- **Path name.** `/me/registrations` and not `/registrations/me`: the web screen of the attendee is `/registrations/me` and a web path must not equal an API path on one origin (`registration-web.md` section 1). The new `/me` prefix needs `"/me": "http://localhost:3000"` in the `proxy` object of `web/vite.config.ts` (used by `server` and `preview`). The web paths `/registrations` and `/registrations/me` stay free; no web route may start with `/me`.
- **One query, no lock (MR4-MR10).**
  ```sql
  SELECT r.id, r.event_id, r.status, r.ticket_code, r.checked_in_at, r.created_at,
         e.title AS event_title, e.starts_at AS event_starts_at,
         e.status AS event_stored_status, e.duration_minutes,
         CASE WHEN r.status = 'waitlisted' THEN (
           SELECT count(*)::int FROM registrations w
            WHERE w.event_id = r.event_id AND w.status = 'waitlisted' AND w.queue_no <= r.queue_no
         ) END AS waitlist_position
    FROM registrations r
    JOIN events e ON e.id = r.event_id
   WHERE r.user_id = $1
   ORDER BY r.created_at DESC, r.id DESC;
  ```
  `$1` is `req.user!.id` from the cookie. The `waitlist_position` expression is the same as `REGISTRATION_COLUMNS` in `api/src/registrations/service.ts`; build the statement from that constant plus the event columns so the two stay equal (the constant uses the alias `r`, as here). The inner count is a correlated subquery in the same statement (served by `registrations_waitlist`), not a query per row. `::int` makes `pg` return a number. The list is one snapshot (one statement, READ COMMITTED).
- **Event status in the app.** After the query, map each row with `registrationShape(row)` and add `event_title`, `event_starts_at` (ISO UTC) and `event_status: deriveStatus(stored, starts_at, duration_minutes, now)` from `api/src/events/status.ts`, with a single `now = new Date()` for the request. No second implementation of the passed rule.
- **Header:** `Cache-Control: no-store` is set for the answer (MR11), after the guard.
- **Shape** (all JSON): `{ registrations: [ { id, event_id, status, ticket_code, waitlist_position, checked_in_at, created_at, event_title, event_starts_at, event_status } ] }`. `status` is `registered`, `waitlisted` or `cancelled`; `event_status` is `active`, `cancelled` or `passed`; `checked_in_at` is `null` or an ISO string; the dates are ISO strings in UTC.
- **API:**

| Route | Guard | Body | Success | Errors |
|---|---|---|---|---|
| `GET /me/registrations` | `requireUser` | none | 200 `{ registrations }` (possibly `[]`) | 401 `not_logged_in`, 403 `wrong_role` |

## 4. Files to touch

| File | What to do | Behaviours |
|---|---|---|
| `api/test/registrations/myList.test.ts` | **Tests first (red):** MR1 (guards, nothing written), MR4 (two attendees, exact own rows, `?user_id=` and body ignored), MR6 (positions, move after SQL cancel), MR7 (active, running, cancelled, passed, cancelled wins over passed), MR9 (order incl. equal `created_at` set by SQL), MR10 (one query counted); then MR2, MR3 (exact key list, no leaked keys), MR5, MR8, MR11, MR12, MR13, MR14, MR15. Red for the right reason: route missing (404 from the app) | MR1-MR15 |
| `api/src/registrations/service.ts` | Add `listMyRegistrations(pool, userId, now)` with the SQL above, built from `REGISTRATION_COLUMNS`; returns rows with the event columns | MR4-MR10, MR13 |
| `api/src/registrations/routes.ts` | Add `GET /me/registrations`: `requireUser`, header, mapping (`registrationShape` plus the three event keys, `deriveStatus`) | MR1-MR3, MR7, MR11, MR14 |
| `web/vite.config.ts` | Add `"/me": "http://localhost:3000"` to the `proxy` object (one line; shared by `server` and `preview`) | MR15 (dev only) |
| `api/openapi.yaml` | Add `GET /me/registrations` (tag `registrations`), the `MyRegistration` schema (the `Registration` keys written out plus three keys, like `OrganizerRegistration`; `Registration` has `additionalProperties: false`, so allOf would reject real items), 200 with `Cache-Control: no-store`, 401, 403; raise the minor version | all |
| `README.md` | Add the route to the list; update "Project status" (list route exists; the web screen waits for `registration-web.md` W-R18) | |
| `ROADMAP.md` | Add the step for this route (tests, then code) before the web step for W-R18, W-R19 | |
| `docs/specs/registration-web.md` | Follow-up (not made by this spec): drop "blocked-until-API" on W-R18 and W-R19, use `GET /me/registrations`, close open question 1, add the `/me` proxy line to its files | W-R18, W-R19 |

Tests use the existing style (`createApp().listen(0)` and `fetch`, helpers in `api/test/auth/helpers.ts` and `api/test/db/helpers.ts`; no new library). The query count in MR10 uses a wrapper around the pool passed to `createApp({ pool })`. A test deletes the rows it made (outbox, registrations and events first, then accounts).

## 5. Done means

- Tests, typecheck and linter pass in `api/` (and in `web/` after the proxy line).
- Every behaviour MR1-MR15 has a test, or a note in the README that says it is not covered.
- The tests for MR1, MR4, MR6, MR7, MR9 and MR10 are written and committed before the route code, and shown failing for the right reason (route missing), then green.
- `api/openapi.yaml` and the README list the route; "Project status" says the route exists and whether the web already uses it.

## 6. Open questions (each with a recommended answer)

1. **Order.** Newest registration first (`created_at DESC, id DESC`, MR9), or next upcoming event first? **Recommended: newest registration first.** One simple rule for all statuses; no special case for passed and cancelled events.
2. **Cancelled history.** List every row, including old cancelled rows next to a new active one for the same event (MR5)? Or only the newest row per event (same rule as `GET /events/:id/registrations/me`)? **Recommended: list every row** (history, simple SQL, nothing hidden). The web can show both; change to one row per event later if the duplicate looks wrong.
3. **Index on `registrations.user_id`.** Add a migration now? **Recommended: no.** The table is small in this project, and the task does not ask for it; add `(user_id, created_at DESC, id DESC)` only if the list becomes slow.
4. **Pagination.** **Recommended: out of scope** (assumptions above): an attendee has few rows and the web has no paging controls.
5. **Extra event keys** (venue, capacity, seats left) in each item. **Recommended: no.** The three asked keys are enough for the list; the ticket page and event page read `GET /public/events/:id`.
