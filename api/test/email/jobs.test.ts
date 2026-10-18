import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import { createApp } from "../../src/app.js";
import { startEmailJobs } from "../../src/email/jobs.js";
import { makeQrPng } from "../../src/email/qr.js";
import type { EmailTransport } from "../../src/email/transport.js";
import { TEST_SECRET } from "../auth/helpers.js";
import {
  createTestDb,
  insertEvent,
  insertOrganizer,
  insertOutbox,
  insertRegistration,
  insertUser,
  uniqueEmail,
  type TestDb,
} from "../db/helpers.js";

// The email jobs (email-reminders.md ER32, ER14 over ticks, ER38). ER32 is the
// test first. startEmailJobs runs one round at start; the tests stop that
// timer first and then drive the rounds with tick().

const S = new Date("2030-01-02T09:00:00.000Z");
const ONE_DAY_BEFORE = new Date(S.getTime() - 24 * 60 * 60 * 1000);

let db: TestDb;

beforeAll(async () => {
  // Reminders reach the real QR (email-templates.md ET22). Its first call
  // loads the native canvas module, which can take seconds while the other
  // test files run, so it is loaded here once.
  await makeQrPng("WARMUP0000");
  db = await createTestDb();
}, 30_000);

afterAll(async () => {
  await db?.drop();
});

beforeEach(async () => {
  await db.pool.query("DELETE FROM outbox; DELETE FROM registrations; DELETE FROM events;");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

// Started and stopped again, so only tick() runs rounds.
async function stoppedJobs(transport: EmailTransport, clock: () => Date = () => ONE_DAY_BEFORE) {
  const jobs = startEmailJobs({ pool: db.pool, transport, intervalMs: 1000, clock, log: vi.fn(), onError: vi.fn() });
  await jobs.stop();
  return jobs;
}

describe("ER32: one tick writes the reminder and sends it in the same round (tests first)", () => {
  it("enqueues with the injected clock, then hands the reminder to the transport", async () => {
    const transport = vi.fn<EmailTransport>(async () => {});
    const clock = vi.fn(() => ONE_DAY_BEFORE);
    const jobs = await stoppedJobs(transport, clock);
    clock.mockClear();

    const email = uniqueEmail("ana");
    const eventId = await insertEvent(db.pool, await insertOrganizer(db.pool), { startsAt: S, title: "Spring Meetup" });
    await insertRegistration(db.pool, eventId, await insertUser(db.pool, email));

    await jobs.tick();

    expect(clock).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][0]).toMatchObject({ to: email, subject: "Reminder: Spring Meetup starts soon" });
    const { rows } = await db.pool.query<{ kind: string; status: string }>("SELECT kind, status FROM outbox");
    expect(rows).toEqual([{ kind: "reminder", status: "sent" }]);

    // A second round has nothing to do.
    await jobs.tick();
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("starts a round at once and stops cleanly", async () => {
    const email = uniqueEmail("early");
    const eventId = await insertEvent(db.pool, await insertOrganizer(db.pool), { startsAt: S });
    await insertRegistration(db.pool, eventId, await insertUser(db.pool, email));
    const transport = vi.fn<EmailTransport>(async () => {});

    const jobs = startEmailJobs({
      pool: db.pool,
      transport,
      intervalMs: 60_000,
      clock: () => ONE_DAY_BEFORE,
      log: vi.fn(),
      onError: vi.fn(),
    });
    await jobs.stop();
    expect(transport.mock.calls.map(([m]) => m.to)).toEqual([email]);
  });
});

describe("ER14: send_attempts over ticks (tests first)", () => {
  it("shows 1, 2, 3 after three ticks with a failing transport, and error_sending after the third", async () => {
    const transport = vi.fn<EmailTransport>(async () => {
      throw new Error("provider down");
    });
    const jobs = await stoppedJobs(transport, () => new Date("2020-01-01T00:00:00.000Z"));
    const eventId = await insertEvent(db.pool, await insertOrganizer(db.pool), { startsAt: S });
    const { id: registrationId } = await insertRegistration(db.pool, eventId, await insertUser(db.pool));
    const id = await insertOutbox(db.pool, registrationId);

    const seen = [];
    for (let tick = 0; tick < 3; tick++) {
      await jobs.tick();
      const { rows } = await db.pool.query<{ send_attempts: number; status: string }>(
        "SELECT send_attempts, status FROM outbox WHERE id = $1",
        [id],
      );
      seen.push(rows[0]);
    }
    expect(seen).toEqual([
      { send_attempts: 1, status: "pending" },
      { send_attempts: 2, status: "pending" },
      { send_attempts: 3, status: "error_sending" },
    ]);
  });
});

describe("ER38: createApp starts nothing and needs no mail settings", () => {
  it("builds without EMAIL_API_KEY and MAIL_FROM and makes no query in an hour", async () => {
    vi.stubEnv("EMAIL_API_KEY", undefined);
    vi.stubEnv("MAIL_FROM", undefined);
    vi.useFakeTimers();
    const query = vi.fn();
    const connect = vi.fn();
    const pool = { query, connect } as unknown as pg.Pool;

    expect(() => createApp({ pool, cookieSecret: TEST_SECRET })).not.toThrow();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

    expect(query).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });
});
