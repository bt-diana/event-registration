# Spec: Database schema

Part of `SPEC.md` (section 3). PostgreSQL 18, Windows service, port 5433, `DATABASE_URL`, no Docker. Migrations are plain `.sql` files in `api/src/db/migrations/`, applied in file-name order. This file says what the schema must guarantee. It is not the migration.

Five tables: `organizers`, `users`, `events`, `registrations`, `outbox`. A ticket is a registration row (one table, no separate `tickets`). No other tables.

- `users` are attendees. They have no password and no login: registering with an email finds or creates the user.
- `organizers` have a login and own events. An organizer is not an attendee, so the two tables are separate.

## 1. Tables

### organizers

| Column | Type | Rule | Supports |
|---|---|---|---|
| id | bigint, identity, PK | | all |
| email | text NOT NULL, UNIQUE | `CHECK (email = lower(btrim(email)))`; the login name | |
| name | text NOT NULL | | |
| password_hash | text NOT NULL | hash only, never the password; method is open (question 13) | |
| created_at | timestamptz NOT NULL DEFAULT now() | | |

### users (attendees)

| Column | Type | Rule | Supports |
|---|---|---|---|
| id | bigint, identity, PK | | all |
| email | text NOT NULL, UNIQUE | `CHECK (email = lower(btrim(email)))`; the app lowercases and trims before insert | B1 |
| name | text NULL | optional, from the registration form if given | |
| created_at | timestamptz NOT NULL DEFAULT now() | | |

### events

| Column | Type | Rule | Supports |
|---|---|---|---|
| id | bigint, identity, PK | | all |
| organizer_id | bigint NOT NULL, FK to organizers(id) | the owner; only this organizer manages the event | ownership (3.8) |
| title | text NOT NULL | | |
| starts_at | timestamptz NOT NULL | changed by reschedule | B5, B8 |
| capacity | integer NOT NULL | `CHECK (capacity >= 0)` | B2, B4 |
| status | text NOT NULL DEFAULT 'active' | `CHECK (status IN ('active','cancelled'))`; the whole event is cancelled | B9 |
| cancelled_at | timestamptz NULL | set when the event is cancelled | B9 |
| created_at | timestamptz NOT NULL DEFAULT now() | | |

Index: `CREATE INDEX events_organizer ON events (organizer_id);` lists an organizer's events.

No `seats_taken` counter: seats used = `count(*)` of `registered` rows for the event (see 3.1). Less state, nothing to drift.

### registrations (one row = one person on one event = one ticket)

| Column | Type | Rule | Supports |
|---|---|---|---|
| id | bigint, identity, PK | also the waiting-list order | B2, B3 |
| event_id | bigint NOT NULL, FK to events(id) | | |
| user_id | bigint NOT NULL, FK to users(id) | the attendee; replaces the old `email` column | B1 |
| status | text NOT NULL | `CHECK (status IN ('registered','waitlisted','cancelled'))` | B1-B3 |
| ticket_code | text NOT NULL, UNIQUE | random, 10 chars, A-Z and 2-9 (no 0/O/1/I); made by the app | B1, B6 |
| checked_in_at | timestamptz NULL | NULL = not arrived | B6, B7 |
| created_at | timestamptz NOT NULL DEFAULT now() | | |
| cancelled_at | timestamptz NULL | | |

Constraints:
- `CREATE UNIQUE INDEX registrations_one_active_per_user ON registrations (event_id, user_id) WHERE status <> 'cancelled';` Same person (same email, so same user) twice cannot make two seats or two list places (B1). A cancelled person may register again as a new row.
- `CHECK (checked_in_at IS NULL OR status = 'registered')`. Only seated people arrive (B6).
- `CREATE INDEX registrations_waitlist ON registrations (event_id, id) WHERE status = 'waitlisted';` Finds the first waiting person fast (B3).
- Waiting-list order = `ORDER BY id` among `waitlisted` rows. `id` is assigned in insert order, so it is first come, first served (B2, B3).

