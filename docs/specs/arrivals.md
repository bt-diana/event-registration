# Spec: Arrivals route (capacity, registered and arrived counts, organizer, API)

Feature spec made from `SPEC_TEMPLATE.md` (sections 1-5). It adds one read route. No new table and no migration: it reads `events.capacity`, `registrations.status` and `registrations.checked_in_at` (`DATABASE.md` section 1, rules 3.3, 3.8 and 3.10), which this file does not change. Login, guards and the error format come from `auth.md` (A13-A15); ownership and 404 rules from `events.md` and `checkin.md` (C17); check-in from `checkin.md` (C3-C13). Behaviours B6 and B7 of the template. Decision D47 (session `18-10-1931_arrivals-endpoint-spec`) reverses D45 and asks for this route. Ids are AR1, AR2, ...

## 1. Goals and expected behaviour

**Goal.** An organizer asks one cheap question for one of their events: how many seats does it have, how many are taken, and how many of those people have arrived. The answer is a small fixed shape, so the screen no longer downloads the whole registrations list to show a counter.

**Behaviours.** Each line is something a test can prove. "Yes" means the test is written and committed before the code.

| # | Behaviour | Test first? |
|---|---|---|
| AR1 | Guards on `GET /events/:id/arrivals`: no valid login answers 401 `not_logged_in`; an attendee cookie answers 403 `wrong_role` (`requireOrganizer`). The guard runs first, so even a malformed id is 401 for an anonymous caller. No query runs. | yes |
| AR2 | For an event of the logged-in organizer the answer is 200 with exactly three keys: `capacity`, `registered` and `arrived`. All numbers are JSON numbers (the SQL `count` is bigint and is cast). It contains no `event_id` and never the event title, `organizer_id`, any registration, ticket code, name, email or another event's data. The test checks the exact key list. | |
| AR3 | `registered` is the number of `registrations` of that event with `status = 'registered'` (taken seats; same number as `registered` in the organizer event shape, `events.md` E10). `waitlisted` and `cancelled` rows are never counted in it. | yes |
| AR4 | `arrived` is the number of `registered` rows of that event with `checked_in_at` not null. A `waitlisted` or `cancelled` row is never counted, even if a (wrong) `checked_in_at` is set by SQL in the test. | yes |
| AR5 | `arrived` is never above `registered`. A test with many mixed rows (registered with and without `checked_in_at`, waitlisted, cancelled) checks `arrived <= registered` and the exact values. | yes |
| AR6 | `capacity` is the stored `events.capacity`. It is not reduced by taken seats and not clamped to `registered`: if `registered` is above `capacity` (a lowered capacity, M4), both numbers are returned as stored. | |
| AR7 | An event with nobody gives `registered: 0, arrived: 0` and its real `capacity` (200, not 404). | |
| AR8 | An event that is unknown, not a uuid, or owned by another organizer answers 404 `{ "error": "not_found" }`, the same body for all three. A malformed id never reaches the database. The test checks that unknown and foreign answers are equal and that nothing about the foreign event leaks. | yes |
| AR9 | A cancelled or passed event of the organizer still answers 200 with the real numbers (same as `checkin.md` C17 and `events.md` E10, E20). | |
| AR10 | Consistency with check-in: the counts use the same rules as `POST /checkin` (a check-in only changes a `registered` row of an `active` event, C3, C13). After a `POST /checkin` answered 200, the next `GET .../arrivals` shows `arrived` one higher and `registered` unchanged. After a refused check-in (any 409, 404, 400, C4-C9) the numbers are unchanged. Checking in the same ticket again never raises `arrived`. | yes |
| AR11 | Right after a concurrent check-in: five parallel `POST /checkin` with the same code, then `GET .../arrivals`, show `arrived` one higher (not five). Five parallel check-ins of five different tickets, then the route, show `arrived` five higher. Repeated on fresh tickets. | yes |
| AR12 | The two numbers come from one SQL statement, so they are one snapshot: `arrived` is never above `registered` in a single answer, even while check-ins and registrations happen. No lock, no explicit transaction, no server-side cache. | |
| AR13 | The response has `Cache-Control: no-store` on 200 and on the 404 (same as the list, `checkin.md` C18). Two reads with a check-in between them show the new `arrived`. | |
| AR14 | Errors use `{ "error": "<code>" }` as in `auth.md`. Codes here: `not_logged_in`, `wrong_role`, `not_found`. No 400: the only input is the path id and a bad id is a 404. | |
| AR15 | The route changes nothing: no row written, no outbox row, and it does not touch `GET /events/:id/registrations` (shape and behaviour stay as in `checkin.md` C15-C18). | |

**Not in this spec.** The web change that reads this route (follow-up to `checkin-web.md`, see below), live updates by server-sent events (M8), a list of who arrived or who is missing, the waiting-list size, a public or attendee version of the numbers, paging, a per-day history, changing capacity (B10, M4), export.

