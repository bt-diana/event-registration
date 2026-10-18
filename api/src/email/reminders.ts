import type pg from "pg";

// docs/specs/email-reminders.md ER18-ER31 (B5, DATABASE.md 3.2). One reminder
// row per seated person who is not checked in, on an active event, in the 24
// hours before its start, once per schedule version. One INSERT ... SELECT
// statement: version and start come from the event in the same statement, and
// the unique key (registration_id, kind, schedule_version) is the whole "once"
// rule, so 10 runs or parallel workers write each row once. The key counts
// rows of every status, so a sent or error_sending reminder blocks a second
// one (ER31). $1 is the injected clock; neither Date.now() nor SQL now() is
// used for the window (ER26). No timer, no transport, nothing printed.
const ENQUEUE_SQL = `INSERT INTO outbox (registration_id, kind, schedule_version, event_starts_at, to_email, subject, body)
SELECT r.id, 'reminder', e.schedule_version, e.starts_at, u.email,
       'Reminder: ' || e.title || ' starts soon',
       e.title || E'\\n' || 'Starts: ' || to_char(e.starts_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') || ' (UTC)'
         || E'\\n' || 'Ticket code: ' || r.ticket_code
  FROM registrations r
  JOIN events e ON e.id = r.event_id
  JOIN users u ON u.id = r.user_id
 WHERE r.status = 'registered' AND r.checked_in_at IS NULL
   AND e.status = 'active'
   AND e.starts_at - interval '24 hours' <= $1::timestamptz
   AND $1::timestamptz < e.starts_at
ON CONFLICT (registration_id, kind, schedule_version) DO NOTHING`;

// Returns the number of rows inserted.
export async function enqueueReminders(pool: pg.Pool, now: Date): Promise<number> {
  const result = await pool.query(ENQUEUE_SQL, [now]);
  return result.rowCount ?? 0;
}
