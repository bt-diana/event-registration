import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { enqueueReminders } from "../../src/email/reminders.js";
import {
  backendPid,
  createTestDb,
  insertEvent,
  insertOrganizer,
  insertRegistration,
  insertUser,
  uniqueEmail,
  waitUntilBlockedBy,
  type TestDb,
} from "../db/helpers.js";

// B5: one reminder per seated person per schedule version, in the 24 hours
// before the event (email-reminders.md ER18-ER31, roadmap steps 31 and 32).
// Written before the worker: ER18, ER20-ER22 and ER24-ER28, ER31 are the tests
// first. The clock is always a fixed Date passed as `now`.

const MS = 1;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// A start far from the real clock (ER26).
const S = new Date("2030-01-02T09:00:00.000Z");
const ONE_DAY_BEFORE = new Date(S.getTime() - DAY);

type Seat = { id: string; email: string; ticketCode: string };

type ReminderRow = {
  id: string;
  registration_id: string;
  kind: string;
  schedule_version: number;
  event_starts_at: Date;
  to_email: string;
  subject: string;
  body: string;
  sent_at: Date | null;
  status: string;
  send_attempts: number;
  send_error: string | null;
};

let db: TestDb;
let organizerId: string;

beforeAll(async () => {
  db = await createTestDb();
  organizerId = await insertOrganizer(db.pool);
});

afterAll(async () => {
  await db?.drop();
});

// The worker looks at every event, so every test starts with none.
beforeEach(async () => {
  await db.pool.query("DELETE FROM outbox; DELETE FROM registrations; DELETE FROM events;");
});

async function seat(eventId: string, status: "registered" | "waitlisted" | "cancelled" = "registered"): Promise<Seat> {
  const email = uniqueEmail("seat");
  const userId = await insertUser(db.pool, email);
  const { id, ticketCode } = await insertRegistration(db.pool, eventId, userId, status);
  return { id, email, ticketCode };
}

// An event at `startsAt` with `seated` registered people, one waiting, one
// cancelled and one registered person who is already checked in.
async function setup(options: { startsAt?: Date; seated?: number; title?: string; status?: string } = {}) {
  const eventId = await insertEvent(db.pool, organizerId, {
    startsAt: options.startsAt ?? S,
    capacity: 100,
    title: options.title ?? "Spring Meetup",
    status: options.status,
  });
  const seated: Seat[] = [];
  for (let i = 0; i < (options.seated ?? 3); i++) seated.push(await seat(eventId));
  const waiting = await seat(eventId, "waitlisted");
  const cancelled = await seat(eventId, "cancelled");
  const checkedIn = await seat(eventId);
  await db.pool.query("UPDATE registrations SET checked_in_at = $2 WHERE id = $1", [checkedIn.id, ONE_DAY_BEFORE]);
  return { eventId, seated, waiting, cancelled, checkedIn };
}

async function reminders(eventId?: string): Promise<ReminderRow[]> {
  const { rows } = await db.pool.query<ReminderRow>(
    `SELECT o.* FROM outbox o JOIN registrations r ON r.id = o.registration_id
      WHERE o.kind = 'reminder' AND ($1::uuid IS NULL OR r.event_id = $1)
      ORDER BY o.schedule_version, o.to_email`,
    [eventId ?? null],
  );
  return rows;
}

function ids(rows: { registration_id: string }[]): string[] {
  return rows.map((r) => r.registration_id).sort();
}

function seatIds(seats: Seat[]): string[] {
  return seats.map((s) => s.id).sort();
}

describe("ER18: one reminder row per seated person in the window (tests first)", () => {
  it("writes a pending reminder with the event's version and start and the person's email", async () => {
    const { eventId, seated } = await setup();
    await db.pool.query("UPDATE events SET schedule_version = 4 WHERE id = $1", [eventId]);

    expect(await enqueueReminders(db.pool, ONE_DAY_BEFORE)).toBe(3);

    const rows = await reminders(eventId);
    expect(ids(rows)).toEqual(seatIds(seated));
    for (const r of rows) {
      const person = seated.find((s) => s.id === r.registration_id)!;
      expect(r).toMatchObject({
        kind: "reminder",
        schedule_version: 4,
        event_starts_at: S,
        to_email: person.email,
        sent_at: null,
        status: "pending",
        send_attempts: 0,
        send_error: null,
      });
    }
  });
});

