-- M6 (docs/specs/email-reminders.md ER1-ER3; docs/DATABASE.md section 1,
-- decision 19): the delivery status of an outbox row. The sender sets `sent`
-- with sent_at, or counts a failed try in send_attempts and gives up after 3
-- with `error_sending` (D56; the limit is app logic, not a CHECK). send_error is
-- the short reason of the last failed try, never the body or an address. The
-- backfill runs before the consistency CHECK, so rows that exist pass it. The
-- unique key (registration_id, kind, schedule_version) is not touched.
ALTER TABLE outbox
  ADD COLUMN status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'error_sending')),
  ADD COLUMN send_attempts integer NOT NULL DEFAULT 0 CHECK (send_attempts >= 0),
  ADD COLUMN send_error text;
UPDATE outbox SET status = 'sent' WHERE sent_at IS NOT NULL;
ALTER TABLE outbox
  ADD CONSTRAINT outbox_status_sent_at CHECK ((status = 'sent') = (sent_at IS NOT NULL));
