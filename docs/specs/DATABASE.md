# Spec: Database schema

Part of `SPEC_TEMPLATE.md` (section 3). PostgreSQL 18, Windows service, port 5433, `DATABASE_URL`, no Docker. Migrations are plain `.sql` files in `api/src/db/migrations/`, applied in file-name order. This file says what the schema must guarantee. It is not the migration.

Five tables: `organizers`, `users`, `events`, `registrations`, `outbox`. A ticket is a registration row (one table, no separate `tickets`). No other tables.

- `users` are attendees. They sign up (email, name, password) and log in. Registering for an event needs a signed-in attendee; the email comes from the account.
- `organizers` sign up, log in and own events. An organizer is not an attendee, so the two tables are separate.
- Ids are `uuid PRIMARY KEY DEFAULT uuidv7()` (built in since PostgreSQL 18). All foreign keys are `uuid`.
- Login is a signed cookie that lasts 7 days (default, the user can change it), no sessions table (see `SPEC_TEMPLATE.md` section 3). Passwords are stored only as a `scrypt` hash with a random salt in `password_hash`.

## 1. Tables

### organizers

| Column | Type | Rule | Supports |
|---|---|---|---|
| id | uuid, PK, DEFAULT uuidv7() | | all |
| email | text NOT NULL, UNIQUE | `CHECK (email = lower(btrim(email)))`; the login name | |
| name | text NOT NULL | | |
| password_hash | text NOT NULL | scrypt hash with its salt, never the password | |
| created_at | timestamptz NOT NULL DEFAULT now() | | |

### users (attendees)

| Column | Type | Rule | Supports |
|---|---|---|---|
| id | uuid, PK, DEFAULT uuidv7() | | all |
| email | text NOT NULL, UNIQUE | `CHECK (email = lower(btrim(email)))`; the login name; the unique key stops two accounts with one email | B1 |
| name | text NOT NULL | set at sign-up; the only place a name is stored | |
| password_hash | text NOT NULL | scrypt hash with its salt, never the password | |
| created_at | timestamptz NOT NULL DEFAULT now() | | |

### events

| Column | Type | Rule | Supports |
|---|---|---|---|
| id | uuid, PK, DEFAULT uuidv7() | | all |
| organizer_id | uuid NOT NULL, FK to organizers(id) | the owner; only this organizer manages the event | ownership (3.8) |
| title | text NOT NULL | | |
| starts_at | timestamptz NOT NULL | changed by reschedule | B5, B8 |
| duration_minutes | integer NOT NULL DEFAULT 60 | `CHECK (duration_minutes > 0 AND duration_minutes <= 1440)`; the end is `starts_at + duration_minutes * interval '1 minute'`; added by migration `002_event_duration.sql` (see below) | derived `passed` status (3.10), M2 |
| schedule_version | integer NOT NULL DEFAULT 1 | +1 on every reschedule that changes `starts_at`, in the 3.6 locked transaction | B5, B8 |
| capacity | integer NOT NULL | `CHECK (capacity >= 0)`; changed by B10 | B2, B4, B10 |
| status | text NOT NULL DEFAULT 'active' | `CHECK (status IN ('active','cancelled'))`; the whole event is cancelled | B9 |
| cancelled_at | timestamptz NULL | set when the event is cancelled | B9 |
| created_at | timestamptz NOT NULL DEFAULT now() | | |

Index: `CREATE INDEX events_organizer ON events (organizer_id);` lists an organizer's events.

**Duration comes as a new migration.** `001` is already applied and is not edited. `api/src/db/migrations/002_event_duration.sql` runs `ALTER TABLE events ADD COLUMN duration_minutes integer NOT NULL DEFAULT 60 CHECK (duration_minutes > 0 AND duration_minutes <= 1440);`. The `DEFAULT 60` is kept on purpose: (a) `ADD COLUMN ... NOT NULL` needs a value for rows that already exist, and (b) the existing tests in `api/test/db/` insert events with plain SQL without a duration and must keep working. The API never relies on it: `POST /events` requires `duration_minutes` (see `events.md`). The stored `status` column is not changed (still `'active'`/`'cancelled'`); `passed` is not stored (3.10).

