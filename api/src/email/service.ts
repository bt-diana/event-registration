import type pg from "pg";

// docs/specs/email-outbox.md (OB2-OB13, OB16-OB18; D60, D61, D62): the emails
// (outbox rows) of one of the organizer's own events, optionally of one
// registration, newest first, at most 200. Read only.

export const EMAIL_KINDS = ["ticket", "promotion", "reminder", "reschedule", "event_cancelled"] as const;
export const EMAIL_STATUSES = ["pending", "sent", "error_sending"] as const;

export type EmailKind = (typeof EMAIL_KINDS)[number];
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

const CAP = 200;

export type EmailRow = {
  id: string;
  registration_id: string;
  kind: EmailKind;
  status: EmailStatus;
  send_attempts: number;
  send_error: string | null;
  to_email: string;
  subject: string;
  schedule_version: number;
  event_starts_at: Date;
  created_at: Date;
  sent_at: Date | null;
  attendee_name: string;
};

export type EmailFilters = { kind?: EmailKind; status?: EmailStatus; registrationId?: string };

export type ListEmailsResult = { kind: "not_found" } | { kind: "ok"; rows: EmailRow[]; truncated: boolean };

// One statement, no lock, no transaction. The event row is the ownership check;
// the lateral join keeps one row when an owned event has no matching email, so
// "no row" is only the 404. The registration filter is inside the subquery: a
// registration of another event gives the same empty list as an attendee with
// no emails, never a 404 (OB17). The body is never selected (OB4). LIMIT is
// the cap + 1, to know whether rows were cut (OB10).
const LIST_EMAILS_SQL = `SELECT x.*
  FROM events e
  LEFT JOIN LATERAL (
    SELECT o.id, o.registration_id, o.kind, o.status, o.send_attempts, o.send_error,
           o.to_email, o.subject, o.schedule_version, o.event_starts_at,
           o.created_at, o.sent_at, u.name AS attendee_name
      FROM outbox o
      JOIN registrations r ON r.id = o.registration_id
      JOIN users u ON u.id = r.user_id
     WHERE r.event_id = e.id
       AND ($3::text IS NULL OR o.kind = $3)
       AND ($4::text IS NULL OR o.status = $4)
       AND ($5::uuid IS NULL OR o.registration_id = $5)
     ORDER BY o.created_at DESC, o.id
     LIMIT ${CAP + 1}
  ) x ON true
 WHERE e.id = $1 AND e.organizer_id = $2
 ORDER BY x.created_at DESC NULLS LAST, x.id`;

export async function listEmails(
  pool: pg.Pool,
  organizerId: string,
  eventId: string,
  filters: EmailFilters,
): Promise<ListEmailsResult> {
  const { rows } = await pool.query<EmailRow | { [K in keyof EmailRow]: null }>(LIST_EMAILS_SQL, [
    eventId,
    organizerId,
    filters.kind ?? null,
    filters.status ?? null,
    filters.registrationId ?? null,
  ]);
  if (rows.length === 0) return { kind: "not_found" };
  const emails = rows.filter((row): row is EmailRow => row.id !== null);
  return { kind: "ok", rows: emails.slice(0, CAP), truncated: emails.length > CAP };
}

// docs/specs/email-reminders.md (ER48-ER60, D74): the emails of one
// registration of one of the organizer's own events, newest first, all rows (a
// registration has a handful by the unique key, ER57). Read only.

export type RegistrationEmailRow = {
  id: string;
  kind: EmailKind;
  status: EmailStatus;
  to_email: string;
  subject: string;
  created_at: Date;
  sent_at: Date | null;
  send_attempts: number;
  send_error: string | null;
};

export type ListRegistrationEmailsResult =
  | { kind: "not_found" }
  | { kind: "ok"; attendeeName: string; rows: RegistrationEmailRow[] };

// One statement, no lock, no transaction. The registration row is the ownership
// check: `r.event_id = $1` makes a registration of another event look like an
// unknown one, `e.organizer_id = $3` does the same for a foreign event (ER49).
// The left join keeps one row with a NULL id when the registration has no
// email, so "no row" is only the 404 (ER56). The body is never selected (ER51).
const LIST_REGISTRATION_EMAILS_SQL = `SELECT u.name AS attendee_name,
       o.id, o.kind, o.status, o.to_email, o.subject,
       o.created_at, o.sent_at, o.send_attempts, o.send_error
  FROM registrations r
  JOIN events e ON e.id = r.event_id
  JOIN users u ON u.id = r.user_id
  LEFT JOIN outbox o ON o.registration_id = r.id
 WHERE r.id = $2 AND r.event_id = $1 AND e.organizer_id = $3
 ORDER BY o.created_at DESC NULLS LAST, o.id`;

type JoinedRow = { attendee_name: string } & (RegistrationEmailRow | { [K in keyof RegistrationEmailRow]: null });

export async function listRegistrationEmails(
  pool: pg.Pool,
  organizerId: string,
  eventId: string,
  registrationId: string,
): Promise<ListRegistrationEmailsResult> {
  const { rows } = await pool.query<JoinedRow>(LIST_REGISTRATION_EMAILS_SQL, [eventId, registrationId, organizerId]);
  if (rows.length === 0) return { kind: "not_found" };
  const emails = rows.filter((row): row is { attendee_name: string } & RegistrationEmailRow => row.id !== null);
  return { kind: "ok", attendeeName: rows[0].attendee_name, rows: emails };
}
