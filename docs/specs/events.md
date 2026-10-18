# Spec: Events (M2, organizer, API only)

Feature spec for milestone M2, made from `SPEC_TEMPLATE.md` (sections 1-5). The table `events` is in `DATABASE.md` (section 1, rules 3.8, 3.1 and 3.10). M2 adds one column, `duration_minutes`, by a new migration `002_event_duration.sql` (001 is not edited). Login, guards and the error format come from `auth.md` (A13-A15) and are reused as they are. Roadmap steps 6 and 7.

**Extended by `event-description.md` (DS1-DS13):** an optional plain-text `description`, added by migration `003_event_description.sql`. It changes E1, E2, E11, E13 and the shapes in section 3 as marked below; the rules for it (trim, 2000 code points, no NUL, `''` when empty) are in that file.

## 1. Goals and expected behaviour

**Goal.** A logged-in organizer creates events and sees only their own. Anyone, without login, can open a public event page and see the title, the start and end, the capacity, how many seats are left, whether the event is full and whether it is active, cancelled or passed.

**Behaviours.** Each line is something that can be checked. The ids E1, E2, ... are for this feature (B1-B10 belong to other features).

| # | Behaviour | Test first? |
|---|---|---|
| E1 | `POST /events` with a valid body and an organizer cookie creates one row owned by that organizer (`organizer_id` is the cookie id, never a body field) and answers 201 with the organizer event shape (section 3). New events have stored status `active` (answered as `active`, because the start is in the future) and `schedule_version` 1. The body may also have an optional `description` (`event-description.md` DS3, DS4); without it the event has `description` `''`. | |
| E2 | Create validation: a bad body answers 400 `{ "error": "invalid_input" }` and writes nothing. Bad means: body not an object; `title` missing, not a string, empty after trimming or over 200 characters; `starts_at` missing, not a string, not an ISO 8601 timestamp with `Z` or an offset, or not strictly in the future; `capacity` missing, not a JSON integer, below 1 or above 100000; `duration_minutes` missing, not a JSON integer, below 1 or above 1440; `description` present and not a string or `null`, over 2000 characters (code points) after trimming, or with a NUL (`event-description.md` DS6, DS7). Extra fields (`organizer_id`, `status`, ...) are ignored. | |
| E3 | The title is trimmed before it is stored. `starts_at` is stored as the instant it names and is answered as an ISO string in UTC (`toISOString()`). `duration_minutes` is stored and answered as given. | |
| E4 | `GET /events` with an organizer cookie answers 200 `{ events: [...] }` with only that organizer's events, in the organizer event shape. Another organizer's events never appear. An organizer with no events gets `{ events: [] }`. | yes |
| E5 | List order is `starts_at` ascending, then `id` ascending. All of the organizer's events are listed (past and cancelled too). No pagination. | |
| E6 | `GET /events/:id` with an organizer cookie, for an event the organizer owns, answers 200 with the organizer event shape. | |
| E7 | `GET /events/:id` for another organizer's event answers 404 `{ "error": "not_found" }`, with exactly the same status and body as an id that does not exist. | yes |
| E8 | `GET /events/:id` with an id that is not a uuid answers 404 `{ "error": "not_found" }` (not 400, not 500), and no query reaches the database. | |
| E9 | Guards on `POST /events`, `GET /events`, `GET /events/:id`: no valid login answers 401 `not_logged_in`; an attendee cookie answers 403 `wrong_role`; no handler runs and nothing is written. (`requireOrganizer`, A14, A15.) | yes |
| E10 | In the organizer event shape, `seats_left` is `capacity` minus the number of `registered` registrations of that event, never below 0, and `registered` is that number. With no registrations, `registered` is 0 and `seats_left` equals `capacity`. In the organizer shape this holds for every status (cancelled and passed too): the organizer sees the real numbers. | |
| E11 | `GET /public/events/:id` needs no login (it answers the same with no cookie, an attendee cookie or an organizer cookie). For an existing event it answers 200 with the public shape (section 3): `id`, `title`, `description`, `starts_at`, `ends_at`, `duration_minutes`, `capacity`, `status`, `has_started`, `seats_left`, `full` (`description` from `event-description.md` DS10). | |
| E12 | `full` is true when `seats_left` is 0 and `status` is `active`. Capacity 1 with one `registered` row gives `seats_left` 0 and `full` true. `waitlisted` and `cancelled` registrations do not count as taken seats. | |
| E13 | The public answer has exactly these keys: `id`, `title`, `description` (added by `event-description.md` DS10), `starts_at`, `ends_at`, `duration_minutes`, `capacity`, `status`, `has_started`, `seats_left`, `full`. It never contains `organizer_id`, `registered`, `schedule_version`, `created_at`, `cancelled_at`, any registration, ticket code, user id, name or email. The test checks the exact key list. | yes |
| E14 | A cancelled event (stored status `cancelled`) answers 200 with `status` `cancelled`, `seats_left` 0 and `full` false (it is not full, it is closed). `capacity` is still shown. | |
| E15 | A started event (`starts_at <= now`) answers 200 with `has_started` true, also while it is still running (`status` `active`, the other fields computed as usual). The server clock decides, not the client. | |
| E16 | `GET /public/events/:id` with an unknown id or an id that is not a uuid answers 404 `{ "error": "not_found" }`. | |
| E17 | Errors use the body `{ "error": "<code>" }` as in `auth.md`. Codes used here: `invalid_input`, `not_logged_in`, `wrong_role`, `not_found`. No response contains `password_hash`. | |
| E18 | `ends_at` is `starts_at + duration_minutes` minutes, as an ISO string in UTC, in both shapes. Example: start `2030-01-01T10:00:00Z`, 90 minutes gives `2030-01-01T11:30:00.000Z`. | |
| E19 | `status` is derived at read time, in both shapes: `cancelled` if the stored status is `cancelled`; else `passed` if `now >= ends_at`; else `active`. Cancelled wins over passed. At exactly `now = ends_at` the status is `passed`; one millisecond before it is `active`. Nothing is written to the table. The test inserts rows by SQL with start times in the past or future and a stored `cancelled` status. | yes |
| E20 | A passed event answers 200 on the public route with `status` `passed`, `has_started` true, `seats_left` 0 and `full` false (closed, like cancelled); `capacity` is still shown. On the organizer routes it answers 200 with `status` `passed` and the real `registered` and `seats_left` (E10). | |