No `seats_taken` counter: seats used = `count(*)` of `registered` rows for the event (see 3.1). Less state, nothing to drift.

### registrations (one row = one person on one event = one ticket)

| Column | Type | Rule | Supports |
|---|---|---|---|
| id | uuid, PK, DEFAULT uuidv7() | not used for ordering (uuidv7 is not strictly ordered between connections) | |
| queue_no | bigint GENERATED ALWAYS AS IDENTITY | assigned at insert, inside the event lock, so it follows lock order; the waiting-list order | B2, B3, B10 |
| event_id | uuid NOT NULL, FK to events(id) | | |
| user_id | uuid NOT NULL, FK to users(id) | the attendee; name and email are read from `users`, not copied here | B1 |
| status | text NOT NULL | `CHECK (status IN ('registered','waitlisted','cancelled'))` | B1-B3 |
| ticket_code | text NOT NULL, UNIQUE | random, 10 chars, A-Z and 2-9 (no 0/O/1/I); made by the app | B1, B6 |
| checked_in_at | timestamptz NULL | NULL = not arrived | B6, B7 |
| created_at | timestamptz NOT NULL DEFAULT now() | | |
| cancelled_at | timestamptz NULL | | |

Constraints:
- `CREATE UNIQUE INDEX registrations_one_active_per_user ON registrations (event_id, user_id) WHERE status <> 'cancelled';` The same account twice cannot make two seats or two list places (B1). A cancelled person may register again as a new row.
- `CHECK (checked_in_at IS NULL OR status = 'registered')`. Only seated people arrive (B6).
- `CREATE INDEX registrations_waitlist ON registrations (event_id, queue_no) WHERE status = 'waitlisted';` Finds the first waiting person fast (B3, B10).
- Waiting-list order = `ORDER BY queue_no` among `waitlisted` rows. First come, first served, in the order the event lock was granted.

### outbox (the stub email: a row is the email, the sender prints it and sets `sent_at`)

| Column | Type | Rule | Supports |
|---|---|---|---|
| id | uuid, PK, DEFAULT uuidv7() | | |
| registration_id | uuid NOT NULL, FK to registrations(id) | | |
| kind | text NOT NULL | `CHECK (kind IN ('ticket','promotion','reminder','reschedule','event_cancelled'))` | B1, B3, B5, B8, B9, B10 |
| schedule_version | integer NOT NULL | copy of `events.schedule_version` when the row was written; part of the unique key | B5, B8 |
| event_starts_at | timestamptz NOT NULL | copy of `events.starts_at` when the row was written; informational (for the email text), not in the key | B5, B8 |
| to_email | text NOT NULL | copy of `users.email` when the row was written; a log, so a sent email stays as it was | |
| subject | text NOT NULL | | |
| body | text NOT NULL | | |
| created_at | timestamptz NOT NULL DEFAULT now() | | |
| sent_at | timestamptz NULL | NULL = not printed yet | |

Constraint: `UNIQUE (registration_id, kind, schedule_version)`. This is the whole "once" rule for B5 (see 3.2): one reminder and one reschedule email per person per schedule version, so A -> B -> A -> B still emails each move. For `ticket`, `promotion` and `event_cancelled` it is only a second guard: each is written once per registration by the app under the event lock (3.4, 3.5, 3.7), and it stops a repeat within one version.

## 2. SQL sketch (shape only, not the migration)

