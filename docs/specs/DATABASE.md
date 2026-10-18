# Spec: Database schema

Part of `SPEC.md` (section 3). PostgreSQL 18, Windows service, port 5433, `DATABASE_URL`, no Docker. Migrations are plain `.sql` files in `api/src/db/migrations/`, applied in file-name order. This file says what the schema must guarantee. It is not the migration.

Three tables: `events`, `registrations`, `outbox`. A ticket is a registration row (one table, no separate `tickets`). No other tables.

## 1. Tables

### events

| Column | Type | Rule | Supports |
|---|---|---|---|
| id | bigint, identity, PK | | all |
| title | text NOT NULL | | |
| starts_at | timestamptz NOT NULL | changed by reschedule | B5, B8 |
| capacity | integer NOT NULL | `CHECK (capacity >= 0)` | B2, B4 |
| created_at | timestamptz NOT NULL DEFAULT now() | | |

No `seats_taken` counter: seats used = `count(*)` of `registered` rows for the event (see 3.1). Less state, nothing to drift.

### registrations (one row = one person on one event = one ticket)

| Column | Type | Rule | Supports |
|---|---|---|---|
| id | bigint, identity, PK | also the waiting-list order | B2, B3 |
| event_id | bigint NOT NULL, FK to events(id) | | |
| email | text NOT NULL | `CHECK (email = lower(btrim(email)))`; the app lowercases and trims before insert | B1 |
| status | text NOT NULL | `CHECK (status IN ('registered','waitlisted','cancelled'))` | B1-B3 |
| ticket_code | text NOT NULL, UNIQUE | random, 10 chars, A-Z and 2-9 (no 0/O/1/I); made by the app | B1, B6 |
| checked_in_at | timestamptz NULL | NULL = not arrived | B6, B7 |
| created_at | timestamptz NOT NULL DEFAULT now() | | |
| cancelled_at | timestamptz NULL | | |

Constraints:
- `CREATE UNIQUE INDEX registrations_one_active_per_email ON registrations (event_id, email) WHERE status <> 'cancelled';` Same email twice cannot make two seats or two list places (B1). A cancelled person may register again as a new row.
- `CHECK (checked_in_at IS NULL OR status = 'registered')`. Only seated people arrive (B6).
- `CREATE INDEX registrations_waitlist ON registrations (event_id, id) WHERE status = 'waitlisted';` Finds the first waiting person fast (B3).
- Waiting-list order = `ORDER BY id` among `waitlisted` rows. `id` is assigned in insert order, so it is first come, first served (B2, B3).

### outbox (the stub email: a row is the email, the sender prints it and sets `sent_at`)

| Column | Type | Rule | Supports |
|---|---|---|---|
| id | bigint, identity, PK | | |
| registration_id | bigint NOT NULL, FK to registrations(id) | | |
| kind | text NOT NULL | `CHECK (kind IN ('ticket','promotion','reminder','reschedule'))` | B1, B3, B5, B8 |
| event_starts_at | timestamptz NOT NULL | copy of `events.starts_at` when the row was written | B5, B8 |
| to_email | text NOT NULL | | |
| subject | text NOT NULL | | |
| body | text NOT NULL | | |
| created_at | timestamptz NOT NULL DEFAULT now() | | |
| sent_at | timestamptz NULL | NULL = not printed yet | |

Constraint: `UNIQUE (registration_id, kind, event_starts_at)`. This is the whole "once" rule for B5 (see 3.2). It also stops a second ticket or promotion email for the same person.

## 2. SQL sketch (shape only, not the migration)

```sql
CREATE TABLE events (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title      text NOT NULL,
  starts_at  timestamptz NOT NULL,
  capacity   integer NOT NULL CHECK (capacity >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE registrations (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id      bigint NOT NULL REFERENCES events(id),
  email         text NOT NULL CHECK (email = lower(btrim(email))),
  status        text NOT NULL CHECK (status IN ('registered','waitlisted','cancelled')),
  ticket_code   text NOT NULL UNIQUE,
  checked_in_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  cancelled_at  timestamptz,
  CHECK (checked_in_at IS NULL OR status = 'registered')
);
CREATE UNIQUE INDEX registrations_one_active_per_email
  ON registrations (event_id, email) WHERE status <> 'cancelled';
CREATE INDEX registrations_waitlist
  ON registrations (event_id, id) WHERE status = 'waitlisted';

CREATE TABLE outbox (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  registration_id bigint NOT NULL REFERENCES registrations(id),
  kind            text NOT NULL CHECK (kind IN ('ticket','promotion','reminder','reschedule')),
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

### 3.2 B5 single reminder: unique constraint, not timing (test first)
The worker inserts `kind = 'reminder'` rows with `event_starts_at = events.starts_at` and `ON CONFLICT (registration_id, kind, event_starts_at) DO NOTHING`. Running the worker 10 times, or two workers at once, leaves one row per registered person per start time. Only `registered` people get a reminder.

### 3.3 B6 single check-in: conditional UPDATE (test first)
```sql
UPDATE registrations SET checked_in_at = now()
WHERE ticket_code = $1 AND status = 'registered' AND checked_in_at IS NULL
RETURNING id;
```
One row returned = checked in. Zero rows = already checked in, cancelled, waiting, or unknown code (the app can read the row afterwards to tell which). Of 5 parallel calls with one code, exactly one returns a row. Arrivals counter (B7) = `count(*) WHERE event_id = $1 AND checked_in_at IS NOT NULL`.

### 3.4 B1 same email twice
Insert for an existing active (event, email) hits the partial unique index. The app catches it (or checks first, inside the locked transaction) and returns the existing registration: same `ticket_code`, no new row, no new `ticket` outbox row (the outbox unique key blocks it as well).

### 3.5 B3 cancel and promote
Same locked transaction as 3.1: set `status = 'cancelled'`, `cancelled_at = now()` on the row; if it was `registered`, take `SELECT ... WHERE event_id = $1 AND status = 'waitlisted' ORDER BY id LIMIT 1`, set it to `registered`, insert one `promotion` outbox row. Cancelling a `waitlisted` row frees no seat and promotes nobody.

### 3.6 B8 reschedule
`UPDATE events SET starts_at = $new`, then in the same transaction insert one `reschedule` outbox row per `registered` and `waitlisted` person with `event_starts_at = $new`. Old `reminder` rows keep the old `event_starts_at`, so a new reminder for the new time does not conflict with them. Rescheduling to the same time writes nothing new (unique key).

## 4. Behaviour map

| Behaviour | Schema part |
|---|---|
| B1 | partial unique index on (event_id, email); `ticket_code` unique; outbox `ticket`; email lowercase check |
| B2 | `status`, `capacity`, count under the event lock |
| B3 | waitlist index, order by `id`, outbox `promotion` |
| B4 | `FOR UPDATE` on `events` row (3.1) |
| B5 | outbox `UNIQUE (registration_id, kind, event_starts_at)` (3.2) |
| B6 | `checked_in_at` and the conditional UPDATE (3.3) |
| B7 | `count` of `checked_in_at IS NOT NULL` |
| B8 | `events.starts_at`, outbox `event_starts_at`, `reschedule` rows (3.6) |

## 5. Not in this schema

No users or accounts, no organizer table (shared key from an environment variable), no payments, no real email delivery, no separate ticket, waitlist or reminder tables, no counters.

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