describe("ER19: the reminder text", () => {
  it("has the title in the subject and the title, the UTC start and the ticket code in the body, one per line", async () => {
    const { eventId, seated } = await setup({ title: "Rust & Tea", seated: 1 });
    await enqueueReminders(db.pool, ONE_DAY_BEFORE);
    const [r] = await reminders(eventId);
    expect(r.subject).toBe("Reminder: Rust & Tea starts soon");
    expect(r.body).toBe(`Rust & Tea\nStarts: 2030-01-02 09:00 (UTC)\nTicket code: ${seated[0].ticketCode}`);
  });
});

describe("ER20: 10 runs give one row per person (tests first)", () => {
  it("returns N on the first run and 0 on the next nine", async () => {
    const { eventId, seated } = await setup({ seated: 5 });
    const counts = [];
    for (let run = 0; run < 10; run++) counts.push(await enqueueReminders(db.pool, ONE_DAY_BEFORE));
    expect(counts).toEqual([5, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(ids(await reminders(eventId))).toEqual(seatIds(seated));
  });
});

describe("ER21: parallel workers give one row per person (tests first)", () => {
  for (const workers of [2, 10]) {
    it(`${workers} parallel workers return counts that add up to N, and N rows exist`, async () => {
      for (let round = 0; round < 3; round++) {
        await db.pool.query("DELETE FROM outbox; DELETE FROM registrations; DELETE FROM events;");
        const { eventId, seated } = await setup({ seated: 20 });
        const counts = await Promise.all(
          Array.from({ length: workers }, () => enqueueReminders(db.pool, ONE_DAY_BEFORE)),
        );
        expect(counts.reduce((a, b) => a + b, 0)).toBe(20);
        expect(ids(await reminders(eventId))).toEqual(seatIds(seated));
      }
    });
  }
});

describe("ER22: only registered people (tests first)", () => {
  it("writes nothing for waiting and cancelled registrations", async () => {
    const { eventId, waiting, cancelled } = await setup();
    await enqueueReminders(db.pool, ONE_DAY_BEFORE);
    const got = ids(await reminders(eventId));
    expect(got).not.toContain(waiting.id);
    expect(got).not.toContain(cancelled.id);
  });
});

describe("ER23: checked-in people get no reminder", () => {
  it("leaves out a registered person who is already checked in", async () => {
    const { eventId, checkedIn, seated } = await setup();
    await enqueueReminders(db.pool, ONE_DAY_BEFORE);
    const got = ids(await reminders(eventId));
    expect(got).not.toContain(checkedIn.id);
    expect(got).toEqual(seatIds(seated));
  });
});

describe("ER24: a cancelled event gets no reminder (tests first)", () => {
  it("writes nothing for an event with stored status cancelled, even with people left registered", async () => {
    const { eventId } = await setup({ status: "cancelled" });
    expect(await enqueueReminders(db.pool, ONE_DAY_BEFORE)).toBe(0);
    expect(await reminders(eventId)).toEqual([]);
  });
});

describe("ER25: the window edges (tests first)", () => {
  const cases: [string, Date, boolean][] = [
    ["S - 24h", new Date(S.getTime() - DAY), true],
    ["S - 24h - 1 ms", new Date(S.getTime() - DAY - MS), false],
    ["S - 1 ms", new Date(S.getTime() - MS), true],
    ["S", S, false],
    ["S + 1 h", new Date(S.getTime() + HOUR), false],
    ["S - 3 days", new Date(S.getTime() - 3 * DAY), false],
  ];
  for (const [label, now, expected] of cases) {
    it(`now = ${label} ${expected ? "gives rows" : "gives none"}`, async () => {
      const { eventId } = await setup();
      expect(await enqueueReminders(db.pool, now)).toBe(expected ? 3 : 0);
      expect(await reminders(eventId)).toHaveLength(expected ? 3 : 0);
    });
  }
});

describe("ER26: the clock is injected (tests first)", () => {
  it("uses `now` from the argument, with the JavaScript clock and the database clock far away", async () => {
    const { eventId } = await setup();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("1999-06-01T00:00:00.000Z"));
    try {
      expect(await enqueueReminders(db.pool, new Date("2030-01-01T12:00:00.000Z"))).toBe(3);
    } finally {
      vi.useRealTimers();
    }
    expect(await reminders(eventId)).toHaveLength(3);
  });

  it("passes `now` as a timestamptz parameter", async () => {
    await setup();
    const query = vi.spyOn(db.pool, "query");
    try {
      await enqueueReminders(db.pool, ONE_DAY_BEFORE);
      const [text, values] = query.mock.calls[0] as unknown as [string, unknown[]];
      expect(text).toContain("$1::timestamptz");
      expect(text).not.toMatch(/now\(\)/i);
      expect(values).toEqual([ONE_DAY_BEFORE]);
    } finally {
      query.mockRestore();
    }
  });
});

describe("ER27: one INSERT ... SELECT ... ON CONFLICT DO NOTHING per call (tests first)", () => {
  it("runs exactly one query on the pool (no client, no transaction, no read first)", async () => {
    await setup({ seated: 4 });
    const query = vi.spyOn(db.pool, "query");
    try {
      expect(await enqueueReminders(db.pool, ONE_DAY_BEFORE)).toBe(4);
      expect(query).toHaveBeenCalledTimes(1);
      const text = String(query.mock.calls[0][0]).replace(/\s+/g, " ");
      expect(text).toMatch(/^ ?INSERT INTO outbox .* SELECT /);
      expect(text).toContain("ON CONFLICT (registration_id, kind, schedule_version) DO NOTHING");
    } finally {
      query.mockRestore();
    }
  });
});

describe("ER28: the reschedule loop A -> B -> A -> B (tests first)", () => {
  it("gives one fresh reminder per person per move, versions 1 to 4, and none on a repeat", async () => {
    const A = S;
    const B = new Date(S.getTime() + 3 * DAY);
    const { eventId, seated } = await setup({ startsAt: A });
    const move = (to: Date) =>
      db.pool.query("UPDATE events SET starts_at = $2, schedule_version = schedule_version + 1 WHERE id = $1", [
        eventId,
        to,
      ]);

    const steps: [Date | null, Date][] = [
      [null, A],
      [B, B],
      [A, A],
      [B, B],
    ];
    for (const [to, start] of steps) {
      if (to) await move(to);
      const now = new Date(start.getTime() - 2 * HOUR);
      expect(await enqueueReminders(db.pool, now)).toBe(3);
      expect(await enqueueReminders(db.pool, now)).toBe(0);
    }

    const rows = await reminders(eventId);
    expect(rows).toHaveLength(12);
    for (const v of [1, 2, 3, 4]) {
      const ofVersion = rows.filter((r) => r.schedule_version === v);
      expect(ids(ofVersion), `version ${v}`).toEqual(seatIds(seated));
      expect(ofVersion.every((r) => r.event_starts_at.getTime() === (v % 2 === 1 ? A : B).getTime())).toBe(true);
    }
  });
});

describe("ER29: late registrations and several events", () => {
  it("a person who registers inside the window gets a reminder on the next run, the others no second one", async () => {
    const { eventId, seated } = await setup();
    expect(await enqueueReminders(db.pool, ONE_DAY_BEFORE)).toBe(3);
    const late = await seat(eventId);
    expect(await enqueueReminders(db.pool, new Date(ONE_DAY_BEFORE.getTime() + HOUR))).toBe(1);
    expect(ids(await reminders(eventId))).toEqual(seatIds([...seated, late]));
  });

  it("handles every event in the window in one pass and none outside it", async () => {
    const first = await setup({ seated: 2 });
    const second = await setup({ seated: 3, startsAt: new Date(S.getTime() + 5 * HOUR) });
    const outside = await setup({ seated: 4, startsAt: new Date(S.getTime() + 2 * DAY) });
    expect(await enqueueReminders(db.pool, new Date(S.getTime() - HOUR))).toBe(5);
    expect(ids(await reminders(first.eventId))).toEqual(seatIds(first.seated));
    expect(ids(await reminders(second.eventId))).toEqual(seatIds(second.seated));
    expect(await reminders(outside.eventId)).toEqual([]);
  });
});

describe("ER30: the worker writes only outbox rows", () => {
  it("changes no registration, event or user row and prints nothing", async () => {
    await setup();
    const snapshot = async () => {
      const result: Record<string, unknown[]> = {};
      for (const table of ["organizers", "users", "events", "registrations"]) {
        result[table] = (await db.pool.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
      }
      return result;
    };
    const before = await snapshot();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await enqueueReminders(db.pool, ONE_DAY_BEFORE);
      expect(log).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
    expect(await snapshot()).toEqual(before);
    const { rows } = await db.pool.query<{ kind: string }>("SELECT DISTINCT kind FROM outbox");
    expect(rows).toEqual([{ kind: "reminder" }]);
  });
});

describe("ER72: the worker does not insert behind a reschedule or cancel (tests first)", () => {
  // What the M7 routes do under the event lock, written by SQL here.
  const changes: [string, string][] = [
    [
      "a reschedule (start far away, version + 1)",
      "UPDATE events SET starts_at = starts_at + interval '30 days', schedule_version = schedule_version + 1 WHERE id = $1",
    ],
    ["a cancel", "UPDATE events SET status = 'cancelled', cancelled_at = now() WHERE id = $1"],
  ];
  for (const [label, change] of changes) {
    it(`waits for the event lock and writes no old-version row after ${label}`, async () => {
      const { eventId } = await setup();
      const client = await db.pool.connect();
      let done = false;
      let worker: Promise<number> | undefined;
      let blocked: number | null | undefined;
      try {
        await client.query("BEGIN");
        await client.query("SELECT id FROM events WHERE id = $1 FOR UPDATE", [eventId]);
        const holder = await backendPid(client);
        worker = enqueueReminders(db.pool, ONE_DAY_BEFORE).finally(() => {
          done = true;
        });
        blocked = await waitUntilBlockedBy(db.pool, holder, () => done);
        await client.query(change, [eventId]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      expect(await worker!).toBe(0);
      expect(await reminders(eventId)).toEqual([]);
      expect(blocked).not.toBeNull();
    });
  }
});

describe("ER31: error_sending does not open the door to a second reminder (tests first)", () => {
  it("returns 0 for a person whose reminder of this version is error_sending, and the row stays", async () => {
    const { eventId, seated } = await setup({ seated: 1 });
    await enqueueReminders(db.pool, ONE_DAY_BEFORE);
    await db.pool.query(
      "UPDATE outbox SET status = 'error_sending', send_attempts = 3, send_error = 'boom' WHERE kind = 'reminder'",
    );

    expect(await enqueueReminders(db.pool, ONE_DAY_BEFORE)).toBe(0);
    const rows = await reminders(eventId);
    expect(ids(rows)).toEqual(seatIds(seated));
    expect(rows[0]).toMatchObject({ status: "error_sending", send_attempts: 3 });
  });

  it("also for a sent reminder", async () => {
    await setup({ seated: 2 });
    await enqueueReminders(db.pool, ONE_DAY_BEFORE);
    await db.pool.query("UPDATE outbox SET status = 'sent', sent_at = now() WHERE kind = 'reminder'");
    expect(await enqueueReminders(db.pool, ONE_DAY_BEFORE)).toBe(0);
    expect(await reminders()).toHaveLength(2);
  });
});