```sql
CREATE TABLE organizers (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  email         text NOT NULL UNIQUE CHECK (email = lower(btrim(email))),
  name          text NOT NULL,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  email         text NOT NULL UNIQUE CHECK (email = lower(btrim(email))),
  name          text NOT NULL,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE events (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  organizer_id uuid NOT NULL REFERENCES organizers(id),
  title        text NOT NULL,
  starts_at    timestamptz NOT NULL,
  -- duration_minutes is added by 002_event_duration.sql, not by 001:
  --   ALTER TABLE events ADD COLUMN duration_minutes integer NOT NULL DEFAULT 60
  --     CHECK (duration_minutes > 0 AND duration_minutes <= 1440);
  schedule_version integer NOT NULL DEFAULT 1,
  capacity     integer NOT NULL CHECK (capacity >= 0),
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  cancelled_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_organizer ON events (organizer_id);

CREATE TABLE registrations (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  queue_no      bigint GENERATED ALWAYS AS IDENTITY,
  event_id      uuid NOT NULL REFERENCES events(id),
  user_id       uuid NOT NULL REFERENCES users(id),
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
  ON registrations (event_id, queue_no) WHERE status = 'waitlisted';

CREATE TABLE outbox (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  registration_id uuid NOT NULL REFERENCES registrations(id),
  kind            text NOT NULL CHECK (kind IN ('ticket','promotion','reminder','reschedule','event_cancelled')),
  schedule_version integer NOT NULL,
  event_starts_at timestamptz NOT NULL,
  to_email        text NOT NULL,
  subject         text NOT NULL,
  body            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz,
  UNIQUE (registration_id, kind, schedule_version)
);
```

## 3. How the schema makes each hard behaviour safe

### 3.1 B4 last seat: row lock on the event (test first)
Register and cancel both run in one transaction that starts with `SELECT ... FROM events WHERE id = $1 FOR UPDATE`. Concurrent callers for the same event queue on that row. Then: `count(*) FROM registrations WHERE event_id = $1 AND status = 'registered'`; if below `capacity` insert as `registered`, otherwise as `waitlisted`. The `user_id` is the signed-in attendee from the cookie, never from the request body. Check: capacity 1, 20 parallel registrations by 20 different attendees gives exactly 1 `registered` and 19 `waitlisted`.
Different events do not block each other. The `users` row is only read, never locked, so it cannot deadlock with the event lock.

### 3.2 B5 single reminder: unique constraint, not timing (test first)
The worker inserts `kind = 'reminder'` rows with `schedule_version = events.schedule_version`, `event_starts_at = events.starts_at` and `ON CONFLICT (registration_id, kind, schedule_version) DO NOTHING`. It reads the event columns in the same `INSERT ... SELECT` statement, so version and time cannot come from different moments. `to_email` is taken from `users.email` through `registrations.user_id`. Running the worker 10 times, or two workers at once, leaves one row per registered person per schedule version. Only `registered` people get a reminder.

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

### 3.4 B1 same person twice
The attendee is the signed-in account, so the second registration has the same `user_id`. Insert for an existing active (event, user) hits the partial unique index. The app catches it (or checks first, inside the locked transaction) and returns the existing registration: same `ticket_code`, no new row, no new `ticket` outbox row (the outbox unique key blocks it as well). Two accounts with one email cannot exist (unique `users.email`). The same account on two different events gives two registrations.

