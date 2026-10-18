import type pg from "pg";
import { deriveStatus, hasStarted, type EventStatus, type StoredStatus } from "../events/status.js";
import { makeTicketCode } from "./ticket.js";

// registration.md section 3: the register service (B4, B1, B2) in one
// transaction that starts with a row lock on the event.

export type RegistrationStatus = "registered" | "waitlisted" | "cancelled";

export type RegistrationRow = {
  id: string;
  event_id: string;
  status: RegistrationStatus;
  ticket_code: string;
  checked_in_at: Date | null;
  created_at: Date;
  // Counted at read time; null unless the status is waitlisted (R7).
  waitlist_position: number | null;
};

// The registration columns plus the place on the waiting list: the number of
// waiting rows of the event with queue_no up to this row's (index
// registrations_waitlist).
export const REGISTRATION_COLUMNS = `r.id, r.event_id, r.status, r.ticket_code, r.checked_in_at, r.created_at,
  CASE WHEN r.status = 'waitlisted' THEN (
    SELECT count(*)::int FROM registrations w
     WHERE w.event_id = r.event_id AND w.status = 'waitlisted' AND w.queue_no <= r.queue_no
  ) END AS waitlist_position`;

// docs/specs/my-registrations.md: the attendee's own registrations in every
// status, with the event's title, start and derived status. One statement
// (the waiting place is a correlated subquery in it, not a query per row), no
// lock, no transaction; newest first, id as the tie-break (MR4-MR10, MR13).
const MY_REGISTRATIONS_SQL = `SELECT ${REGISTRATION_COLUMNS},
       e.title AS event_title, e.starts_at AS event_starts_at,
       e.status AS event_stored_status, e.duration_minutes
  FROM registrations r
  JOIN events e ON e.id = r.event_id
 WHERE r.user_id = $1
 ORDER BY r.created_at DESC, r.id DESC`;

export type MyRegistrationRow = RegistrationRow & {
  event_title: string;
  event_starts_at: Date;
  event_status: EventStatus;
};

// `now` is read once by the route, so every row is judged at the same instant.
export async function listMyRegistrations(pool: pg.Pool, userId: string, now: Date): Promise<MyRegistrationRow[]> {
  const { rows } = await pool.query<
    RegistrationRow & {
      event_title: string;
      event_starts_at: Date;
      event_stored_status: StoredStatus;
      duration_minutes: number;
    }
  >(MY_REGISTRATIONS_SQL, [userId]);
  return rows.map(({ event_stored_status, duration_minutes, ...row }) => ({
    ...row,
    event_status: deriveStatus(event_stored_status, row.event_starts_at, duration_minutes, now),
  }));
}

export type RegisterResult =
  | { kind: "not_found" }
  | { kind: "closed"; error: "event_cancelled" | "event_passed" }
  | { kind: "ok"; created: boolean; registration: RegistrationRow };

type LockedEvent = {
  id: string;
  status: StoredStatus;
  starts_at: Date;
  duration_minutes: number;
  capacity: number;
  schedule_version: number;
  title: string;
};

// A taken code is vanishingly rare; after this many the request fails (500).
const CODE_ATTEMPTS = 5;

export async function registerForEvent(
  pool: pg.Pool,
  eventId: string,
  userId: string,
  now: Date,
): Promise<RegisterResult> {
  const client = await pool.connect();
  let broken: Error | undefined;
  try {
    await client.query("BEGIN");
    const result = await registerLocked(client, eventId, userId, now);
    await client.query(result.kind === "ok" ? "COMMIT" : "ROLLBACK");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      // The connection is unusable: drop it instead of returning it to the pool.
      broken = rollbackError instanceof Error ? rollbackError : new Error("rollback failed");
    }
    throw error;
  } finally {
    client.release(broken);
  }
}