**Assumptions.** Change any of these first in this file.
- The shape is `{ capacity, registered, arrived }`, decided by the user (D48, then D49): no `event_id`. `registered` is the denominator the old counter used.
- Same ownership rule as the organizer list: the organizer id is from the cookie, never from the request; a foreign or unknown event looks the same (`DATABASE.md` 3.8).
- `arrived` counts only `registered` tickets with `checked_in_at` set. `waitlisted` people never count (the CHECK in the table also forbids a check-in time on them).
- The route is a snapshot for polling. A bigger event does not make it slower in the response size (the answer is four numbers); the SQL scans only that event's rows (index on `registrations.event_id`).
- Rows made by tests (waiting, cancelled, wrong `checked_in_at`, other organizers, cancelled and passed events) are inserted by SQL with the helpers in `api/test/db/helpers.ts`.

## 2. UI decisions

No screen in this spec (API only). The change of the counter on the scan screen and the list screen is a follow-up of `checkin-web.md` (see "Follow-up edits"). What the API gives a screen: 200 numbers (show "Arrived: {arrived} / {...}", the second number is open question 2), 404 (event not found), 401 (organizer login), 403 (attendees cannot see it). States for the screen to handle: loading, first-load error with retry, a failed poll keeps the last numbers, `0 / 0` for an event with nobody, all arrived when `arrived` equals `registered` above 0.

## 3. Architecture decisions

- **Apps:** `api/` only. Express 5, TypeScript, Vitest. No new table, no migration, no library, no env variable.
- **Router:** the route is added in the existing `checkinRouter(pool)` (`api/src/checkin/routes.ts`), next to `GET /events/:id/registrations`, with `requireOrganizer`. The path `/events/:id/arrivals` collides with no other route. It is declared before the app's 404 handler like the others.
- **One query, no lock (AR3-AR5, AR7, AR12).** The ownership check and the counts are the same statement, so a missing row is the 404 and an owned event with no registrations still returns one row:
  ```sql
  SELECT e.capacity,
         count(r.id) FILTER (WHERE r.status = 'registered')::int AS registered,
         count(r.id) FILTER (WHERE r.status = 'registered' AND r.checked_in_at IS NOT NULL)::int AS arrived
    FROM events e
    LEFT JOIN registrations r ON r.event_id = e.id
   WHERE e.id = $1 AND e.organizer_id = $2
   GROUP BY e.id;  -- no row = 404
  ```
  No row is `not_found` (unknown and foreign look the same). `::int` makes `pg` return numbers, not bigint strings (the same cast as `events.md`). `arrived <= registered` holds by construction (the second FILTER is a subset of the first), and both numbers are read in one statement from one snapshot.
- **Consistency with check-in (AR10, AR11).** Check-in is one conditional UPDATE that sets `checked_in_at` only on a `registered` row (`checkin.md` section 3). The route reads the committed state under READ COMMITTED. Once the check-in answered 200 its row is committed, so a read that starts later sees it. Five parallel check-ins of one ticket change one row, so the count rises by exactly one. Nothing in the route can count a row the check-in would refuse.
- **Header:** `Cache-Control: no-store` is set before the id check, so every answer after the guard has it (AR13), as in the list route.
- **Route code:** `getArrivals(pool, organizerId, eventId)` in `api/src/checkin/service.ts` returns `{ kind: "not_found" } | { kind: "ok", row }`; the route maps it to the shape. uuid regex reused from the list route.
- **Shape:** `{ capacity, registered, arrived }`, three JSON numbers.
- **API:**

| Route | Guard | Body | Success | Errors |
|---|---|---|---|---|
| `GET /events/:id/arrivals` | `requireOrganizer` | none | 200 `{ capacity, registered, arrived }` | 401 `not_logged_in`, 403 `wrong_role`, 404 `not_found` (unknown, malformed or foreign event) |

## 4. Files to touch

| File | What to do | Behaviours |
|---|---|---|
| `api/test/checkin/arrivals.test.ts` | **Tests first (red):** AR1 (guards, malformed id from anonymous is 401), AR8 (unknown, malformed, foreign: equal 404), AR3-AR5 (mixed rows by SQL, exact values, waitlisted with a wrong `checked_in_at` not counted), AR10 and AR11 (check in over HTTP then read; 5 parallel same code; 5 parallel different codes; repeat on fresh tickets); then AR2 (exact key list), AR6, AR7, AR9, AR13, AR14, AR15 | AR1-AR15 |
| `api/src/checkin/service.ts` | Add `getArrivals` with the SQL above | AR2-AR7, AR9, AR12 |
| `api/src/checkin/routes.ts` | Add `GET /events/:id/arrivals`: guard, header, uuid check, mapping | AR1, AR2, AR8, AR13, AR14 |
| `api/openapi.yaml` | Add the route, the `Arrivals` schema and the 401/403/404 answers; raise the minor version | all |
| `README.md` | Add the route to the list; update "Project status" | |
| `ROADMAP.md` | Add the step for this route (tests, then code) | |
| `docs/specs/checkin.md`, `docs/specs/checkin-web.md` | Follow-up edits below (not made by this spec) | |

