import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { migrate, MIGRATIONS_DIR } from "../../src/db/migrate.js";
import { registerForEvent } from "../../src/registrations/service.js";
import {
  createTestDb,
  insertEvent,
  insertOrganizer,
  insertOutbox,
  insertRegistration,
  insertUser,
  type TestDb,
} from "./helpers.js";

// Migration 004_outbox_status.sql (email-reminders.md ER1-ER3): the delivery
// status of an outbox row. Written before the migration (ER1, ER2 test first).

type StatusColumns = {
  status: string;
  send_attempts: number;
  send_error: string | null;
  sent_at: Date | null;
};

async function statusOf(db: TestDb, id: string): Promise<StatusColumns> {
  const { rows } = await db.pool.query<StatusColumns>(
    "SELECT status, send_attempts, send_error, sent_at FROM outbox WHERE id = $1",
    [id],
  );
  return rows[0];
}

async function seat(db: TestDb): Promise<string> {
  const organizerId = await insertOrganizer(db.pool);
  const eventId = await insertEvent(db.pool, organizerId);
  const { id } = await insertRegistration(db.pool, eventId, await insertUser(db.pool));
  return id;
}

describe("ER1: the outbox status columns and their constraints (tests first)", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(async () => {
    await db?.drop();
  });

  it("rejects a status outside pending, sent and error_sending", async () => {
    const registrationId = await seat(db);
    for (const status of ["queued", "SENT", "", "failed"]) {
      await expect(
        insertOutbox(db.pool, registrationId, { status: status as "pending" }),
        status,
      ).rejects.toMatchObject({ code: "23514" });
    }
  });

  it("rejects a negative send_attempts", async () => {
    const registrationId = await seat(db);
    await expect(insertOutbox(db.pool, registrationId, { sendAttempts: -1 })).rejects.toMatchObject({
      code: "23514",
    });
  });

  it("rejects sent without sent_at, and pending or error_sending with sent_at (outbox_status_sent_at)", async () => {
    const registrationId = await seat(db);
    await expect(insertOutbox(db.pool, registrationId, { status: "sent" })).rejects.toMatchObject({
      code: "23514",
      constraint: "outbox_status_sent_at",
    });
    for (const status of ["pending", "error_sending"] as const) {
      await expect(
        insertOutbox(db.pool, registrationId, { status, sentAt: new Date() }),
        status,
      ).rejects.toMatchObject({ code: "23514", constraint: "outbox_status_sent_at" });
    }
    // A sent_at without a status is a pending row with a time: also refused.
    await expect(insertOutbox(db.pool, registrationId, { sentAt: new Date() })).rejects.toMatchObject({
      code: "23514",
      constraint: "outbox_status_sent_at",
    });
  });

  it("accepts sent with sent_at, and error_sending with sent_at NULL and a reason", async () => {
    const registrationId = await seat(db);
    const sentAt = new Date("2030-01-01T09:00:00.000Z");
    const sent = await insertOutbox(db.pool, registrationId, { kind: "ticket", status: "sent", sentAt });
    expect(await statusOf(db, sent)).toEqual({ status: "sent", send_attempts: 0, send_error: null, sent_at: sentAt });

    const failed = await insertOutbox(db.pool, registrationId, {
      kind: "reminder",
      status: "error_sending",
      sendAttempts: 3,
      sendError: "boom",
    });
    expect(await statusOf(db, failed)).toEqual({
      status: "error_sending",
      send_attempts: 3,
      send_error: "boom",
      sent_at: null,
    });
  });

  it("keeps UNIQUE (registration_id, kind, schedule_version), for every status", async () => {
    const registrationId = await seat(db);
    await insertOutbox(db.pool, registrationId, { kind: "reminder", status: "error_sending", sendAttempts: 3 });
    await expect(insertOutbox(db.pool, registrationId, { kind: "reminder" })).rejects.toMatchObject({
      code: "23505",
    });
    // Another version is a new key.
    await insertOutbox(db.pool, registrationId, { kind: "reminder", scheduleVersion: 2 });
  });
});

describe("ER2: rows from before 004 are valid after it (tests first)", () => {
  let db: TestDb | undefined;
  let tempDir: string | undefined;

  afterEach(async () => {
    await db?.drop();
    db = undefined;
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  it("backfills sent rows as sent and the others as pending, with 0 tries and no reason", async () => {
    db = await createTestDb({ migrate: false });
    tempDir = await mkdtemp(join(tmpdir(), "migrations-"));
    const before = ["001_init.sql", "002_event_duration.sql", "003_event_description.sql"];
    for (const file of before) {
      await copyFile(join(MIGRATIONS_DIR, file), join(tempDir, file));
    }
    expect(await migrate(db.pool, tempDir)).toEqual(before);

    const registrationId = await seat(db);
    const sentAt = new Date("2030-01-01T09:00:00.000Z");
    const sent = await insertOutbox(db.pool, registrationId, { kind: "ticket", sentAt });
    const unsent = await insertOutbox(db.pool, registrationId, { kind: "reminder" });

    expect(await migrate(db.pool)).toEqual(["004_outbox_status.sql", "005_seed_test_data.sql"]);

    expect(await statusOf(db, sent)).toEqual({ status: "sent", send_attempts: 0, send_error: null, sent_at: sentAt });
    expect(await statusOf(db, unsent)).toEqual({
      status: "pending",
      send_attempts: 0,
      send_error: null,
      sent_at: null,
    });
  });
});

describe("ER3: rows written by other code get the defaults", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(async () => {
    await db?.drop();
  });

  it("a plain SQL insert is pending with 0 tries, no reason and no sent_at", async () => {
    const id = await insertOutbox(db.pool, await seat(db));
    expect(await statusOf(db, id)).toEqual({ status: "pending", send_attempts: 0, send_error: null, sent_at: null });
  });

  it("the ticket row of the registration service is pending with 0 tries, no reason and no sent_at", async () => {
    const organizerId = await insertOrganizer(db.pool);
    const eventId = await insertEvent(db.pool, organizerId);
    const userId = await insertUser(db.pool);
    const result = await registerForEvent(db.pool, eventId, userId, new Date());
    expect(result.kind).toBe("ok");

    const { rows } = await db.pool.query<StatusColumns & { kind: string }>(
      `SELECT o.kind, o.status, o.send_attempts, o.send_error, o.sent_at
         FROM outbox o JOIN registrations r ON r.id = o.registration_id
        WHERE r.event_id = $1`,
      [eventId],
    );
    expect(rows).toEqual([{ kind: "ticket", status: "pending", send_attempts: 0, send_error: null, sent_at: null }]);
  });
});