**Not in this spec.** Registering, the waiting list, cancelling a registration and my registration (M3, M4); changing capacity (B10, M4); check-in and the arrivals counter (M5); reschedule and cancelling the whole event (B8, B9, M7); reminders and email; live updates; the web screens (`events-web.md`); editing or deleting an event; search, filters and pagination; a public list of events; organizer details on the public page.

Fields that are **only readable now** (nothing in M2 changes them after create): `starts_at`, `duration_minutes`, `capacity`, stored `status` (always `active` in M2 apart from rows made directly in tests; the answered `status` also becomes `passed` by the clock, E19), `cancelled_at` (always null), `schedule_version` (always 1). `registered` is always 0 until M3. The tests for E10-E15 insert `registrations` and cancelled events straight into the database with SQL, as the tests in `api/test/db/` already do.

**Assumptions.** Change any of these first in this file.
- Limits: title 1 to 200 characters (counted as code points, trimmed, no NUL), capacity 1 to 100000. The table only requires `capacity >= 0`; the API is stricter on create because an event with no seats is useless. M4 decides how capacity may be lowered (down to 0 is allowed by the table).
- `starts_at` must be after the server clock at the time of the request. An offset-less string (`2030-01-01T10:00:00`) is rejected, to avoid guessing a time zone.
- Limits: `duration_minutes` 1 to 1440 (one day), required on create, no default in the API. The table has `DEFAULT 60` only for old rows and SQL inserts in tests (`DATABASE.md` section 1).
- `has_started` is `starts_at <= now()` (same rule as `DATABASE.md` 3.7). It is kept next to `status`: it is true while the event runs (started, not ended) and after it; `status` `passed` means ended.
- `status` is derived (E19, `DATABASE.md` 3.10); the stored column keeps only `active`/`cancelled`. A passed or cancelled event is closed: public `seats_left` 0 and `full` false. The organizer shape always shows real numbers.
- The public page shows passed and cancelled events (200), so an old link still explains itself. The client decides what to display.
- The public page shows `capacity` and `seats_left`. Together they tell anyone how many seats are taken; this is accepted. Nothing about who is registered is shown.
- The public route is `/public/events/:id`, a different path from the organizer `/events/:id`, so each route has one guard and one shape. The path prefix does not mean the data is secret anywhere else.
- Reading a count while someone registers is not locked: `seats_left` is a snapshot. The lock for B4 is only for registering (`DATABASE.md` 3.1).
- Unknown JSON fields are ignored, not errors (same as sign-up in `auth.md`).

