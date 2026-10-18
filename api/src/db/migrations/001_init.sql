-- Initial schema. See docs/DATABASE.md.
-- uuidv7() is built in since PostgreSQL 18.

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
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organizer_id     uuid NOT NULL REFERENCES organizers(id),
  title            text NOT NULL,
  starts_at        timestamptz NOT NULL,
  schedule_version integer NOT NULL DEFAULT 1,
  capacity         integer NOT NULL CHECK (capacity >= 0),
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  cancelled_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_organizer ON events (organizer_id);

CREATE TABLE registrations (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  queue_no      bigint GENERATED ALWAYS AS IDENTITY,
  event_id      uuid NOT NULL REFERENCES events(id),
  user_id       uuid NOT NULL REFERENCES users(id),
  status        text NOT NULL CHECK (status IN ('registered', 'waitlisted', 'cancelled')),
  ticket_code   text NOT NULL UNIQUE,
  checked_in_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  cancelled_at  timestamptz,
  CHECK (checked_in_at IS NULL OR status = 'registered')
);
-- B1: one active registration per account per event.
CREATE UNIQUE INDEX registrations_one_active_per_user
  ON registrations (event_id, user_id) WHERE status <> 'cancelled';
-- B3, B10: the first waiting person, in queue_no order.
CREATE INDEX registrations_waitlist
  ON registrations (event_id, queue_no) WHERE status = 'waitlisted';

CREATE TABLE outbox (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  registration_id  uuid NOT NULL REFERENCES registrations(id),
  kind             text NOT NULL CHECK (kind IN ('ticket', 'promotion', 'reminder', 'reschedule', 'event_cancelled')),
  schedule_version integer NOT NULL,
  event_starts_at  timestamptz NOT NULL,
  to_email         text NOT NULL,
  subject          text NOT NULL,
  body             text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  sent_at          timestamptz,
  -- B5: one email of each kind per registration per schedule version.
  UNIQUE (registration_id, kind, schedule_version)
);