### outbox (the stub email: a row is the email, the sender prints it and sets `sent_at`)

| Column | Type | Rule | Supports |
|---|---|---|---|
| id | bigint, identity, PK | | |
| registration_id | bigint NOT NULL, FK to registrations(id) | | |
| kind | text NOT NULL | `CHECK (kind IN ('ticket','promotion','reminder','reschedule','event_cancelled'))` | B1, B3, B5, B8, B9 |
| event_starts_at | timestamptz NOT NULL | copy of `events.starts_at` when the row was written | B5, B8 |
| to_email | text NOT NULL | copy of `users.email` when the row was written, so a sent email stays as it was | |
| subject | text NOT NULL | | |
| body | text NOT NULL | | |
| created_at | timestamptz NOT NULL DEFAULT now() | | |
| sent_at | timestamptz NULL | NULL = not printed yet | |

Constraint: `UNIQUE (registration_id, kind, event_starts_at)`. This is the whole "once" rule for B5 (see 3.2). It also stops a second ticket or promotion email for the same person.

## 2. SQL sketch (shape only, not the migration)

```sql
CREATE TABLE organizers (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         text NOT NULL UNIQUE CHECK (email = lower(btrim(email))),
  name          text NOT NULL,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email      text NOT NULL UNIQUE CHECK (email = lower(btrim(email))),
  name       text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE events (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organizer_id bigint NOT NULL REFERENCES organizers(id),
  title        text NOT NULL,
  starts_at    timestamptz NOT NULL,
  capacity     integer NOT NULL CHECK (capacity >= 0),
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  cancelled_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_organizer ON events (organizer_id);

CREATE TABLE registrations (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id      bigint NOT NULL REFERENCES events(id),
  user_id       bigint NOT NULL REFERENCES users(id),
  status        text NOT NULL CHECK (status IN ('registered','waitlisted','cancelled')),
  ticket_code   text NOT NULL UNIQUE,
  checked_in_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  cancelled_at  timestamptz,
  CHECK (checked_in_at IS NULL OR status = 'registered')
);
CREATE UNIQUE INDEX registrations_one_active_per_user
  ON registrations (event_id, user_id) WHERE status <> 'cancelled';
CREATE INDEX registrations_waitlist
  ON registrations (event_id, id) WHERE status = 'waitlisted';

CREATE TABLE outbox (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  registration_id bigint NOT NULL REFERENCES registrations(id),
  kind            text NOT NULL CHECK (kind IN ('ticket','promotion','reminder','reschedule','event_cancelled')),
  event_starts_at timestamptz NOT NULL,
  to_email        text NOT NULL,
  subject         text NOT NULL,
  body            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz,
  UNIQUE (registration_id, kind, event_starts_at)
);
```

## 3. How the schema makes each hard behaviour safe

### 3.1 B4 last seat: row lock on the event (test first)
Register and cancel both run in one transaction that starts with `SELECT ... FROM events WHERE id = $1 FOR UPDATE`. Concurrent callers for the same event queue on that row. Then: `count(*) FROM registrations WHERE event_id = $1 AND status = 'registered'`; if below `capacity` insert as `registered`, otherwise as `waitlisted`. Check: capacity 1, 20 parallel registrations with different emails gives exactly 1 `registered` and 19 `waitlisted`.
Different events do not block each other.
Finding the user comes first in the same transaction: `INSERT INTO users (email, name) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING`, then `SELECT id FROM users WHERE email = $1`. Two parallel first-time registrations with the same email end up with one `users` row (the unique email decides). The user row is never locked, so it cannot deadlock with the event lock.

### 3.2 B5 single reminder: unique constraint, not timing (test first)
The worker inserts `kind = 'reminder'` rows with `event_starts_at = events.starts_at` and `ON CONFLICT (registration_id, kind, event_starts_at) DO NOTHING`. `to_email` is taken from `users.email` through `registrations.user_id`. Running the worker 10 times, or two workers at once, leaves one row per registered person per start time. Only `registered` people get a reminder.

