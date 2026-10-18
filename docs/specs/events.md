# Spec: Events (M2, organizer, API only)

Feature spec for milestone M2, made from `SPEC_TEMPLATE.md` (sections 1-5). The table `events` is in `DATABASE.md` (section 1, rules 3.8 and 3.1); this file does not change it. Login, guards and the error format come from `auth.md` (A13-A15) and are reused as they are. Roadmap steps 6 and 7.

## 1. Goals and expected behaviour

**Goal.** A logged-in organizer creates events and sees only their own. Anyone, without login, can open a public event page and see the title, the start, how many seats are left and whether the event is full.

**Behaviours.** Each line is something that can be checked. The ids E1, E2, ... are for this feature (B1-B10 belong to other features).

| # | Behaviour | Test first? |
|---|---|---|
| E1 | `POST /events` with a valid body and an organizer cookie creates one row owned by that organizer (`organizer_id` is the cookie id, never a body field) and answers 201 with the organizer event shape (section 3). New events have `status` `active`, `schedule_version` 1. | |
| E2 | Create validation: a bad body answers 400 `{ "error": "invalid_input" }` and writes nothing. Bad means: body not an object; `title` missing, not a string, empty after trimming or over 200 characters; `starts_at` missing, not a string, not an ISO 8601 timestamp with `Z` or an offset, or not strictly in the future; `capacity` missing, not a JSON integer, below 1 or above 100000. Extra fields (`organizer_id`, `status`, ...) are ignored. | |
| E3 | The title is trimmed before it is stored. `starts_at` is stored as the instant it names and is answered as an ISO string in UTC (`toISOString()`). | |
| E4 | `GET /events` with an organizer cookie answers 200 `{ events: [...] }` with only that organizer's events, in the organizer event shape. Another organizer's events never appear. An organizer with no events gets `{ events: [] }`. | yes |
| E5 | List order is `starts_at` ascending, then `id` ascending. All of the organizer's events are listed (past and cancelled too). No pagination. | |
| E6 | `GET /events/:id` with an organizer cookie, for an event the organizer owns, answers 200 with the organizer event shape. | |
| E7 | `GET /events/:id` for another organizer's event answers 404 `{ "error": "not_found" }`, with exactly the same status and body as an id that does not exist. | yes |
| E8 | `GET /events/:id` with an id that is not a uuid answers 404 `{ "error": "not_found" }` (not 400, not 500), and no query reaches the database. | |
| E9 | Guards on `POST /events`, `GET /events`, `GET /events/:id`: no valid login answers 401 `not_logged_in`; an attendee cookie answers 403 `wrong_role`; no handler runs and nothing is written. (`requireOrganizer`, A14, A15.) | yes |
| E10 | In the organizer event shape, `seats_left` is `capacity` minus the number of `registered` registrations of that event, never below 0, and `registered` is that number. With no registrations, `registered` is 0 and `seats_left` equals `capacity`. | |
| E11 | `GET /public/events/:id` needs no login (it answers the same with no cookie, an attendee cookie or an organizer cookie). For an existing event it answers 200 with the public shape (section 3): `id`, `title`, `starts_at`, `status`, `has_started`, `seats_left`, `full`. | |
| E12 | `full` is true when `seats_left` is 0 and the event is active. Capacity 1 with one `registered` row gives `seats_left` 0 and `full` true. `waitlisted` and `cancelled` registrations do not count as taken seats. | |
| E13 | The public answer never contains `organizer_id`, `capacity`, `registered`, `schedule_version`, `created_at`, `cancelled_at`, any registration, ticket code, user id, name or email. The test checks the exact key list. | yes |
| E14 | A cancelled event (`status` `cancelled`) answers 200 with `status` `cancelled`, `seats_left` 0 and `full` false (it is not full, it is closed). | |
| E15 | A past event (`starts_at` is not after now) answers 200 with `has_started` true; the other fields are computed as usual. The server clock decides, not the client. | |
| E16 | `GET /public/events/:id` with an unknown id or an id that is not a uuid answers 404 `{ "error": "not_found" }`. | |
| E17 | Errors use the body `{ "error": "<code>" }` as in `auth.md`. Codes used here: `invalid_input`, `not_logged_in`, `wrong_role`, `not_found`. No response contains `password_hash`. | |

**Not in this spec.** Registering, the waiting list, cancelling a registration and my registration (M3, M4); changing capacity (B10, M4); check-in and the arrivals counter (M5); reschedule and cancelling the whole event (B8, B9, M7); reminders and email; live updates; the web screens (`events-web.md`); editing or deleting an event; search, filters and pagination; a public list of events; organizer details on the public page.

Fields that are **only readable now** (nothing in M2 changes them after create): `starts_at`, `capacity`, `status` (always `active` in M2 apart from rows made directly in tests), `cancelled_at` (always null), `schedule_version` (always 1). `registered` is always 0 until M3. The tests for E10-E15 insert `registrations` and cancelled events straight into the database with SQL, as the tests in `api/test/db/` already do.

**Assumptions.** Change any of these first in this file.
- Limits: title 1 to 200 characters (counted as code points, trimmed, no NUL), capacity 1 to 100000. The table only requires `capacity >= 0`; the API is stricter on create because an event with no seats is useless. M4 decides how capacity may be lowered (down to 0 is allowed by the table).
- `starts_at` must be after the server clock at the time of the request. An offset-less string (`2030-01-01T10:00:00`) is rejected, to avoid guessing a time zone.
- `has_started` is `starts_at <= now()` (same rule as `DATABASE.md` 3.7).
- The public page shows past and cancelled events, with the flags above, so an old link still explains itself. The client decides what to display.
- The public route is `/public/events/:id`, a different path from the organizer `/events/:id`, so each route has one guard and one shape. The path prefix does not mean the data is secret anywhere else.
- Reading a count while someone registers is not locked: `seats_left` is a snapshot. The lock for B4 is only for registering (`DATABASE.md` 3.1).
- Unknown JSON fields are ignored, not errors (same as sign-up in `auth.md`).

