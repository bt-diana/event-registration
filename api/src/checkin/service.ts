import type pg from "pg";
import { REGISTRATION_COLUMNS, type RegistrationRow } from "../registrations/service.js";

// docs/specs/checkin.md (M5). The organizer registrations list (C15-C18).
// POST /checkin (C2-C14) is a later step.

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
