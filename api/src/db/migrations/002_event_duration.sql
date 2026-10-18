-- M2 (docs/DATABASE.md section 1, decision 17): an event has a duration.
-- The end is starts_at + duration_minutes minutes; the status `passed` is
-- derived from it at read time and never stored (3.10). DEFAULT 60 fills rows
-- that already exist and plain SQL inserts in tests; the API always sends a value.
ALTER TABLE events
  ADD COLUMN duration_minutes integer NOT NULL DEFAULT 60
    CHECK (duration_minutes > 0 AND duration_minutes <= 1440);