## 2. UI decisions

No screens in M2 (API only). The screens are in `events-web.md` (M2 UI). What the API gives them: 400 (show field errors), 401/403 (go to organizer login), 404 (event not found), public page states from `status`, `has_started`, `full` (open, full, closed, already started).

## 3. Architecture decisions

- **Apps:** `api/` only. Express 5, TypeScript, Vitest. No new tables, no migration, no new library, no new env variable.
- **Database access:** parameterised `pg` queries through the existing pool. Create: `INSERT INTO events (organizer_id, title, starts_at, capacity) VALUES (...) RETURNING ...`. The future check is made in the app with the request time; the table has no such check (it must allow old events later).
- **Seats left:** one query for read and list, with no lock:
  `SELECT e.*, count(r.id) FILTER (WHERE r.status = 'registered') AS registered FROM events e LEFT JOIN registrations r ON r.event_id = e.id WHERE ... GROUP BY e.id`
  then `seats_left = max(capacity - registered, 0)` (cast the count to a number; `count` returns bigint as a string in `pg`). The registrations table exists and is empty until M3. No `seats_taken` column (`DATABASE.md` section 1).
- **Ownership (`DATABASE.md` 3.8):** organizer reads use `WHERE e.id = $1 AND e.organizer_id = $2` and the list uses `WHERE e.organizer_id = $1`. `$organizer` is `req.organizer.id` from the cookie. An id that is not a uuid is answered 404 before any query (a bad uuid would make PostgreSQL raise error `22P02`, a 500 otherwise). Another organizer's event and a missing event take the same code path and give the same body.
- **Guards:** `requireOrganizer` on the three organizer routes (A14, A15). The public route has no guard and ignores the cookie.
- **Concurrency:** none needed; create is one insert, reads are snapshots.
- **Shapes** (all JSON):
  - Organizer event: `{ id, title, starts_at, capacity, registered, seats_left, status, schedule_version, cancelled_at, created_at }`. Timestamps are ISO strings, `cancelled_at` is `null` or an ISO string. No `organizer_id` (the caller is the owner).
  - Public event: `{ id, title, starts_at, status, has_started, seats_left, full }`.
- **API:**

| Route | Guard | Body | Success | Errors |
|---|---|---|---|---|
| `POST /events` | `requireOrganizer` | `{ title, starts_at, capacity }` | 201 organizer event | 400 `invalid_input`, 401 `not_logged_in`, 403 `wrong_role` |
| `GET /events` | `requireOrganizer` | none | 200 `{ events: [organizer event] }` | 401, 403 |
| `GET /events/:id` | `requireOrganizer` | none | 200 organizer event | 401, 403, 404 `not_found` (unknown, malformed or not yours) |
| `GET /public/events/:id` | none | none | 200 public event | 404 `not_found` (unknown or malformed) |

  Four routes. Guard order: the guard runs first, so a bad body from an attendee is 403, not 400, and a malformed id from an anonymous caller is 401, not 404.

## 4. Files to touch

| File | What to do | Behaviours |
|---|---|---|
| `api/src/events/routes.ts` | `eventsRouter(pool)`: the four routes, body validation (title, `starts_at`, capacity), uuid check, query, row to shape mapping (`seats_left`, `full`, `has_started`) | E1-E17 |
| `api/src/app.ts` | Mount `eventsRouter(pool)` after `authRouter(pool)`, before the 404 handler | E1-E17 |
| `api/test/events/ownership.test.ts` | Tests first: E4, E7, E9 (two organizers, an attendee, no cookie; other organizer's id equals unknown id in status and body) | E4, E7, E9 |
| `api/test/events/public.test.ts` | Tests first: E13 (exact key list). Then E11, E12, E14, E15, E16 with rows inserted by SQL | E11-E16 |
| `api/test/events/organizer.test.ts` | E1-E3, E5, E6, E8, E10, E17 | E1-E3, E5, E6, E8, E10, E17 |
| `api/openapi.yaml` | Add the four routes and the two shapes | E1-E17 |
| `README.md` | Add the four routes next to the auth routes, in the same commit as the code; update "Project status" | |
| `ROADMAP.md` | Mark step 5 done now; steps 6 and 7 when finished | |

Tests use the existing style (`createApp().listen(0)` and `fetch`, the helpers in `api/test/auth/helpers.ts` and `api/test/db/helpers.ts`; no new test library). Rows made by a test are deleted by that test (registrations and events first, then accounts).

## 5. Done means

- Tests, typecheck and linter all pass in `api/`.
- Every behaviour E1-E17 has a test, or a note in the README that says it is not covered.
- E4, E7, E9 and E13 have their tests written and committed before the code (roadmap step 6 is tests-first; step 7 follows the same way for E13).
- `api/openapi.yaml` and the README list the four routes, and "Project status" says that seats left is always the full capacity until M3.

## 6. Open questions

1. Past event on the public page: show it with `has_started` true (chosen here), or answer 404? Same for cancelled (chosen: 200 with `status` `cancelled`). This changes what the web page shows in `events-web.md`.
2. Is the public path `/public/events/:id` acceptable, or should it be `/events/:id/public`? A plain `/events/:id` for both is not possible, because the organizer route needs a login and the public one must not.
3. Should the public page show `capacity` as well as `seats_left`? Chosen: no (smaller leak, nothing in the task needs it).
4. Is "no pagination" fine for the organizer list, and is `starts_at` ascending the order you want (soonest first, past events first)?
