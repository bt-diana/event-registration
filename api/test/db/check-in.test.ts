import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import {
  backendPid,
  createTestDb,
  insertEvent,
  insertOrganizer,
  insertRegistration,
  insertUser,
  makeTicketCode,
  waitUntilBlocked,
  type TestDb,
} from "./helpers.js";

// The DATABASE.md 3.3 conditional UPDATE.
const CHECK_IN_SQL = `
  UPDATE registrations r SET checked_in_at = now()
  FROM events e
  WHERE r.event_id = e.id
    AND e.organizer_id = $2 AND e.status = 'active'
    AND r.ticket_code = $1 AND r.status = 'registered' AND r.checked_in_at IS NULL
  RETURNING r.id`;

const ARRIVALS_SQL = `
  SELECT count(*)::int AS n FROM registrations r JOIN events e ON e.id = r.event_id
  WHERE r.event_id = $1 AND e.organizer_id = $2 AND r.checked_in_at IS NOT NULL`;

function checkIn(db: pg.Pool | pg.PoolClient, ticketCode: string, organizerId: string) {
  return db.query<{ id: string }>(CHECK_IN_SQL, [ticketCode, organizerId]);
}

describe("B6 single check-in (conditional UPDATE)", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(async () => {
    await db?.drop();
  });

  async function setup(status: "registered" | "waitlisted" | "cancelled" = "registered") {
    const organizerId = await insertOrganizer(db.pool);
    const eventId = await insertEvent(db.pool, organizerId);
    const ticket = await insertRegistration(db.pool, eventId, await insertUser(db.pool), status);
    return { organizerId, eventId, ticket };
  }

  it("checks in exactly once out of 5 parallel calls with one code", async () => {
    const { organizerId, eventId, ticket } = await setup();

    const results = await Promise.all(
      Array.from({ length: 5 }, () => checkIn(db.pool, ticket.ticketCode, organizerId)),
    );

    expect(results.map((r) => r.rowCount).sort()).toEqual([0, 0, 0, 0, 1]);
    const winner = results.find((r) => r.rowCount === 1);
    expect(winner?.rows[0].id).toBe(ticket.id);
    const arrivals = await db.pool.query<{ n: number }>(ARRIVALS_SQL, [eventId, organizerId]);
    expect(arrivals.rows[0].n).toBe(1);
  });

  it("makes a second check-in wait for the first and then return no row", async () => {
    const { organizerId, ticket } = await setup();
    const first = await db.pool.connect();
    const second = await db.pool.connect();
    try {
      await first.query("BEGIN");
      expect((await checkIn(first, ticket.ticketCode, organizerId)).rowCount).toBe(1);

      const secondPid = await backendPid(second);
      const secondRun = checkIn(second, ticket.ticketCode, organizerId);
      await waitUntilBlocked(db.pool, secondPid);

      await first.query("COMMIT");
      expect((await secondRun).rowCount).toBe(0);
    } finally {
      // Destroy the connections so an open transaction can never leak.
      first.release(true);
      second.release(true);
    }
  });

  it("does not change checked_in_at on a second check-in", async () => {
    const { organizerId, ticket } = await setup();
    await checkIn(db.pool, ticket.ticketCode, organizerId);
    const before = await db.pool.query<{ checked_in_at: Date }>(
      "SELECT checked_in_at FROM registrations WHERE id = $1",
      [ticket.id],
    );

    expect((await checkIn(db.pool, ticket.ticketCode, organizerId)).rowCount).toBe(0);
    const after = await db.pool.query<{ checked_in_at: Date }>(
      "SELECT checked_in_at FROM registrations WHERE id = $1",
      [ticket.id],
    );
    expect(after.rows[0].checked_in_at).toEqual(before.rows[0].checked_in_at);
  });

  it("returns no row for a waitlisted ticket", async () => {
    const { organizerId, ticket } = await setup("waitlisted");
    expect((await checkIn(db.pool, ticket.ticketCode, organizerId)).rowCount).toBe(0);
  });

  it("returns no row for a cancelled ticket", async () => {
    const { organizerId, ticket } = await setup("cancelled");
    expect((await checkIn(db.pool, ticket.ticketCode, organizerId)).rowCount).toBe(0);
  });

  it("returns no row for a ticket of a cancelled event", async () => {
    const { organizerId, eventId, ticket } = await setup();
    await db.pool.query(
      "UPDATE events SET status = 'cancelled', cancelled_at = now() WHERE id = $1",
      [eventId],
    );
    expect((await checkIn(db.pool, ticket.ticketCode, organizerId)).rowCount).toBe(0);
  });

  it("returns no row for another organizer's ticket or an unknown code", async () => {
    const { ticket } = await setup();
    const otherOrganizerId = await insertOrganizer(db.pool);
    expect((await checkIn(db.pool, ticket.ticketCode, otherOrganizerId)).rowCount).toBe(0);

    const { organizerId } = await setup();
    expect((await checkIn(db.pool, makeTicketCode(), organizerId)).rowCount).toBe(0);
  });
});
