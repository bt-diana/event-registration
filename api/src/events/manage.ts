import type pg from "pg";
import { promoteWaiting } from "../registrations/service.js";
import { endsAt, type StoredStatus } from "./status.js";

// docs/specs/email-reminders.md ER61-ER87 (M7): reschedule an event (B8,
// DATABASE.md 3.6) and cancel the whole event (B9, 3.7). Each runs in one
// transaction that starts with the same FOR UPDATE lock on the event as the
// register service; the lock query also checks ownership (3.8). Nothing here
// sends an email: the rows go to the outbox and the sender sends them (ER9).
// docs/specs/capacity.md CP1-CP24 (M4): change the capacity of an event (B10,
// 3.9) under the same lock, promoting waiting people into the new free seats.

export type ManageResult =
  | { kind: "not_found" }
  | { kind: "refused"; error: "event_cancelled" | "event_passed" | "event_started" }
  | { kind: "ok"; eventId: string };

// CP5: the new capacity is below the `registered` count read under the lock.
export type CapacityResult = ManageResult | { kind: "too_low"; registered: number };

type LockedEvent = {
  id: string;
  title: string;
  status: StoredStatus;
  starts_at: Date;
  duration_minutes: number;
  schedule_version: number;
  capacity: number;
};

const LOCK_SQL = `SELECT id, title, status, starts_at, duration_minutes, schedule_version, capacity
  FROM events WHERE id = $1 AND organizer_id = $2 FOR UPDATE`;

// Pending reminders of this event. The reschedule adds `schedule_version < $2`
// (ER71); the cancel deletes every version (ER79). A row the sender holds is
// waited for and, once committed as sent, no longer matches.
const DELETE_PENDING_REMINDERS_SQL = `DELETE FROM outbox o USING registrations r
 WHERE o.registration_id = r.id AND r.event_id = $1
   AND o.kind = 'reminder' AND o.status = 'pending'`;

// The same date format as the reminder (ER19): YYYY-MM-DD HH:MI in UTC.
function utcText(at: Date): string {
  return at.toISOString().slice(0, 16).replace("T", " ");
}

// ER64: the event has ended, or it has started and not ended. A stored
// cancelled event is decided by each caller before this.
function startedOrPassed(event: LockedEvent, now: Date): "event_passed" | "event_started" | null {
  if (now.getTime() >= endsAt(event.starts_at, event.duration_minutes).getTime()) return "event_passed";
  if (event.starts_at.getTime() <= now.getTime()) return "event_started";
  return null;
}

// The transaction shape of registerForEvent: COMMIT on ok, ROLLBACK otherwise
// (nothing was written then); on an error ROLLBACK, and a client whose
// ROLLBACK failed is dropped from the pool (ER87).
async function inEventLock<R extends { kind: string }>(
  pool: pg.Pool,
  organizerId: string,
  eventId: string,
  work: (client: pg.PoolClient, event: LockedEvent) => Promise<R>,
): Promise<R | { kind: "not_found" }> {
  const client = await pool.connect();
  let broken: Error | undefined;
  try {
    await client.query("BEGIN");
    const locked = await client.query<LockedEvent>(LOCK_SQL, [eventId, organizerId]);
    const result = locked.rows.length === 0 ? ({ kind: "not_found" } as const) : await work(client, locked.rows[0]);
    await client.query(result.kind === "ok" ? "COMMIT" : "ROLLBACK");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      broken = rollbackError instanceof Error ? rollbackError : new Error("rollback failed");
    }
    throw error;
  } finally {
    client.release(broken);
  }
}