Tests use the existing style (`createApp().listen(0)` and `fetch`, helpers in `api/test/auth/helpers.ts` and `api/test/db/helpers.ts`; no new library). A test deletes the rows it made (outbox, registrations and events first, then accounts).

## 5. Done means

- Tests, typecheck and linter pass in `api/`.
- Every behaviour AR1-AR15 has a test, or a note in the README that says it is not covered.
- The tests for AR1, AR3, AR4, AR5, AR8, AR10 and AR11 are written and committed before the route code, and shown failing for the right reason (route missing, then wrong counts).
- `api/openapi.yaml` and the README list the route; "Project status" says the route exists and whether the web already uses it.

## What this supersedes

- **D45** ("no separate arrivals endpoint"): replaced by D47. The route exists now.
- **`checkin.md` C16** (the counter is not a route of its own; the screen counts it from the list) and **assumption 42** ("There is no separate arrivals route"): the counter now has its own route. The list part of C16 that says the list follows the data (`checked_in_at` set after a check-in, `waitlisted` always null) stays true and stays tested.
- **`checkin.md` C17, C18**: stay for the list route. C17 (404 rules) and C18 (`no-store`, one query, no lock) are copied for the new route as AR8 and AR13; they are not removed from the list.
- **`checkin.md` open question 5** ("Decided by the user: no arrivals route"): replaced by D47.
- **`checkin.md` section 2** line "For the counter: count `checked_in_at` not null out of the `registered` items of the list": the counter reads this route.
- **`checkin-web.md` W-C1** (pure `arrivals(registrations)` counting the list), **W-C4** (one source: the list query serves both counter and table) and **W-C11** (invalidate `["event-registrations"]` after a 200 check-in; here the counter also needs its own key invalidated): the browser reads this route for the counter instead of counting the list. The "Out of scope" line "a separate arrivals route (D45)" and the goal sentence "there is no arrivals route" are also superseded.
- Not superseded: `GET /events/:id/registrations` and its shape (C15), the table and the "Arrival" column of the organizer list (W-C16), and `POST /checkin`.

## Follow-up edits (other specs; not made here)

1. `checkin.md`: C16 rewritten to "the counter is `GET /events/:id/arrivals` (`arrivals.md`)"; assumption 42 and open question 5 point to D47 and `arrivals.md`; section 2 counter line points to the new route; section 3 "Polling now" says the screen polls the arrivals route; C15-C18 for the list stay.
2. `checkin-web.md`: goal sentence and "Out of scope" line (D45) removed; W-C1 changed (the pure `arrivals()` is replaced by a hook `useEventArrivals` that reads the route; the "never above registered" and "waitlisted never counted" checks move to the API tests AR4, AR5); W-C4 rewritten (the counter has its own key, for example `["event-arrivals", me.id, eventId]`, and its own request per tick; the table keeps `["event-registrations", ...]`); W-C6 to W-C10 and W-C12 to W-C15 point to the new query key (same polling, stops, cache by account); W-C11 invalidates both prefixes after a 200 check-in; W-C2 and W-C14 text depends on question 2 below; section 3 "Pure helpers" and "Hook" and section 4 files (`arrivals.ts`) change; question 3 and the tests move accordingly.
3. `api/openapi.yaml` version and the list of routes in `README.md` (this spec's step does these).
4. `ROADMAP.md`: add the API step (tests, code) before the web counter step.

## 6. Open questions (each with a recommended answer)

1. **Response shape. Decided by the user (D49): `{ capacity, registered, arrived }`** (D48 had dropped the capacity). Earlier options were: `{ event_id, capacity, arrived }` only, or add `registered`. **Recommended: `{ event_id, capacity, registered, arrived }`.** `registered` is free in the same query, keeps the old "x of y registered" text possible, and stays equal to `registered` in the organizer event shape (E10). Waitlisted people are in neither number.
2. **Counter text.** Today: "Arrived: x / y registered" (`checkin-web.md` W-C2). With the capacity: "Arrived: x / capacity", or show both ("Arrived: 12 / 20 registered (capacity 25)"). **Recommended: keep "Arrived: {arrived} / {registered} registered" and add the capacity as a small second line only if you want it** (the user asked for the capacity, so decide in `checkin-web.md`). Using capacity as the only denominator reads "12 / 25" even when only 20 are registered and "Everyone has arrived." could then never show. Not decided here.
3. **Should the list route keep working for the counter?** **Recommended: yes, keep it unchanged** (the table needs it) and do not remove the "Arrival" column.
4. **Event page `/event/:id`.** It already shows `registered` and `seats_left` (E10). **Recommended: do not add the arrivals counter there** (as `checkin-web.md` question 1).
5. **`registered` above `capacity`.** Possible after a capacity change in M4. **Recommended: return both as stored, no clamping (AR6)**; the screen decides how to show it.
6. **404 header.** `no-store` on the 404 as well (AR13). **Recommended: yes**, so a cached 404 never hides a later event; cheap and the same as the list.