## 2. UI decisions

No screens in M2 (API only). The screens are in `events-web.md` (M2 UI). What the API gives them: 400 (show field errors), 401/403 (go to organizer login), 404 (event not found), public page states from `status` (active, cancelled, passed), `has_started` (running) and `full` (open, full, closed, running, ended).

## 3. Architecture decisions

- **Apps:** `api/` only. Express 5, TypeScript, Vitest. No new table, no new library, no new env variable. One new migration, `api/src/db/migrations/002_event_duration.sql`, adds `events.duration_minutes` (`DATABASE.md` section 1); `001` is not edited.
- **Derived status:** computed in the app when a row is mapped to a shape, from the stored `status`, `starts_at`, `duration_minutes` and the request time `now` (E19). Not stored, no worker. Use one `now` per request for `status`, `has_started` and `ends_at` checks, so the fields agree with each other.
- **Database access:** parameterised `pg` queries through the existing pool. Create: `INSERT INTO events (organizer_id, title, description, starts_at, duration_minutes, capacity) VALUES (...) RETURNING ...` (`description` since `event-description.md`). The future check is made in the app with the request time; the table has no such check (it must allow old events later).
- **Seats left:** one query for read and list, with no lock:
  `SELECT e.*, count(r.id) FILTER (WHERE r.status = 'registered') AS registered FROM events e LEFT JOIN registrations r ON r.event_id = e.id WHERE ... GROUP BY e.id`
  then `seats_left = max(capacity - registered, 0)` (cast the count to a number; `count` returns bigint as a string in `pg`). The registrations table exists and is empty until M3. No `seats_taken` column (`DATABASE.md` section 1).
- **Ownership (`DATABASE.md` 3.8):** organizer reads use `WHERE e.id = $1 AND e.organizer_id = $2` and the list uses `WHERE e.organizer_id = $1`. `$organizer` is `req.organizer.id` from the cookie. An id that is not a uuid is answered 404 before any query (a bad uuid would make PostgreSQL raise error `22P02`, a 500 otherwise). Another organizer's event and a missing event take the same code path and give the same body.
- **Guards:** `requireOrganizer` on the three organizer routes (A14, A15). The public route has no guard and ignores the cookie.
- **Concurrency:** none needed; create is one insert, reads are snapshots.
- **Shapes** (all JSON):
  - Organizer event: `{ id, title, description, starts_at, ends_at, duration_minutes, capacity, registered, seats_left, status, schedule_version, cancelled_at, created_at }`. `description` is always a string, `''` when empty (`event-description.md` DS9). Timestamps are ISO strings, `cancelled_at` is `null` or an ISO string, `status` is `active`, `cancelled` or `passed` (derived). No `organizer_id` (the caller is the owner).
  - Public event: `{ id, title, description, starts_at, ends_at, duration_minutes, capacity, status, has_started, seats_left, full }`. `seats_left` is 0 and `full` false when `status` is `cancelled` or `passed`; `description` is the stored text for every status (DS10).
- **API:**