// B8. `startsAt` is already checked by the route (a future instant, ER63).
export function rescheduleEvent(
  pool: pg.Pool,
  organizerId: string,
  eventId: string,
  startsAt: Date,
  now: Date,
): Promise<ManageResult> {
  return inEventLock(pool, organizerId, eventId, async (client, event) => {
    if (event.status === "cancelled") return { kind: "refused", error: "event_cancelled" };
    const refused = startedOrPassed(event, now);
    if (refused) return { kind: "refused", error: refused };
    // ER65: the same instant is a no-op, whatever the offset was.
    if (event.starts_at.getTime() === startsAt.getTime()) return { kind: "ok", eventId: event.id };

    const version = event.schedule_version + 1;
    await client.query("UPDATE events SET starts_at = $2, schedule_version = $3 WHERE id = $1", [
      event.id,
      startsAt,
      version,
    ]);
    await client.query(`${DELETE_PENDING_REMINDERS_SQL} AND o.schedule_version < $2`, [event.id, version]);
    // ER67, ER68: waiting people and seated people who have not arrived; one
    // text for all, without the ticket code.
    const subject = `Rescheduled: ${event.title}`;
    const body = [
      event.title,
      `New start: ${utcText(startsAt)} (UTC)`,
      `Previous start: ${utcText(event.starts_at)} (UTC)`,
    ].join("\n");
    await client.query(
      `INSERT INTO outbox (registration_id, kind, schedule_version, event_starts_at, to_email, subject, body)
       SELECT r.id, 'reschedule', $2, $3, u.email, $4, $5
         FROM registrations r JOIN users u ON u.id = r.user_id
        WHERE r.event_id = $1
          AND (r.status = 'waitlisted' OR (r.status = 'registered' AND r.checked_in_at IS NULL))
       ON CONFLICT (registration_id, kind, schedule_version) DO NOTHING`,
      [event.id, version, startsAt, subject, body],
    );
    return { kind: "ok", eventId: event.id };
  });
}

// B9. A second cancel is a no-op (ER76) and is decided before ER64.
export function cancelEvent(pool: pg.Pool, organizerId: string, eventId: string, now: Date): Promise<ManageResult> {
  return inEventLock(pool, organizerId, eventId, async (client, event) => {
    if (event.status === "cancelled") return { kind: "ok", eventId: event.id };
    const refused = startedOrPassed(event, now);
    if (refused) return { kind: "refused", error: refused };

    // now() is the start time of this transaction, so the event and the moved
    // registrations get exactly the same instant (ER73, ER74).
    await client.query("UPDATE events SET status = 'cancelled', cancelled_at = now() WHERE id = $1", [event.id]);
    // ER74, ER75: the moved registrations and their emails in one statement,
    // so the two cannot disagree. Checked-in people are left as they are.
    const subject = `Cancelled: ${event.title}`;
    const body = [event.title, `Was to start: ${utcText(event.starts_at)} (UTC)`, "The event has been cancelled."].join(
      "\n",
    );
    await client.query(
      `WITH moved AS (
         UPDATE registrations SET status = 'cancelled', cancelled_at = now()
          WHERE event_id = $1 AND checked_in_at IS NULL AND status IN ('registered', 'waitlisted')
         RETURNING id, user_id)
       INSERT INTO outbox (registration_id, kind, schedule_version, event_starts_at, to_email, subject, body)
       SELECT m.id, 'event_cancelled', $2, $3, u.email, $4, $5
         FROM moved m JOIN users u ON u.id = m.user_id
       ON CONFLICT (registration_id, kind, schedule_version) DO NOTHING`,
      [event.id, event.schedule_version, event.starts_at, subject, body],
    );
    await client.query(DELETE_PENDING_REMINDERS_SQL, [event.id]);
    return { kind: "ok", eventId: event.id };
  });
}

// B10 (capacity.md section 3). `capacity` is already checked by the route
// (an integer from 1 to 100000, CP3). The state, the count and the waiting
// list are all read under the lock (CP21).
export function setCapacity(
  pool: pg.Pool,
  organizerId: string,
  eventId: string,
  capacity: number,
  now: Date,
): Promise<CapacityResult> {
  return inEventLock<CapacityResult>(pool, organizerId, eventId, async (client, event) => {
    if (event.status === "cancelled") return { kind: "refused", error: "event_cancelled" };
    const refused = startedOrPassed(event, now);
    if (refused) return { kind: "refused", error: refused };

    // Checked-in people are `registered` and hold a seat (CP5).
    const seated = await client.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM registrations WHERE event_id = $1 AND status = 'registered'",
      [event.id],
    );
    const registered = seated.rows[0].n;
    // Below the count before the same value (question 4), then the no-op (CP6).
    if (capacity < registered) return { kind: "too_low", registered };
    if (capacity === event.capacity) return { kind: "ok", eventId: event.id };

    await client.query("UPDATE events SET capacity = $2 WHERE id = $1", [event.id, capacity]);
    // CP9, CP13: never more than the free seats, in queue_no order.
    await promoteWaiting(client, event, capacity - registered);
    return { kind: "ok", eventId: event.id };
  });
}
