-- Event description (docs/specs/event-description.md DS1, DS2; docs/DATABASE.md
-- section 1, decision 18): a plain text about the event, shown to the organizer
-- and on the public page. '' means no description; never NULL. char_length
-- counts characters (code points), the same unit as the app check. The trim is
-- done in the app only. DEFAULT '' fills rows that already exist and plain SQL
-- inserts in tests; the API always sends a value.
ALTER TABLE events
  ADD COLUMN description text NOT NULL DEFAULT ''
    CHECK (char_length(description) <= 2000);
