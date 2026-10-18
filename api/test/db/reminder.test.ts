import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import {
  backendPid,
  createTestDb,
  insertEvent,
  insertOrganizer,
  insertRegistration,
  insertUser,
  waitUntilBlocked,
  type TestDb,
} from "./helpers.js";

// The DATABASE.md 3.2 worker statement. The event version and start time are
// read in the same statement; the unique key makes a repeat a no-op. The
// 24-hour window is worker logic (decision 5) and is left out here.
const REMINDER_SQL = `
  INSERT INTO outbox (registration_id, kind, schedule_version, event_starts_at, to_email, subject, body)
  SELECT r.id, 'reminder', e.schedule_version, e.starts_at, u.email,
         'Reminder: ' || e.title, 'Your event starts at ' || e.starts_at::text
  FROM registrations r
  JOIN events e ON e.id = r.event_id
  JOIN users u ON u.id = r.user_id
  WHERE r.event_id = $1 AND r.status = 'registered' AND e.status = 'active'
  ON CONFLICT (registration_id, kind, schedule_version) DO NOTHING`;

type ReminderRow = { registration_id: string; schedule_version: number; to_email: string };

async function reminders(pool: pg.Pool, eventId: string): Promise<ReminderRow[]> {
  const { rows } = await pool.query<ReminderRow>(
    `SELECT o.registration_id, o.schedule_version, o.to_email
     FROM outbox o JOIN registrations r ON r.id = o.registration_id
     WHERE r.event_id = $1 AND o.kind = 'reminder'
     ORDER BY o.schedule_version, o.registration_id`,
    [eventId],
  );
  return rows;
}

// One event with 3 seated people, 1 waiting and 1 cancelled.
async function setupEvent(pool: pg.Pool) {
  const organizerId = await insertOrganizer(pool);
  const eventId = await insertEvent(pool, organizerId, { capacity: 3 });
  const registered: { id: string; email: string }[] = [];
  for (let i = 0; i < 3; i++) {
    const email = `seated-${i}-${eventId}@example.com`;
    const userId = await insertUser(pool, email);
    const { id } = await insertRegistration(pool, eventId, userId, "registered");
    registered.push({ id, email });
  }
  await insertRegistration(pool, eventId, await insertUser(pool), "waitlisted");
  await insertRegistration(pool, eventId, await insertUser(pool), "cancelled");
  return { eventId, registered };
}

describe("B5 single reminder (outbox unique key)", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(async () => {
    await db?.drop();
  });

  it("writes one reminder per registered person when the worker runs 10 times", async () => {
    const { eventId, registered } = await setupEvent(db.pool);

    const inserted: number[] = [];
    for (let i = 0; i < 10; i++) {
      const result = await db.pool.query(REMINDER_SQL, [eventId]);
      inserted.push(result.rowCount ?? 0);
    }

    expect(inserted).toEqual([3, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const rows = await reminders(db.pool, eventId);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.registration_id).sort()).toEqual(registered.map((r) => r.id).sort());
    expect(rows.every((r) => r.schedule_version === 1)).toBe(true);
    expect(rows.map((r) => r.to_email).sort()).toEqual(registered.map((r) => r.email).sort());
  });

  it("writes one reminder per registered person when 10 workers run in parallel", async () => {
    const { eventId } = await setupEvent(db.pool);

    const results = await Promise.all(
      Array.from({ length: 10 }, async () => {
        const client = await db.pool.connect();
        try {
          await client.query("BEGIN");
          const result = await client.query(REMINDER_SQL, [eventId]);
          await client.query("COMMIT");
          return result.rowCount ?? 0;
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      }),
    );

    expect(results.reduce((a, b) => a + b, 0)).toBe(3);
    expect(await reminders(db.pool, eventId)).toHaveLength(3);
  });

  it("makes a second worker wait for the first and then write nothing", async () => {
    const { eventId } = await setupEvent(db.pool);
    const first = await db.pool.connect();
    const second = await db.pool.connect();
    try {
      await first.query("BEGIN");
      expect((await first.query(REMINDER_SQL, [eventId])).rowCount).toBe(3);

      const secondPid = await backendPid(second);
      const secondRun = second.query(REMINDER_SQL, [eventId]);
      await waitUntilBlocked(db.pool, secondPid);

      await first.query("COMMIT");
      expect((await secondRun).rowCount).toBe(0);
    } finally {
      // Destroy the connections so an open transaction can never leak.
      first.release(true);
      second.release(true);
    }
    expect(await reminders(db.pool, eventId)).toHaveLength(3);
  });

  it("allows a new reminder after a reschedule bumps schedule_version, also A -> B -> A", async () => {
    const { eventId } = await setupEvent(db.pool);
    await db.pool.query(REMINDER_SQL, [eventId]);

    // A -> B
    await db.pool.query(
      `UPDATE events SET starts_at = starts_at + interval '1 hour',
                         schedule_version = schedule_version + 1 WHERE id = $1`,
      [eventId],
    );
    expect((await db.pool.query(REMINDER_SQL, [eventId])).rowCount).toBe(3);
    expect((await db.pool.query(REMINDER_SQL, [eventId])).rowCount).toBe(0);

    // B -> A: the same start time as version 1, but a new version
    await db.pool.query(
      `UPDATE events SET starts_at = starts_at - interval '1 hour',
                         schedule_version = schedule_version + 1 WHERE id = $1`,
      [eventId],
    );
    expect((await db.pool.query(REMINDER_SQL, [eventId])).rowCount).toBe(3);

    const rows = await reminders(db.pool, eventId);
    expect(rows.map((r) => r.schedule_version)).toEqual([1, 1, 1, 2, 2, 2, 3, 3, 3]);
  });

  it("writes no reminder for a cancelled event", async () => {
    const { eventId } = await setupEvent(db.pool);
    await db.pool.query(
      "UPDATE events SET status = 'cancelled', cancelled_at = now() WHERE id = $1",
      [eventId],
    );

    expect((await db.pool.query(REMINDER_SQL, [eventId])).rowCount).toBe(0);
  });

  it("rejects a second reminder row with the same version", async () => {
    const { eventId, registered } = await setupEvent(db.pool);
    await db.pool.query(REMINDER_SQL, [eventId]);

    await expect(
      db.pool.query(
        `INSERT INTO outbox (registration_id, kind, schedule_version, event_starts_at, to_email, subject, body)
         VALUES ($1, 'reminder', 1, now(), 'a@example.com', 's', 'b')`,
        [registered[0].id],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });
});
