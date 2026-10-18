import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import {
  createTestDb,
  insertEvent,
  insertOrganizer,
  insertUser,
  makeTicketCode,
  type TestDb,
} from "./helpers.js";

// The DATABASE.md 3.1 flow: lock the event row, count the seated people,
// insert as registered if a seat is free, otherwise as waitlisted. The short
// sleep between count and insert widens the race window, so without the lock
// the parallel transactions would really overlap and overbook.
async function registerWithLock(
  client: pg.PoolClient,
  eventId: string,
  userId: string,
  onLocked: () => void,
): Promise<string> {
  try {
    await client.query("BEGIN");
    const event = await client.query<{ capacity: number }>(
      "SELECT capacity FROM events WHERE id = $1 FOR UPDATE",
      [eventId],
    );
    onLocked();
    const seated = await client.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM registrations WHERE event_id = $1 AND status = 'registered'",
      [eventId],
    );
    await client.query("SELECT pg_sleep(0.02)");
    const status = seated.rows[0].n < event.rows[0].capacity ? "registered" : "waitlisted";
    await client.query(
      "INSERT INTO registrations (event_id, user_id, status, ticket_code) VALUES ($1, $2, $3, $4)",
      [eventId, userId, status, makeTicketCode()],
    );
    await client.query("COMMIT");
    return status;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

// Opens one connection per user first, then starts all transactions at once.
async function registerAllAtOnce(
  pool: pg.Pool,
  eventId: string,
  userIds: string[],
  onLocked: (userId: string) => void = () => undefined,
): Promise<string[]> {
  const clients = await Promise.all(userIds.map(() => pool.connect()));
  try {
    return await Promise.all(
      userIds.map((userId, i) => registerWithLock(clients[i], eventId, userId, () => onLocked(userId))),
    );
  } finally {
    for (const client of clients) client.release();
  }
}

describe("B4 last seat (event row lock)", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(async () => {
    await db?.drop();
  });

  it("gives the only seat to exactly one of 20 parallel registrations", async () => {
    const organizerId = await insertOrganizer(db.pool);
    const eventId = await insertEvent(db.pool, organizerId, { capacity: 1 });
    const userIds: string[] = [];
    for (let i = 0; i < 20; i++) {
      userIds.push(await insertUser(db.pool));
    }

    const lockOrder: string[] = [];
    const results = await registerAllAtOnce(db.pool, eventId, userIds, (userId) =>
      lockOrder.push(userId),
    );

    expect(results.filter((s) => s === "registered")).toHaveLength(1);
    expect(results.filter((s) => s === "waitlisted")).toHaveLength(19);

    const { rows } = await db.pool.query<{ user_id: string; status: string; queue_no: string }>(
      "SELECT user_id, status, queue_no FROM registrations WHERE event_id = $1 ORDER BY queue_no",
      [eventId],
    );
    expect(rows).toHaveLength(20);
    expect(rows.filter((r) => r.status === "registered")).toHaveLength(1);
    expect(rows.filter((r) => r.status === "waitlisted")).toHaveLength(19);

    // queue_no is assigned inside the lock, so it follows the lock order:
    // the first lock holder got the seat, the rest wait in lock order.
    expect(rows.map((r) => r.user_id)).toEqual(lockOrder);
    expect(rows[0].status).toBe("registered");
    expect(new Set(rows.map((r) => r.queue_no)).size).toBe(20);
  });

  it("puts everyone on the waiting list when capacity is 0", async () => {
    const organizerId = await insertOrganizer(db.pool);
    const eventId = await insertEvent(db.pool, organizerId, { capacity: 0 });
    const userIds = [await insertUser(db.pool), await insertUser(db.pool), await insertUser(db.pool)];

    const results = await registerAllAtOnce(db.pool, eventId, userIds);

    expect(results).toEqual(["waitlisted", "waitlisted", "waitlisted"]);
  });
});