async function registerLocked(
  client: pg.PoolClient,
  eventId: string,
  userId: string,
  now: Date,
): Promise<RegisterResult> {
  // 1. Lock the event row. Concurrent callers for this event queue here.
  const locked = await client.query<LockedEvent>(
    `SELECT id, status, starts_at, duration_minutes, capacity, schedule_version, title
       FROM events WHERE id = $1 FOR UPDATE`,
    [eventId],
  );
  if (locked.rows.length === 0) return { kind: "not_found" };
  const event = locked.rows[0];

  // 2. Closed check, under the lock. Cancelled wins over passed (R10).
  const status = deriveStatus(event.status, event.starts_at, event.duration_minutes, now);
  if (status === "cancelled") return { kind: "closed", error: "event_cancelled" };
  if (status === "passed") return { kind: "closed", error: "event_passed" };

  // 3. An active row of this account: answer it, write nothing (B1, R4).
  const existing = await client.query<RegistrationRow>(
    `SELECT ${REGISTRATION_COLUMNS} FROM registrations r
      WHERE r.event_id = $1 AND r.user_id = $2 AND r.status <> 'cancelled'`,
    [eventId, userId],
  );
  if (existing.rows.length > 0) return { kind: "ok", created: false, registration: existing.rows[0] };

  // 4. Count the seats with the capacity of the locked row.
  const seated = await client.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM registrations WHERE event_id = $1 AND status = 'registered'",
    [eventId],
  );
  const newStatus = seated.rows[0].n < event.capacity ? "registered" : "waitlisted";

  // 5. Insert with a fresh code; a taken code inserts nothing and is retried.
  let registrationId: string | undefined;
  let ticketCode = "";
  for (let attempt = 0; attempt < CODE_ATTEMPTS && registrationId === undefined; attempt++) {
    ticketCode = makeTicketCode();
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO registrations (event_id, user_id, status, ticket_code)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (ticket_code) DO NOTHING
       RETURNING id`,
      [eventId, userId, newStatus, ticketCode],
    );
    registrationId = inserted.rows[0]?.id;
  }
  if (registrationId === undefined) {
    throw new Error(`no free ticket code after ${CODE_ATTEMPTS} attempts`);
  }

  // 6. The ticket email, only for a seat. Version, start and email are copied
  // from the locked event and the account (R3).
  if (newStatus === "registered") {
    const { subject, body } = ticketEmail(event, ticketCode);
    await client.query(
      `INSERT INTO outbox (registration_id, kind, schedule_version, event_starts_at, to_email, subject, body)
       SELECT $1, 'ticket', e.schedule_version, e.starts_at, u.email, $2, $3
         FROM events e, users u
        WHERE e.id = $4 AND u.id = $5
       ON CONFLICT (registration_id, kind, schedule_version) DO NOTHING`,
      [registrationId, subject, body, eventId, userId],
    );
  }

  const row = await client.query<RegistrationRow>(
    `SELECT ${REGISTRATION_COLUMNS} FROM registrations r WHERE r.id = $1`,
    [registrationId],
  );
  return { kind: "ok", created: true, registration: row.rows[0] };
}

function ticketEmail(event: LockedEvent, ticketCode: string): { subject: string; body: string } {
  return {
    subject: `Your ticket for ${event.title}`,
    body: [
      `You have a seat at ${event.title}.`,
      `Starts: ${event.starts_at.toISOString()} (UTC)`,
      `Ticket code: ${ticketCode}`,
    ].join("\n"),
  };
}

// docs/specs/cancel-registration.md (CR1-CR27; B3, DATABASE.md 3.5): the
// caller cancels their own registration; a freed seat goes to the first
// waiting person, who gets one promotion email row. One transaction, locks in
// the order event row, caller's row, promoted row (CR16).

export type CancelResult =
  | { kind: "not_found" }
  | { kind: "refused"; error: "already_checked_in" | "event_cancelled" | "event_passed" | "event_started" }
  | { kind: "ok"; registration: RegistrationRow };

export async function cancelRegistration(
  pool: pg.Pool,
  eventId: string,
  userId: string,
  now: Date,
): Promise<CancelResult> {
  const client = await pool.connect();
  let broken: Error | undefined;
  try {
    await client.query("BEGIN");
    const result = await cancelLocked(client, eventId, userId, now);
    await client.query(result.kind === "ok" ? "COMMIT" : "ROLLBACK");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      // The connection is unusable: drop it instead of returning it to the pool.
      broken = rollbackError instanceof Error ? rollbackError : new Error("rollback failed");
    }
    throw error;
  } finally {
    client.release(broken);
  }
}

async function cancelLocked(
  client: pg.PoolClient,
  eventId: string,
  userId: string,
  now: Date,
): Promise<CancelResult> {
  // 1. Lock the event row: cancels, registrations and the organizer's writes
  // of this event queue here (CR16).
  const locked = await client.query<LockedEvent>(
    `SELECT id, status, starts_at, duration_minutes, capacity, schedule_version, title
       FROM events WHERE id = $1 FOR UPDATE`,
    [eventId],
  );
  if (locked.rows.length === 0) return { kind: "not_found" };
  const event = locked.rows[0];

  // 2. The caller's row: the active one, else the newest cancelled one (R17).
  // Locked, so a check-in of this ticket waits for us (CR20).
  const mine = await client.query<RegistrationRow>(
    `SELECT ${REGISTRATION_COLUMNS} FROM registrations r
      WHERE r.event_id = $1 AND r.user_id = $2
      ORDER BY (r.status <> 'cancelled') DESC, r.created_at DESC, r.queue_no DESC
      LIMIT 1
      FOR UPDATE OF r`,
    [eventId, userId],
  );
  if (mine.rows.length === 0) return { kind: "not_found" };
  const row = mine.rows[0];

  // Row state before event state (CR12, CR13). A repeat is a 200 that writes
  // nothing; COMMIT of a read-only transaction changes nothing.
  if (row.status === "cancelled") return { kind: "ok", registration: row };
  if (row.checked_in_at !== null) return { kind: "refused", error: "already_checked_in" };

  // 3. Event state with the request's one `now`, in the order of ER64 (CR14).
  const status = deriveStatus(event.status, event.starts_at, event.duration_minutes, now);
  if (status === "cancelled") return { kind: "refused", error: "event_cancelled" };
  if (status === "passed") return { kind: "refused", error: "event_passed" };
  if (hasStarted(event.starts_at, now)) return { kind: "refused", error: "event_started" };

  // 4. Cancel. The checked_in_at guard repeats the CHECK; under the row lock
  // zero rows cannot happen and is treated as an error.
  const cancelled = await client.query(
    `UPDATE registrations SET status = 'cancelled', cancelled_at = now()
      WHERE id = $1 AND checked_in_at IS NULL AND status <> 'cancelled'
      RETURNING id`,
    [row.id],
  );
  if (cancelled.rowCount !== 1) throw new Error("cancel updated no row under the lock");

  // 5. A freed seat goes to the first waiting person, only while the seats
  // under the lock stay below capacity (CR5, CR6, CR9). At most one per cancel.
  if (row.status === "registered") {
    const seated = await client.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM registrations WHERE event_id = $1 AND status = 'registered'",
      [eventId],
    );
    if (seated.rows[0].n < event.capacity) {
      const next = await client.query<{ id: string; email: string; ticket_code: string }>(
        `SELECT r.id, u.email, r.ticket_code
           FROM registrations r JOIN users u ON u.id = r.user_id
          WHERE r.event_id = $1 AND r.status = 'waitlisted'
          ORDER BY r.queue_no
          LIMIT 1`,
        [eventId],
      );
      if (next.rows.length > 0) {
        const promoted = next.rows[0];
        await client.query("UPDATE registrations SET status = 'registered' WHERE id = $1", [promoted.id]);
        // Version and start from the locked event row (CR7, CR24).
        const { subject, body } = promotionEmail(event, promoted.ticket_code);
        await client.query(
          `INSERT INTO outbox (registration_id, kind, schedule_version, event_starts_at, to_email, subject, body)
           VALUES ($1, 'promotion', $2, $3, $4, $5, $6)
           ON CONFLICT (registration_id, kind, schedule_version) DO NOTHING`,
          [promoted.id, event.schedule_version, event.starts_at, promoted.email, subject, body],
        );
      }
    }
  }

  // 6. A cancelled person gets no reminder (CR17): only pending reminder rows
  // of this registration; sent, error_sending and other kinds stay.
  await client.query(
    "DELETE FROM outbox WHERE registration_id = $1 AND kind = 'reminder' AND status = 'pending'",
    [row.id],
  );

  // 7. The cancelled row as stored now.
  const after = await client.query<RegistrationRow>(
    `SELECT ${REGISTRATION_COLUMNS} FROM registrations r WHERE r.id = $1`,
    [row.id],
  );
  return { kind: "ok", registration: after.rows[0] };
}

// CR7: the same style as the ticket email; the ticket code is the one the
// person already has.
function promotionEmail(event: LockedEvent, ticketCode: string): { subject: string; body: string } {
  return {
    subject: `You have a seat at ${event.title}`,
    body: [event.title, `Starts: ${event.starts_at.toISOString()} (UTC)`, `Ticket code: ${ticketCode}`].join("\n"),
  };
}
