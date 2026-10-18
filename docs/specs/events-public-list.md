# Spec: Public list of events (API only)

Feature spec made from `SPEC_TEMPLATE.md` (sections 1-5). It adds one route, `GET /public/events`, with no login. No migration, no new table. It reuses the derived status, `seats_left` and `full` rules of `events.md` (E10-E20) and the public shape with `description` of `event-description.md` (DS10). Ids use the prefix `PL` (`P`, `L` alone are free but short; `PL` is easy to search). The web side is `events-public-list-web.md`. `events.md` listed "a public list of events" as out of scope; this spec adds it.

## 1. Goals and expected behaviour

**Goal.** Anyone, without login, can ask for the events that can still be joined, soonest first, with enough data to show a card: title, time, seats left, full or not.

**Behaviours.** "Test first" marks the ones whose test is written and committed before the code.

| # | Behaviour | Test first? |
|---|---|---|
| PL1 | `GET /public/events` needs no login. It answers the same with no cookie, an attendee cookie or an organizer cookie. 200 `{ "events": [ ... ] }`. | |
| PL2 | Filter. An event is listed only if its stored status is not `cancelled` and its derived status is not `passed`, i.e. `now < starts_at + duration_minutes` (E19). So upcoming and running events are listed; cancelled and passed events are not. At exactly `now = ends_at` the event is gone; one millisecond before, it is listed. The server clock decides, one `now` per request. | yes |
| PL3 | Cancelled wins: a cancelled event that is still upcoming or running is not listed (E19, cancelled before passed). | yes |
| PL4 | Order: `starts_at` ascending, then `id` ascending. A running event (started earlier) therefore comes before an upcoming one. The client does not sort. | yes |
| PL5 | Item shape (shorter than the public event, see section 3): exactly `id`, `title`, `starts_at`, `ends_at`, `duration_minutes`, `capacity`, `status`, `has_started`, `seats_left`, `full`. No `description`. Values follow `events.md` (E12, E15, E18, E19): `status` is always `active` here; `has_started` is true while it runs; `seats_left` is `capacity` minus `registered` registrations, never below 0; `full` is true when `seats_left` is 0. Timestamps are ISO strings in UTC. The test checks the exact key list. | yes |
| PL6 | Privacy: no item and no part of the answer contains any key that E13 forbids (`organizer_id`, `registered`, `schedule_version`, `created_at`, `cancelled_at`), nor any registration, ticket code, user id, name or email. The answer has only the key `events`. | yes |
| PL7 | Seats: `waitlisted` and `cancelled` registrations do not count (E12). An event with capacity 1 and one `registered` row is listed with `seats_left` 0 and `full` true (a full event is still listed: people can join its waiting list). | |
| PL8 | Limit: at most 100 events are returned (the first 100 in the order of PL4). No query parameters, no cursor, no `next` key. Any query string is ignored. | |
| PL9 | Empty: when no event qualifies, 200 `{ "events": [] }` (not 404, not `null`). | |
| PL10 | Errors: no body to validate, so no 400. A database failure follows the existing error handler (500 `{ "error": ... }` as elsewhere). No new error code. Only GET exists; other methods get the existing 404/405 behaviour of the app. | |
| PL11 | Route order: `/public/events` is a different path from `/public/events/:id`; `GET /public/events/:id` is unchanged (E11-E16, DS10), including for ids of cancelled and passed events. | |

**Out of scope.** Search, filters, sort options, pagination beyond the fixed limit, past or cancelled events in the list, `description` in the list, organizer name or any organizer data, registration data, "my registrations" flags, caching headers, live updates, the web screen (see `events-public-list-web.md`).

**Assumptions.** Change any of these first in this file.
- Only upcoming and running events are listed; the rest is reachable by its link (`/public/events/:id` still answers 200 for them).
- The list item has no `description`: it can be up to 2000 characters and the list is for scanning. The detail route has it.
- Limit 100, fixed, no cursor. Simple; with more than 100 open events the later ones are not reachable from the list until pagination is specified.
- Full events stay in the list (their waiting list is open, R11 and `registration.md`).
- Everything in the list is already public through `GET /public/events/:id`; the list adds discovery only (ids), no new data.
- Reading seats is a snapshot, no lock (as in `events.md`).

