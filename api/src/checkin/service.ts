import type pg from "pg";
import { REGISTRATION_COLUMNS, type RegistrationRow } from "../registrations/service.js";

// docs/specs/checkin.md (M5). The check-in of a ticket (B6, C3-C13) and the
// organizer registrations list (C15-C18).

export type CheckedInRow = {
  registration_id: string;
  ticket_code: string;
  event_id: string;
  event_title: string;
  attendee_name: string;
  checked_in_at: Date;
};

export type CheckInResult =
  | { kind: "ok"; row: CheckedInRow }
  | { kind: "not_found" }
  | { kind: "refused"; error: "event_cancelled" | "registration_cancelled" | "waitlisted" }
  | { kind: "already_checked_in"; checked_in_at: Date; attendee_name: string };

type TicketState = {
  status: "registered" | "waitlisted" | "cancelled";
  checked_in_at: Date | null;
  event_status: "active" | "cancelled";
  attendee_name: string;
};

// DATABASE.md 3.3: one conditional UPDATE, no lock, no explicit transaction.
// e.status is the stored column, so a passed or not yet started event allows
// check-in (C10, C11). Only checked_in_at of the one row changes (C13).
const CHECK_IN_SQL = `UPDATE registrations r SET checked_in_at = now()
  FROM events e, users u
 WHERE r.event_id = e.id AND u.id = r.user_id
   AND e.organizer_id = $2 AND e.status = 'active'
   AND r.ticket_code = $1 AND r.status = 'registered' AND r.checked_in_at IS NULL
RETURNING r.id AS registration_id, r.ticket_code, r.event_id, e.title AS event_title,
          u.name AS attendee_name, r.checked_in_at`;

// Explains a zero-row UPDATE (C12). Joined to this organizer's events, so an
// unknown code and another organizer's ticket both give no row (C6, 3.8).
const TICKET_STATE_SQL = `SELECT r.status, r.checked_in_at, e.status AS event_status, u.name AS attendee_name
  FROM registrations r
  JOIN events e ON e.id = r.event_id
  JOIN users u ON u.id = r.user_id
 WHERE r.ticket_code = $1 AND e.organizer_id = $2`;

// `code` is already normalised by the route (C2). The UPDATE decides; a zero-row
// result is classified from a read afterwards, in the order of C12. Every
// refusing state only moves one way, except a waitlisted ticket promoted in
// between: if the read shows a free ticket, the UPDATE runs once more.
export async function checkIn(pool: pg.Pool, organizerId: string, code: string): Promise<CheckInResult> {
  for (let attempt = 0; ; attempt++) {
    const updated = await pool.query<CheckedInRow>(CHECK_IN_SQL, [code, organizerId]);
    if (updated.rows.length > 0) return { kind: "ok", row: updated.rows[0] };

    const read = await pool.query<TicketState>(TICKET_STATE_SQL, [code, organizerId]);
    if (read.rows.length === 0) return { kind: "not_found" };
    const state = read.rows[0];
    if (state.event_status === "cancelled") return { kind: "refused", error: "event_cancelled" };
    if (state.status === "cancelled") return { kind: "refused", error: "registration_cancelled" };
    if (state.status === "waitlisted") return { kind: "refused", error: "waitlisted" };
    if (state.checked_in_at !== null) {
      return { kind: "already_checked_in", checked_in_at: state.checked_in_at, attendee_name: state.attendee_name };
    }
    // A free registered ticket on an active event: promoted between the UPDATE
    // and the read. One retry; a second miss is a server error, never a 409.
    if (attempt >= 1) throw new Error("check-in found a free ticket twice");
  }
}

export type ListedRegistrationRow = RegistrationRow & {
  status: "registered" | "waitlisted";
  attendee_name: string;
  attendee_email: string;
};

export type ListResult = { kind: "not_found" } | { kind: "ok"; rows: ListedRegistrationRow[] };

// The ownership read comes first, so an owned event with nobody is [] and an
// unknown or foreign one is not_found (DATABASE.md 3.8). The rows come from
// one statement, so they are one snapshot; no lock, no transaction (C18).
// waitlist_position is counted in the same statement as in R7/R17.
export async function listRegistrations(pool: pg.Pool, organizerId: string, eventId: string): Promise<ListResult> {
  const owned = await pool.query("SELECT 1 FROM events WHERE id = $1 AND organizer_id = $2", [eventId, organizerId]);
  if (owned.rows.length === 0) return { kind: "not_found" };

  const { rows } = await pool.query<ListedRegistrationRow>(
    `SELECT ${REGISTRATION_COLUMNS}, u.name AS attendee_name, u.email AS attendee_email
       FROM events e
       JOIN registrations r ON r.event_id = e.id
       JOIN users u ON u.id = r.user_id
      WHERE e.id = $1 AND e.organizer_id = $2 AND r.status IN ('registered', 'waitlisted')
      ORDER BY r.created_at, r.id`,
    [eventId, organizerId],
  );
  return { kind: "ok", rows };
}