### 3.3 B6 single check-in: conditional UPDATE (test first)
```sql
UPDATE registrations r SET checked_in_at = now()
FROM events e
WHERE r.event_id = e.id
  AND e.organizer_id = $organizer AND e.status = 'active'
  AND r.ticket_code = $1 AND r.status = 'registered' AND r.checked_in_at IS NULL
RETURNING r.id;
```
One row returned = checked in. Zero rows = already checked in, cancelled, waiting, unknown code, event cancelled, or a ticket of another organizer's event (the app can read the row afterwards to tell which; for another organizer's ticket it answers the same as for an unknown code). Of 5 parallel calls with one code, exactly one returns a row. Arrivals counter (B7) = `count(*) FROM registrations r JOIN events e ON e.id = r.event_id WHERE r.event_id = $1 AND e.organizer_id = $organizer AND r.checked_in_at IS NOT NULL`.

### 3.4 B1 same email twice
The email is found in `users` (3.1), so the second registration has the same `user_id`. Insert for an existing active (event, user) hits the partial unique index. The app catches it (or checks first, inside the locked transaction) and returns the existing registration: same `ticket_code`, no new row, no new `ticket` outbox row (the outbox unique key blocks it as well). The same email on two different events gives one `users` row and two registrations.

### 3.5 B3 cancel and promote
Same locked transaction as 3.1: set `status = 'cancelled'`, `cancelled_at = now()` on the row; if it was `registered`, take `SELECT ... WHERE event_id = $1 AND status = 'waitlisted' ORDER BY id LIMIT 1`, set it to `registered`, insert one `promotion` outbox row (`to_email` from that person's `users.email`). Cancelling a `waitlisted` row frees no seat and promotes nobody.

### 3.6 B8 reschedule
The lock query carries the ownership check (3.8). `UPDATE events SET starts_at = $new`, then in the same transaction insert one `reschedule` outbox row per `registered` and `waitlisted` person with `event_starts_at = $new`. Old `reminder` rows keep the old `event_starts_at`, so a new reminder for the new time does not conflict with them. Rescheduling to the same time writes nothing new (unique key).

### 3.7 B9 cancel the whole event (test first: no)
One transaction, starting with `SELECT ... FROM events WHERE id = $1 AND organizer_id = $organizer FOR UPDATE` (same lock as 3.1, plus the ownership check of 3.8). If `status` is already `cancelled`, do nothing. Otherwise: `UPDATE events SET status = 'cancelled', cancelled_at = now()`, then insert one `event_cancelled` outbox row per `registered` and `waitlisted` person with `event_starts_at = events.starts_at`. Registration rows are not changed (status stays, history stays). Cancelling twice writes nothing new (the no-op check, and the outbox unique key as a second guard).

Rules for a cancelled event (app rules, each reads `events.status` under the same `FOR UPDATE` lock, so none can race with the cancel):
- Register: rejected with 409 (3.1 transaction).
- Cancel a registration: allowed, but promotes nobody (3.5).
- Reschedule: rejected (3.6).
- Reminders: the worker only selects events with `status = 'active'` (3.2). The outbox unique key still prevents duplicates.
- Check-in: rejected. The conditional UPDATE in 3.3 is joined to the event and has `e.status = 'active'`.

### 3.8 Organizer ownership: the event row decides (test first: no)
Every organizer action must match `events.organizer_id`. The part of the query that enforces it:
- Cancel event (3.7) and reschedule (3.6): `WHERE id = $1 AND organizer_id = $organizer` in the `FOR UPDATE` query that opens the transaction. No row = the transaction stops with 404 and nothing is written.
- Check-in and arrivals counter (3.3): the ticket or registrations are joined to `events` and filtered by `e.organizer_id = $organizer`.
- Organizer event list and counters: `WHERE organizer_id = $organizer` (index `events_organizer`).
Another organizer's event answers 404, the same as a missing event, so ids are not confirmed to strangers. `$organizer` is the logged-in organizer's id from the session, never a value from the request body. Public routes (event page, register, own ticket) are not organizer actions and need no login. Check: organizer A cancelling, rescheduling or checking in on organizer B's event changes nothing and gets 404.

## 4. Behaviour map

| Behaviour | Schema part |
|---|---|
| B1 | `users.email` unique; partial unique index on (event_id, user_id); `ticket_code` unique; outbox `ticket`; email lowercase check |
| B2 | `status`, `capacity`, count under the event lock |
| B3 | waitlist index, order by `id`, outbox `promotion` |
| B4 | `FOR UPDATE` on `events` row (3.1) |
| B5 | outbox `UNIQUE (registration_id, kind, event_starts_at)` (3.2) |
| B6 | `checked_in_at` and the conditional UPDATE joined to the event's `organizer_id` (3.3) |
| B7 | `count` of `checked_in_at IS NOT NULL`, joined to the event's `organizer_id` |
| B8 | `events.starts_at`, outbox `event_starts_at`, `reschedule` rows (3.6) |
| B9 | `events.status`, `events.cancelled_at`, outbox `event_cancelled`, event lock (3.7) |
| Ownership | `events.organizer_id`, `WHERE organizer_id = $organizer` in the locked query and in the check-in join (3.8) |

## 5. Not in this schema

No attendee login or password, no roles or permissions table (an organizer owns events, nothing more), no payments, no real email delivery, no separate ticket, waitlist or reminder tables, no counters.

## 6. Open questions (defaults used)

1. Tickets and registrations are one table (default). Say if you want separate tables.
2. Status values: `registered`, `waitlisted`, `cancelled`. Waiting people also get a `ticket_code` at sign-up, but no `ticket` email. They get a `promotion` email when seated. Is that right, or should the code appear only on promotion?
3. Ticket code: 10 random characters, A-Z and 2-9. Shorter, or a different format?
4. A checked-in person cancelling: the schema forbids `checked_in_at` on a cancelled row, so the app must reject it (409). OK?
5. Reminder timing ("one day before") is worker logic, not schema: `starts_at - 24h <= now() < starts_at`. Someone who registers inside the last 24 hours gets a reminder at the next worker run. OK?
6. Reminders go to `registered` people only, not to the waiting list (the task text I found says "one per person"). Include `waitlisted`?
7. If an event is moved back to an earlier start time it already had, the old `reminder` or `reschedule` rows block a new one (same unique key). Rare; accept for now?
8. Event deletion and editing of capacity are not specified. Lowering capacity below the seats taken does nothing to existing registrations. Is a capacity change in scope at all?
9. `bigint` ids are shown in URLs. Fine for a local project; switch to uuid if you prefer.
10. Cancelling an event leaves registrations as they are (default). Should they also become `cancelled`? That would lose the history of who was seated and who was checked in.
11. Can a cancelled event be re-opened (back to `active`)? Default: no.
12. Cancelling a registration on a cancelled event is allowed but promotes nobody. Reject it instead?
13. Password hashing and the login/session method for organizers are not chosen. Node has `crypto.scrypt` built in; a session cookie or token needs either hand-written code or a library. No new library without your approval. Which method?
14. How do organizers get an account? Default: no sign-up screen; rows are created by a seed script or by hand with `psql`. Add a sign-up route instead?
15. Attendee `users.name`: set only when the user row is created (a later registration with a different name does not change it). Update it on each registration instead?
16. A user row is created when the email is first used and kept forever, also if every registration is later cancelled. Is that OK, or should it be removed?
17. Can an event change owner, and can an organizer be deleted? Default: neither; `organizer_id` is fixed and organizers are never deleted (the FK has no cascade).
18. Another organizer's event answers 404 (default) instead of 403. OK?