### 3.5 B3 cancel and promote
Same locked transaction as 3.1: set `status = 'cancelled'`, `cancelled_at = now()` on the row; if it was `registered`, take `SELECT ... WHERE event_id = $1 AND status = 'waitlisted' ORDER BY queue_no LIMIT 1`, set it to `registered`, insert one `promotion` outbox row (`to_email` from that person's `users.email`). Cancelling a `waitlisted` row frees no seat and promotes nobody. A checked-in registration cannot be cancelled: rejected with 409 (the CHECK would also fail).

### 3.6 B8 reschedule
The lock query carries the ownership check (3.8). If `$new` equals the current `starts_at`: a no-op, no version bump, nothing written. Otherwise `UPDATE events SET starts_at = $new, schedule_version = schedule_version + 1`, then in the same transaction insert one `reschedule` outbox row per `registered` and `waitlisted` person with the new `schedule_version` and `event_starts_at = $new`. Old `reminder` rows keep the old version, so a new reminder for the new version does not conflict with them, even when the event returns to an earlier time (A -> B -> A -> B). Only active events can be rescheduled.

### 3.7 B9 cancel the whole event (test first: no)
One transaction, starting with `SELECT ... FROM events WHERE id = $1 AND organizer_id = $organizer FOR UPDATE` (same lock as 3.1, plus the ownership check of 3.8). If `status` is already `cancelled`, do nothing. If `starts_at <= now()` (checked here, under the lock): rejected with 409, nothing written; an event that has already started cannot be cancelled. Otherwise: `UPDATE events SET status = 'cancelled', cancelled_at = now()`. Then for every `registered` (not checked in) and `waitlisted` registration: insert one `event_cancelled` outbox row with the current `schedule_version` and `event_starts_at = events.starts_at`, and set `status = 'cancelled'`, `cancelled_at = now()`. Registrations already checked in stay as they are (the CHECK allows `checked_in_at` only on `registered` rows) and get no email; this is now rare, because cancelling is only possible before the start, so only someone who checked in early is left. Cancelling twice writes nothing new (the no-op check, and the outbox unique key as a second guard). A cancelled event cannot be re-opened.

Rules for a cancelled event (app rules, each reads `events.status` under the same `FOR UPDATE` lock, so none can race with the cancel):
- Register: rejected with 409 (3.1 transaction).
- Cancel a registration: a no-op, the people are already cancelled (checked-in people still get 409, see 3.5). It promotes nobody.
- Reschedule and capacity change: rejected (3.6, 3.9).
- Reminders: the worker only selects events with `status = 'active'` (3.2). The outbox unique key still prevents duplicates.
- Check-in: rejected. The conditional UPDATE in 3.3 is joined to the event and has `e.status = 'active'`.

### 3.8 Organizer ownership: the event row decides (test first: no)
Every organizer action must match `events.organizer_id`. The part of the query that enforces it:
- Cancel event (3.7), reschedule (3.6) and capacity change (3.9): `WHERE id = $1 AND organizer_id = $organizer` in the `FOR UPDATE` query that opens the transaction. No row = the transaction stops with 404 and nothing is written.
- Check-in and arrivals counter (3.3): the ticket or registrations are joined to `events` and filtered by `e.organizer_id = $organizer`.
- Organizer event list and counters: `WHERE organizer_id = $organizer` (index `events_organizer`).
Another organizer's event answers 404, the same as a missing event, so ids are not confirmed to strangers. `$organizer` is the logged-in organizer's id from the signed cookie, never a value from the request body. The public event page needs no login; registering and seeing or cancelling one's own ticket need a signed-in attendee. Check: organizer A cancelling, rescheduling, changing capacity or checking in on organizer B's event changes nothing and gets 404.

### 3.9 B10 change capacity (test first: no)
Same locked transaction as 3.6/3.7: `SELECT ... FROM events WHERE id = $1 AND organizer_id = $organizer FOR UPDATE`, only if `status = 'active'`. Count `registered` rows. If `$new < count`: stop with 409 and a warning that says how many people are registered; nothing is written. Otherwise `UPDATE events SET capacity = $new`, then promote the first waitlisted people by `queue_no` until the free seats are filled (`$new - count` people at most), each with a `promotion` outbox row (decision 15). Lowering to a value at or above the registered count promotes nobody and changes no registration.

### 3.10 Derived event status `passed` (M2, test first: no)
`passed` is never stored: no worker, no CHECK change. The API status is computed at read time from the stored columns: `cancelled` if `events.status = 'cancelled'`, else `passed` if `now() >= starts_at + duration_minutes * interval '1 minute'`, else `active`. Cancelled wins over passed. In this file, "active" and "cancelled" in rules 3.1-3.9 always mean the stored column; the wording still holds. Effects on later milestones (behaviour not changed here, to be decided in their specs):
- 3.2 reminders: no effect, the 24-hour window (`now() < starts_at`) already excludes ended events.
- 3.7 cancel event: no effect, `starts_at <= now()` already rejects started events, which includes passed ones (and events in progress).
- 3.1 register: a passed event is still stored `active`, so the lock rules would accept a registration. M3 should decide whether to reject it (suggested: 409, as for cancelled).
- 3.3 check-in: the conditional UPDATE needs stored `active`, so a passed event still allows check-in. M5 should decide (suggested: allow, late arrivals are real).
- 3.6 reschedule and 3.9 capacity: a passed event is stored `active`, so they would be accepted. M4 and M7 should decide (suggested: reject, as for cancelled). A reschedule would also need to keep `duration_minutes`, so the end moves with the start.

## 4. Behaviour map

| Behaviour | Schema part |
|---|---|
| B1 | `users.email` unique; partial unique index on (event_id, user_id); `ticket_code` unique; outbox `ticket`; email lowercase check |
| B2 | `status`, `capacity`, count under the event lock |
| B3 | waitlist index, order by `queue_no`, outbox `promotion` |
| B4 | `FOR UPDATE` on `events` row (3.1) |
| B5 | `events.schedule_version`; outbox `UNIQUE (registration_id, kind, schedule_version)` (3.2) |
| B6 | `checked_in_at` and the conditional UPDATE joined to the event's `organizer_id` (3.3) |
| B7 | `count` of `checked_in_at IS NOT NULL`, joined to the event's `organizer_id` |
| B8 | `events.starts_at`, `events.schedule_version`, outbox `schedule_version`, `reschedule` rows (3.6) |
| B9 | `events.status`, `events.cancelled_at`, registrations set to `cancelled`, outbox `event_cancelled`, event lock, 409 once `starts_at <= now()` (3.7) |
| B10 | `events.capacity`, count under the event lock, `queue_no` order, outbox `promotion` (3.9) |
| Event status `passed` (M2) | `events.starts_at` + `events.duration_minutes`, computed at read time, nothing stored (3.10) |
| Ownership | `events.organizer_id`, `WHERE organizer_id = $organizer` in the locked query and in the check-in join (3.8) |

## 5. Not in this schema

No sessions table (signed cookie), no roles or permissions table (an organizer owns events, nothing more), no payments, no real email delivery, no separate ticket, waitlist or reminder tables, no counters.

## 6. Decisions

1. Tickets and registrations are one table.
2. Waiting people get a `ticket_code` at sign-up and no `ticket` email; they get a `promotion` email when seated.
3. Ticket code: 10 random characters, A-Z and 2-9.
4. Cancelling a checked-in ticket is rejected with 409.
5. The 24-hour reminder window (`starts_at - 24h <= now() < starts_at`) is worker logic, not schema.
6. Reminders go to `registered` people only, not to the waiting list.
7. Ids are uuid (uuidv7); waiting-list order uses `queue_no`.
8. The attendee name lives only in `users.name`; `registrations` has only `user_id`. `outbox.to_email` stays a copy because it is a log.
9. User rows are kept forever. An event never changes owner and organizers are never deleted (no cascade).
10. Another organizer's event answers 404, not 403.
11. A cancelled event cannot be re-opened.
12. Login is a signed cookie via `cookie-parser`; passwords use `crypto.scrypt` with a random salt, no new library. Both attendees and organizers sign up themselves; no seed script.
13. `events.schedule_version` (+1 per reschedule) is in the outbox unique key instead of `event_starts_at`, so a reschedule loop A -> B -> A -> B emails and reminds every time. Rescheduling to the same time is a no-op. `outbox.event_starts_at` stays as an informational copy.
14. An event that has already started (`starts_at <= now()`) cannot be cancelled: 409. Already checked-in people are left alone by a cancel.
15. Raising capacity promotes the first waitlisted people by `queue_no`, each with a `promotion` email.
16. The login cookie lasts 7 days. This is a default, the user can change it.

17. An event has a `duration_minutes` (1 to 1440). Its status `passed` is derived at read time once `starts_at + duration` is reached; it is not stored (3.10). Added by migration `002_event_duration.sql`, not by editing `001`.

## 7. Open questions

None.