## 2. UI decisions

None (API only). What the web gets: `events` array, possibly empty; each item has `id` for the link `/event/:id`, `has_started` and `full` for the badge, `seats_left` for the count.

## 3. Architecture decisions

- **Apps:** `api/` only. Express 5, TypeScript, Vitest. No new library, table, migration or env variable.
- **Route:** `GET /public/events` in `api/src/events/routes.ts`, next to `GET /public/events/:id`, with no guard. Register it so the two paths cannot be confused (`/public/events` has no param).
- **Query:** one query, no lock, same style as the existing read:
  `SELECT e.*, count(r.id) FILTER (WHERE r.status = 'registered') AS registered FROM events e LEFT JOIN registrations r ON r.event_id = e.id WHERE e.status <> 'cancelled' AND e.starts_at + make_interval(mins => e.duration_minutes) > $1 GROUP BY e.id ORDER BY e.starts_at ASC, e.id ASC LIMIT 100`
  with `$1` the request `now` (one `now` per request, passed as a parameter, so the filter and the derived fields agree and a test can inject the clock the same way as for E19). Cast `count` to a number.
- **Shape:** reuse the existing row-to-public-shape mapping, then drop `description` (pick the ten keys; do not return the full public shape with a key removed afterwards by delete). Because every listed event is not closed, `seats_left` and `full` come out of the normal rule; no special case.
- **Concurrency:** none; one snapshot read.
- **API:**

| Route | Guard | Success | Errors |
|---|---|---|---|
| `GET /public/events` | none | 200 `{ events: [public list item] }` | 500 only |

- **Public list item:** `{ id, title, starts_at, ends_at, duration_minutes, capacity, status, has_started, seats_left, full }`.

## 4. Files to touch

| File | What to do | Behaviours |
|---|---|---|
| `api/test/events/publicList.test.ts` (new) | Tests first (red): PL2, PL3, PL4 (rows inserted by SQL: upcoming, running, passed, cancelled, cancelled-and-upcoming, one at exactly the end, ties on `starts_at` for the id order), PL5 exact key list, PL6. Then PL1, PL7-PL11 (PL8 with 101 rows; delete them after) | PL1-PL11 |
| `api/src/events/routes.ts` | Add the route, query and list-item mapping (section 3) | PL1-PL11 |
| `api/openapi.yaml` | Add `GET /public/events` and the list item schema | PL1, PL5 |
| `docs/specs/events.md` | Pointer: "a public list of events" is now in `events-public-list.md` (separate edit, not part of this spec) | |
| `README.md`, `ROADMAP.md` | Route list and step (separate edit by the agent that owns them) | |

Tests use the existing style (`createApp().listen(0)` and `fetch`, helpers in `api/test/auth/helpers.ts` and `api/test/db/helpers.ts`; no new library). Rows made by a test are deleted by that test. Tests that count the full answer must not depend on other rows in the dev database: filter the answer by the ids the test inserted, except the empty case (PL9), which uses an injected `now` far in the future or a clean test database.

## 5. Done means

- Tests, typecheck and linter pass in `api/`.
- Every behaviour PL1-PL11 has a test, or a note in the README that says it is not covered.
- PL2, PL3, PL4, PL5 and PL6 have their tests written and committed before the code (red first, then green).
- Existing tests of `events.md` and `event-description.md` stay green; `GET /public/events/:id` is unchanged.
- `api/openapi.yaml` lists the route and the item shape.

## 6. Open questions

1. Is a limit of 100 with no cursor enough, or should the list have `limit` and a cursor now? Default: 100, no cursor.
2. Should running events (already started, not ended) be listed? Default: yes (registration stays open until the end, R11).
3. Should full events be listed? Default: yes, with `full` true (waiting list).
4. Should the list item carry `description`? Default: no.
5. Should cancelled and passed events be listed, e.g. as a second list? Default: no.
