import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDb,
  insertEvent,
  insertOrganizer,
  insertRegistration,
  insertUser,
  makeTicketCode,
  uniqueEmail,
  type TestDb,
} from "./helpers.js";

const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";
const FOREIGN_KEY_VIOLATION = "23503";
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("database constraints", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(async () => {
    await db?.drop();
  });

  describe("B1 same person twice", () => {
    it("rejects a second active registration of one user on one event", async () => {
      const eventId = await insertEvent(db.pool, await insertOrganizer(db.pool));
      const userId = await insertUser(db.pool);
      await insertRegistration(db.pool, eventId, userId, "registered");

      await expect(insertRegistration(db.pool, eventId, userId, "registered")).rejects.toMatchObject({
        code: UNIQUE_VIOLATION,
        constraint: "registrations_one_active_per_user",
      });
      await expect(insertRegistration(db.pool, eventId, userId, "waitlisted")).rejects.toMatchObject({
        code: UNIQUE_VIOLATION,
        constraint: "registrations_one_active_per_user",
      });
    });

    it("allows registering again after cancelling", async () => {
      const eventId = await insertEvent(db.pool, await insertOrganizer(db.pool));
      const userId = await insertUser(db.pool);
      const first = await insertRegistration(db.pool, eventId, userId, "registered");
      await db.pool.query(
        "UPDATE registrations SET status = 'cancelled', cancelled_at = now() WHERE id = $1",
        [first.id],
      );

      const second = await insertRegistration(db.pool, eventId, userId, "registered");
      expect(second.id).not.toBe(first.id);
      // Two cancelled rows for one user are fine too.
      await db.pool.query(
        "UPDATE registrations SET status = 'cancelled', cancelled_at = now() WHERE id = $1",
        [second.id],
      );
      await insertRegistration(db.pool, eventId, userId, "waitlisted");
    });

    it("allows one user on two different events", async () => {
      const organizerId = await insertOrganizer(db.pool);
      const userId = await insertUser(db.pool);
      await insertRegistration(db.pool, await insertEvent(db.pool, organizerId), userId);
      await insertRegistration(db.pool, await insertEvent(db.pool, organizerId), userId);
    });

    it("rejects an email that is not lowercase and trimmed", async () => {
      await expect(insertUser(db.pool, "Ann@Example.com")).rejects.toMatchObject({ code: CHECK_VIOLATION });
      await expect(insertUser(db.pool, " ann@example.com")).rejects.toMatchObject({ code: CHECK_VIOLATION });
      await expect(
        db.pool.query(
          "INSERT INTO organizers (email, name, password_hash) VALUES ('Org@Example.com', 'O', 'h')",
        ),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });

    it("rejects two accounts with one email", async () => {
      const email = uniqueEmail();
      await insertUser(db.pool, email);
      await expect(insertUser(db.pool, email)).rejects.toMatchObject({ code: UNIQUE_VIOLATION });

      const orgEmail = uniqueEmail("org");
      const insertOrg = () =>
        db.pool.query("INSERT INTO organizers (email, name, password_hash) VALUES ($1, 'O', 'h')", [orgEmail]);
      await insertOrg();
      await expect(insertOrg()).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
    });

    it("rejects a duplicate ticket code", async () => {
      const eventId = await insertEvent(db.pool, await insertOrganizer(db.pool));
      const code = makeTicketCode();
      await insertRegistration(db.pool, eventId, await insertUser(db.pool), "registered", code);
      await expect(
        insertRegistration(db.pool, eventId, await insertUser(db.pool), "registered", code),
      ).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
    });
  });

  describe("checks", () => {
    it("requires capacity >= 0", async () => {
      const organizerId = await insertOrganizer(db.pool);
      await expect(insertEvent(db.pool, organizerId, { capacity: -1 })).rejects.toMatchObject({
        code: CHECK_VIOLATION,
      });
      await insertEvent(db.pool, organizerId, { capacity: 0 });
    });

    it("allows only known event and registration statuses", async () => {
      const organizerId = await insertOrganizer(db.pool);
      await expect(insertEvent(db.pool, organizerId, { status: "draft" })).rejects.toMatchObject({
        code: CHECK_VIOLATION,
      });
      const eventId = await insertEvent(db.pool, organizerId);
      const userId = await insertUser(db.pool);
      await expect(
        db.pool.query(
          "INSERT INTO registrations (event_id, user_id, status, ticket_code) VALUES ($1, $2, 'pending', $3)",
          [eventId, userId, makeTicketCode()],
        ),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });

    it("has the events columns, with duration_minutes from 002_event_duration.sql", async () => {
      const { rows } = await db.pool.query<{ column_name: string; data_type: string; is_nullable: string }>(
        `SELECT column_name, data_type, is_nullable FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = 'events' ORDER BY column_name`,
        [db.schema],
      );
      expect(rows.map((r) => r.column_name)).toEqual([
        "cancelled_at",
        "capacity",
        "created_at",
        "duration_minutes",
        "id",
        "organizer_id",
        "schedule_version",
        "starts_at",
        "status",
        "title",
      ]);
      expect(rows.find((r) => r.column_name === "duration_minutes")).toEqual({
        column_name: "duration_minutes",
        data_type: "integer",
        is_nullable: "NO",
      });
    });

    it("requires duration_minutes between 1 and 1440 and defaults it to 60", async () => {
      const organizerId = await insertOrganizer(db.pool);
      for (const durationMinutes of [0, -1, 1441]) {
        await expect(
          insertEvent(db.pool, organizerId, { durationMinutes }),
          String(durationMinutes),
        ).rejects.toMatchObject({ code: CHECK_VIOLATION });
      }
      await expect(
        db.pool.query(
          `INSERT INTO events (organizer_id, title, starts_at, capacity, duration_minutes)
           VALUES ($1, 'T', now(), 1, NULL)`,
          [organizerId],
        ),
      ).rejects.toMatchObject({ code: "23502" });

      const ids = [
        await insertEvent(db.pool, organizerId, { durationMinutes: 1 }),
        await insertEvent(db.pool, organizerId, { durationMinutes: 1440 }),
        await insertEvent(db.pool, organizerId),
      ];
      const { rows } = await db.pool.query<{ id: string; duration_minutes: number }>(
        "SELECT id, duration_minutes FROM events WHERE id = ANY($1::uuid[])",
        [ids],
      );
      const byId = new Map(rows.map((r) => [r.id, r.duration_minutes]));
      expect(ids.map((id) => byId.get(id))).toEqual([1, 1440, 60]);
    });

    it("defaults a new event to active with schedule_version 1", async () => {
      const eventId = await insertEvent(db.pool, await insertOrganizer(db.pool));
      const { rows } = await db.pool.query<{ status: string; schedule_version: number }>(
        `SELECT status, schedule_version FROM events WHERE id = $1`,
        [eventId],
      );
      expect(rows[0]).toEqual({ status: "active", schedule_version: 1 });
    });

    it("allows checked_in_at only on registered rows", async () => {
      const eventId = await insertEvent(db.pool, await insertOrganizer(db.pool));
      const waiting = await insertRegistration(db.pool, eventId, await insertUser(db.pool), "waitlisted");
      await expect(
        db.pool.query("UPDATE registrations SET checked_in_at = now() WHERE id = $1", [waiting.id]),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });

      const seated = await insertRegistration(db.pool, eventId, await insertUser(db.pool), "registered");
      await db.pool.query("UPDATE registrations SET checked_in_at = now() WHERE id = $1", [seated.id]);
      await expect(
        db.pool.query("UPDATE registrations SET status = 'cancelled' WHERE id = $1", [seated.id]),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });

    it("allows only known outbox kinds", async () => {
      const eventId = await insertEvent(db.pool, await insertOrganizer(db.pool));
      const ticket = await insertRegistration(db.pool, eventId, await insertUser(db.pool));
      const insertKind = (kind: string) =>
        db.pool.query(
          `INSERT INTO outbox (registration_id, kind, schedule_version, event_starts_at, to_email, subject, body)
           VALUES ($1, $2, 1, now(), 'a@example.com', 's', 'b')`,
          [ticket.id, kind],
        );

      await expect(insertKind("newsletter")).rejects.toMatchObject({ code: CHECK_VIOLATION });
      for (const kind of ["ticket", "promotion", "reminder", "reschedule", "event_cancelled"]) {
        await insertKind(kind);
      }
    });

    it("rejects a registration for an unknown event", async () => {
      await expect(
        insertRegistration(db.pool, "00000000-0000-7000-8000-000000000000", await insertUser(db.pool)),
      ).rejects.toMatchObject({ code: FOREIGN_KEY_VIOLATION });
    });

    it("does not accept a queue_no from the caller", async () => {
      const eventId = await insertEvent(db.pool, await insertOrganizer(db.pool));
      await expect(
        db.pool.query(
          `INSERT INTO registrations (queue_no, event_id, user_id, status, ticket_code)
           VALUES (1, $1, $2, 'registered', $3)`,
          [eventId, await insertUser(db.pool), makeTicketCode()],
        ),
      ).rejects.toMatchObject({ code: "428C9" });
    });
  });

  describe("ids", () => {
    it("uses uuid for every id and foreign key column", async () => {
      const { rows } = await db.pool.query<{ table_name: string; column_name: string; data_type: string }>(
        `SELECT table_name, column_name, data_type FROM information_schema.columns
         WHERE table_schema = $1 AND (column_name = 'id' OR column_name LIKE '%\\_id')
         ORDER BY table_name, column_name`,
        [db.schema],
      );
      expect(rows.map((r) => `${r.table_name}.${r.column_name}:${r.data_type}`)).toEqual([
        "events.id:uuid",
        "events.organizer_id:uuid",
        "organizers.id:uuid",
        "outbox.id:uuid",
        "outbox.registration_id:uuid",
        "registrations.event_id:uuid",
        "registrations.id:uuid",
        "registrations.user_id:uuid",
        "users.id:uuid",
      ]);
    });

    it("fills ids with uuidv7()", async () => {
      const organizerId = await insertOrganizer(db.pool);
      const userId = await insertUser(db.pool);
      const eventId = await insertEvent(db.pool, organizerId);
      const ticket = await insertRegistration(db.pool, eventId, userId);
      const { rows } = await db.pool.query<{ id: string }>(
        `INSERT INTO outbox (registration_id, kind, schedule_version, event_starts_at, to_email, subject, body)
         VALUES ($1, 'ticket', 1, now(), 'a@example.com', 's', 'b') RETURNING id`,
        [ticket.id],
      );

      for (const id of [organizerId, userId, eventId, ticket.id, rows[0].id]) {
        expect(id).toMatch(UUID_V7);
      }
    });
  });
});