| Route | Guard | Body | Success | Errors |
|---|---|---|---|---|
| `POST /events` | `requireOrganizer` | `{ title, description?, starts_at, duration_minutes, capacity }` (`description` optional, DS3) | 201 organizer event | 400 `invalid_input`, 401 `not_logged_in`, 403 `wrong_role` |
| `GET /events` | `requireOrganizer` | none | 200 `{ events: [organizer event] }` | 401, 403 |
| `GET /events/:id` | `requireOrganizer` | none | 200 organizer event | 401, 403, 404 `not_found` (unknown, malformed or not yours) |
| `GET /public/events/:id` | none | none | 200 public event | 404 `not_found` (unknown or malformed) |

  Four routes. Guard order: the guard runs first, so a bad body from an attendee is 403, not 400, and a malformed id from an anonymous caller is 401, not 404.

## 4. Files to touch

| File | What to do | Behaviours |
|---|---|---|
| `api/src/db/migrations/002_event_duration.sql` | New migration: add `events.duration_minutes integer NOT NULL DEFAULT 60` with the CHECK (1..1440). Do not edit `001` | E1, E2, E11, E18-E20 |
| `api/src/db/migrations/003_event_description.sql` | Later migration from `event-description.md`: add `events.description text NOT NULL DEFAULT ''` with `CHECK (char_length(description) <= 2000)`. Does not edit `001` or `002` | DS1, DS2 |
| `api/test/db/` (the existing schema test) | Update: the `events` columns list includes `duration_minutes`; the CHECK rejects 0, -1 and 1441; the default is 60 for an insert without it | E2, E18 |
| `api/src/events/routes.ts` | `eventsRouter(pool)`: the four routes, body validation (title, `starts_at`, `duration_minutes`, capacity), uuid check, query, row to shape mapping (`ends_at`, derived `status`, `seats_left`, `full`, `has_started`) | E1-E20 |
| `api/src/app.ts` | Mount `eventsRouter(pool)` after `authRouter(pool)`, before the 404 handler | E1-E20 |
| `api/test/events/ownership.test.ts` | Tests first: E4, E7, E9 (two organizers, an attendee, no cookie; other organizer's id equals unknown id in status and body) | E4, E7, E9 |
| `api/test/events/public.test.ts` | Tests first: E13 (exact key list), E19 (status derivation, with a fake or injected `now` or rows with past and future starts). Then E11, E12, E14, E15, E16, E20 with rows inserted by SQL | E11-E16, E19, E20 |
| `api/test/events/organizer.test.ts` | E1-E3, E5, E6, E8, E10, E17, E18 | E1-E3, E5, E6, E8, E10, E17, E18 |
| `api/openapi.yaml` | Add the four routes and the two shapes | E1-E20 |
| `README.md` | Add the four routes next to the auth routes, in the same commit as the code; update "Project status" | |
| `ROADMAP.md` | Mark step 5 done now; steps 6 and 7 when finished | |

Tests use the existing style (`createApp().listen(0)` and `fetch`, the helpers in `api/test/auth/helpers.ts` and `api/test/db/helpers.ts`; no new test library). Rows made by a test are deleted by that test (registrations and events first, then accounts).

## 5. Done means

- Tests, typecheck and linter all pass in `api/`.
- Migration `002_event_duration.sql` is applied by the existing migration runner, `001` is unchanged, and the schema test in `api/test/db/` passes with the new column.
- Every behaviour E1-E20 has a test, or a note in the README that says it is not covered.
- E4, E7, E9, E13 and E19 have their tests written and committed before the code (roadmap step 6 is tests-first; step 7 follows the same way for E13).
- `api/openapi.yaml` and the README list the four routes, and "Project status" says that seats left is always the full capacity until M3.

## 6. Decisions from the user

- Past and cancelled events answer 200 on the public page. An event gets a duration, and its status becomes `passed` once `starts_at + duration` has passed (derived at read time, E19).
- The public path is `/public/events/:id`.
- The public page shows `capacity` as well as `seats_left`.
- The organizer list has no pagination and is ordered soonest first (E5).

No open questions. Effects on later milestones (register, check-in, reschedule and capacity on a passed event) are listed in `DATABASE.md` 3.10 for those specs to decide.
