import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Running } from "../auth/helpers.js";
import { enqueueReminders } from "../../src/email/reminders.js";
import {
  backendPid,
  createTestDb,
  insertEvent,
  insertOutbox,
  insertUser,
  makeTicketCode,
  waitUntilBlockedBy,
  type TestDb,
} from "../db/helpers.js";
import {
  attendee,
  call,
  DAY,
  fromNow,
  HOUR,
  MALFORMED_IDS,
  MINUTE,
  organizer,
  ORGANIZER_KEYS,
  startApi,
  UNKNOWN_ID,
  type Account,
  type Reply,
} from "./helpers.js";
import {
  allTables,
  cancelEvent,
  databaseCalls,
  eventState,
  expectError,
  failStatement,
  ISO_UTC,
  outboxOf,
  person,
  reschedule,
  sorted,
  type OrganizerEvent,
  type Person,
} from "./manageHelpers.js";

// POST /events/:id/capacity (docs/specs/capacity.md CP1-CP24; B10,
// DATABASE.md 3.9; roadmap step 21). Tests first: CP2, CP4, CP5, CP9, CP10,
// CP12, CP19-CP24; the other CP tests are in the same red commit.

let db: TestDb;
let api: Running;
let owner: Account;
let stranger: Account;

beforeAll(async () => {
  db = await createTestDb();
  api = startApi(db.pool);
  owner = await organizer(db.pool);
  stranger = await organizer(db.pool);
});

afterAll(async () => {
  await api?.close();
  await db?.drop();
});

afterEach(() => {
  vi.useRealTimers();
});

// Moves the clock of this process (the app runs in it) to `at`. Only Date is faked.
function setNow(at: Date): void {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(at);
}

const A = new Date("2030-03-01T10:00:00.000Z");
const B = new Date("2030-03-05T10:00:00.000Z");

function setCapacity(eventId: string, body: unknown, cookie: string | undefined = owner.cookie): Promise<Reply> {
  return call(api, "POST", `/events/${eventId}/capacity`, { body, cookie });
}

function asEvent(reply: Reply): OrganizerEvent {
  expect(reply.status, reply.text).toBe(200);
  expect(Object.keys(reply.body as object), reply.text).toEqual(ORGANIZER_KEYS);
  return reply.body as OrganizerEvent;
}

// An event of the owner at A with `registered` seated people and `waiting`
// people on the list, made by SQL in this order (so queue_no follows it).
async function eventWith(options: {
  capacity: number;
  registered?: number;
  waiting?: number;
  title?: string;
  startsAt?: Date;
  organizerId?: string;
}) {
  const eventId = await insertEvent(db.pool, options.organizerId ?? owner.id, {
    capacity: options.capacity,
    startsAt: options.startsAt ?? A,
    title: options.title ?? "Capacity Night",
    durationMinutes: 120,
  });
  const seated: Person[] = [];
  for (let i = 0; i < (options.registered ?? 0); i++) seated.push(await person(db.pool, eventId));
  const waiting: Person[] = [];
  for (let i = 0; i < (options.waiting ?? 0); i++) waiting.push(await person(db.pool, eventId, "waitlisted"));
  return { eventId, seated, waiting };
}

type RegRow = { id: string; status: string; queue_no: string; user_id: string };

async function registrationsOf(eventId: string): Promise<RegRow[]> {
  const { rows } = await db.pool.query<RegRow>(
    "SELECT id, status, queue_no, user_id FROM registrations WHERE event_id = $1 ORDER BY queue_no",
    [eventId],
  );
  return rows;
}

async function statusOf(registrationId: string): Promise<string> {
  const { rows } = await db.pool.query<{ status: string }>("SELECT status FROM registrations WHERE id = $1", [
    registrationId,
  ]);
  return rows[0].status;
}

async function countOf(eventId: string, status: string): Promise<number> {
  const { rows } = await db.pool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM registrations WHERE event_id = $1 AND status = $2",
    [eventId, status],
  );
  return rows[0].n;
}

async function storedCapacity(eventId: string): Promise<number> {
  const { rows } = await db.pool.query<{ capacity: number }>("SELECT capacity FROM events WHERE id = $1", [eventId]);
  return rows[0].capacity;
}

// The waiting places (R7) of the event's waiting rows in queue order: 1..N, no gap.
async function waitingPlaces(eventId: string): Promise<number[]> {
  const { rows } = await db.pool.query<{ place: number }>(
    `SELECT (SELECT count(*)::int FROM registrations w
              WHERE w.event_id = r.event_id AND w.status = 'waitlisted' AND w.queue_no <= r.queue_no) AS place
       FROM registrations r WHERE r.event_id = $1 AND r.status = 'waitlisted' ORDER BY r.queue_no`,
    [eventId],
  );
  return rows.map((r) => r.place);
}

function ids(people: Person[]): string[] {
  return sorted(people.map((p) => p.registrationId));
}

function regIds(rows: { registration_id: string }[]): string[] {
  return sorted(rows.map((r) => r.registration_id));
}

describe("CP1: route and guards", () => {
  it("answers 200 for the owner and 401 / 403 before the id and the body are looked at", async () => {
    const { eventId } = await eventWith({ capacity: 2, registered: 2, waiting: 1 });
    const guest = await attendee(db.pool);
    const before = await allTables(db.pool);

    expectError(await setCapacity(eventId, { capacity: 5 }, undefined), 401, "not_logged_in");
    expectError(await setCapacity("abc", { capacity: "x" }, undefined), 401, "not_logged_in");
    expectError(await setCapacity(eventId, { capacity: 5 }, guest.cookie), 403, "wrong_role");
    expectError(await setCapacity("abc", [], guest.cookie), 403, "wrong_role");
    expect(await allTables(db.pool)).toEqual(before);

    const event = asEvent(await setCapacity(eventId, { capacity: 5 }));
    expect(event).toMatchObject({ id: eventId, capacity: 5, registered: 3, seats_left: 2 });
  });
});

describe("CP2: 404, one body (tests first)", () => {
  it("answers the same 404 for a malformed id, an unknown event and another organizer's event, and changes nothing", async () => {
    const foreign = await eventWith({ capacity: 2, registered: 2, waiting: 3, organizerId: stranger.id });
    const before = await eventState(db.pool, foreign.eventId);
    const body = { capacity: 10 };

    const replies = [await setCapacity(UNKNOWN_ID, body), await setCapacity(foreign.eventId, body)];
    for (const id of MALFORMED_IDS) {
      let reply: Reply | undefined;
      const calls = await databaseCalls(db.pool, async () => {
        reply = await setCapacity(encodeURIComponent(id), body);
      });
      expect(calls, id).toBe(0);
      replies.push(reply!);
    }
    for (const reply of replies) {
      expectError(reply, 404, "not_found");
      expect(reply.text).toBe(replies[0].text);
    }
    expect(await eventState(db.pool, foreign.eventId)).toEqual(before);
    // The owner can change it, so the 404 above was the ownership check.
    expect(asEvent(await setCapacity(foreign.eventId, body, stranger.cookie)).registered).toBe(5);
  });
});

describe("CP3: validation", () => {
  const bad: [string, unknown][] = [
    ["an array", [{ capacity: 5 }]],
    ["no capacity", {}],
    ["a string", { capacity: "5" }],
    ["a decimal", { capacity: 5.5 }],
    ["null", { capacity: null }],
    ["true", { capacity: true }],
    ["0", { capacity: 0 }],
    ["a negative number", { capacity: -3 }],
    ["100001", { capacity: 100001 }],
  ];
  for (const [label, body] of bad) {
    it(`answers 400 invalid_input for ${label}, before any query`, async () => {
      const { eventId } = await eventWith({ capacity: 2, registered: 2, waiting: 1 });
      let reply: Reply | undefined;
      const calls = await databaseCalls(db.pool, async () => {
        reply = await setCapacity(eventId, body);
      });
      expectError(reply!, 400, "invalid_input");
      expect(calls).toBe(0);
    });
  }

  it("answers 400 for a body that is a JSON string, null, or missing", async () => {
    const { eventId } = await eventWith({ capacity: 2 });
    const before = await eventState(db.pool, eventId);
    const path = `/events/${eventId}/capacity`;
    for (const raw of ['"5"', "null", "5"]) {
      expectError(await call(api, "POST", path, { raw, cookie: owner.cookie }), 400, "invalid_input");
    }
    expectError(await call(api, "POST", path, { cookie: owner.cookie }), 400, "invalid_input");
    expect(await eventState(db.pool, eventId)).toEqual(before);
  });

  it("accepts 1, 100000 and 1e2", async () => {
    const { eventId } = await eventWith({ capacity: 5 });
    expect(asEvent(await setCapacity(eventId, { capacity: 1 })).capacity).toBe(1);
    expect(asEvent(await setCapacity(eventId, { capacity: 100000 })).capacity).toBe(100000);
    const reply = await call(api, "POST", `/events/${eventId}/capacity`, {
      raw: '{"capacity":1e2}',
      cookie: owner.cookie,
    });
    expect(asEvent(reply).capacity).toBe(100);
  });

  it("decides a bad body before a closed, unknown or foreign event", async () => {
    const closed = await insertEvent(db.pool, owner.id, { startsAt: A, status: "cancelled" });
    const foreign = await insertEvent(db.pool, stranger.id, { startsAt: A });
    for (const id of [closed, foreign, UNKNOWN_ID]) {
      expectError(await setCapacity(id, { capacity: 0 }), 400, "invalid_input");
    }
  });

  it("ignores other body fields", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { startsAt: A, title: "Kept", capacity: 7, durationMinutes: 45 });
    const event = asEvent(
      await setCapacity(eventId, {
        capacity: 9,
        title: "Changed",
        starts_at: B.toISOString(),
        status: "cancelled",
        duration_minutes: 5,
        schedule_version: 99,
        description: "x",
      }),
    );
    expect(event).toMatchObject({
      title: "Kept",
      description: "",
      capacity: 9,
      starts_at: A.toISOString(),
      duration_minutes: 45,
      status: "active",
      schedule_version: 1,
    });
  });
});

describe("CP4: closed or started events are refused under the lock (tests first)", () => {
  it("answers 409 event_cancelled for a cancelled event and writes nothing, also for the same value and below the count", async () => {
    const { eventId } = await eventWith({ capacity: 2, registered: 2, waiting: 2 });
    await db.pool.query("UPDATE events SET status = 'cancelled', cancelled_at = now() WHERE id = $1", [eventId]);
    const before = await eventState(db.pool, eventId);
    for (const capacity of [6, 2, 1]) {
      expectError(await setCapacity(eventId, { capacity }), 409, "event_cancelled");
    }
    expect(await eventState(db.pool, eventId)).toEqual(before);
  });

  it("cancelled wins over passed", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { startsAt: fromNow(-3 * DAY), status: "cancelled" });
    expectError(await setCapacity(eventId, { capacity: 5 }), 409, "event_cancelled");
  });

  it("answers 409 event_passed for an ended event and writes nothing", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { startsAt: fromNow(-3 * HOUR), durationMinutes: 60, capacity: 1 });
    await person(db.pool, eventId);
    await person(db.pool, eventId, "waitlisted");
    const before = await eventState(db.pool, eventId);
    for (const capacity of [5, 1]) expectError(await setCapacity(eventId, { capacity }), 409, "event_passed");
    expect(await eventState(db.pool, eventId)).toEqual(before);
  });

  it("answers 409 event_started for a running event and writes nothing", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { startsAt: fromNow(-10 * MINUTE), durationMinutes: 60, capacity: 2 });
    await person(db.pool, eventId);
    await person(db.pool, eventId);
    await person(db.pool, eventId, "waitlisted");
    const before = await eventState(db.pool, eventId);
    for (const capacity of [5, 2, 1]) expectError(await setCapacity(eventId, { capacity }), 409, "event_started");
    expect(await eventState(db.pool, eventId)).toEqual(before);
  });

  describe("edges", () => {
    it("now = starts_at is event_started", async () => {
      const start = fromNow(2 * HOUR);
      const eventId = await insertEvent(db.pool, owner.id, { startsAt: start, durationMinutes: 60 });
      setNow(start);
      expectError(await setCapacity(eventId, { capacity: 20 }), 409, "event_started");
    });

    it("now = ends_at is event_passed", async () => {
      const start = fromNow(2 * HOUR);
      const eventId = await insertEvent(db.pool, owner.id, { startsAt: start, durationMinutes: 60 });
      setNow(new Date(start.getTime() + 60 * MINUTE));
      expectError(await setCapacity(eventId, { capacity: 20 }), 409, "event_passed");
    });

    it("one ms before starts_at is allowed", async () => {
      const start = fromNow(2 * HOUR);
      const eventId = await insertEvent(db.pool, owner.id, { startsAt: start, durationMinutes: 60 });
      setNow(new Date(start.getTime() - 1));
      expect(asEvent(await setCapacity(eventId, { capacity: 20 })).capacity).toBe(20);
    });
  });
});

describe("CP5: below the registered count (tests first)", () => {
  it("answers 409 capacity_below_registered with the count and writes nothing", async () => {
    const { eventId } = await eventWith({ capacity: 3, registered: 2, waiting: 2 });
    await person(db.pool, eventId, "checked_in");
    await person(db.pool, eventId, "cancelled");
    const before = await eventState(db.pool, eventId);

    for (const capacity of [2, 1]) {
      const reply = await setCapacity(eventId, { capacity });
      expect(reply.status, reply.text).toBe(409);
      expect(reply.body).toEqual({ error: "capacity_below_registered", registered: 3 });
      expect(Object.keys(reply.body as object)).toEqual(["error", "registered"]);
    }
    expect(await eventState(db.pool, eventId)).toEqual(before);

    // Exactly the count is allowed (here the same value, so a no-op).
    expect(asEvent(await setCapacity(eventId, { capacity: 3 })).registered).toBe(3);
  });

  it("counts under the lock, not before it", async () => {
    const { eventId } = await eventWith({ capacity: 5, registered: 3 });
    const client = await db.pool.connect();
    let done = false;
    let pending: Promise<Reply> | undefined;
    let blocked: number | null | undefined;
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM events WHERE id = $1 FOR UPDATE", [eventId]);
      const holder = await backendPid(client);
      pending = setCapacity(eventId, { capacity: 3 }).finally(() => {
        done = true;
      });
      blocked = await waitUntilBlockedBy(db.pool, holder, () => done);
      // One more seated person, committed before the change reads the count.
      const userId = await insertUser(db.pool);
      await client.query(
        "INSERT INTO registrations (event_id, user_id, status, ticket_code) VALUES ($1, $2, 'registered', $3)",
        [eventId, userId, makeTicketCode()],
      );
    } finally {
      await client.query("COMMIT");
      client.release();
    }
    const reply = await pending!;
    expect(blocked).not.toBeNull();
    expect(reply.status, reply.text).toBe(409);
    expect(reply.body).toEqual({ error: "capacity_below_registered", registered: 4 });
    expect(await storedCapacity(eventId)).toBe(5);
  });
});

describe("CP6: same value is a no-op", () => {
  it("answers 200 with the unchanged event and writes nothing", async () => {
    // A state only SQL can make: free seats and people waiting. The no-op
    // still promotes nobody (question 5).
    const { eventId } = await eventWith({ capacity: 4, registered: 2, waiting: 2 });
    const read = await call(api, "GET", `/events/${eventId}`, { cookie: owner.cookie });
    const before = await eventState(db.pool, eventId);
    expect(asEvent(await setCapacity(eventId, { capacity: 4 }))).toEqual(read.body);
    expect(await eventState(db.pool, eventId)).toEqual(before);
  });
});

describe("CP7: lowering at or above the registered count", () => {
  it("changes only events.capacity", async () => {
    const { eventId } = await eventWith({ capacity: 10, registered: 3 });
    const before = await eventState(db.pool, eventId);

    expect(asEvent(await setCapacity(eventId, { capacity: 5 }))).toMatchObject({ capacity: 5, registered: 3, seats_left: 2 });
    let after = await eventState(db.pool, eventId);
    expect(after.event).toEqual({ ...before.event, capacity: 5 });
    expect(after.registrations).toEqual(before.registrations);
    expect(after.outbox).toEqual(before.outbox);

    expect(asEvent(await setCapacity(eventId, { capacity: 3 }))).toMatchObject({ capacity: 3, registered: 3, seats_left: 0 });
    after = await eventState(db.pool, eventId);
    expect(after.event).toEqual({ ...before.event, capacity: 3 });
    expect(after.registrations).toEqual(before.registrations);
    expect(after.outbox).toEqual(before.outbox);
  });

  it("lowering to exactly the count leaves waiting people waiting in the same order", async () => {
    const { eventId, waiting } = await eventWith({ capacity: 6, registered: 3, waiting: 2 });
    const before = await eventState(db.pool, eventId);
    expect(asEvent(await setCapacity(eventId, { capacity: 3 }))).toMatchObject({ capacity: 3, seats_left: 0 });
    const after = await eventState(db.pool, eventId);
    expect(after.registrations).toEqual(before.registrations);
    expect(after.outbox).toEqual(before.outbox);
    for (const [i, p] of waiting.entries()) {
      const mine = await call(api, "GET", `/events/${eventId}/registrations/me`, { cookie: p.cookie });
      expect(mine.body).toMatchObject({ status: "waitlisted", waitlist_position: i + 1 });
    }
  });
});

describe("CP8: raising with nobody waiting", () => {
  it("changes only events.capacity and the public event is no longer full", async () => {
    const { eventId } = await eventWith({ capacity: 2, registered: 2 });
    expect((await call(api, "GET", `/public/events/${eventId}`)).body).toMatchObject({ full: true, seats_left: 0 });
    const before = await eventState(db.pool, eventId);

    expect(asEvent(await setCapacity(eventId, { capacity: 5 }))).toMatchObject({ capacity: 5, registered: 2, seats_left: 3 });
    const after = await eventState(db.pool, eventId);
    expect(after.event).toEqual({ ...before.event, capacity: 5 });
    expect(after.registrations).toEqual(before.registrations);
    expect(after.outbox).toEqual(before.outbox);
    expect((await call(api, "GET", `/public/events/${eventId}`)).body).toMatchObject({
      capacity: 5,
      full: false,
      seats_left: 3,
    });
  });
});

describe("CP9: promotion count (tests first)", () => {
  it("capacity 2 full, 6 waiting, raise to 5: exactly 3 promoted, 3 waiting at places 1-3", async () => {
    const { eventId, waiting } = await eventWith({ capacity: 2, registered: 2, waiting: 6 });
    expect(asEvent(await setCapacity(eventId, { capacity: 5 }))).toMatchObject({ capacity: 5, registered: 5, seats_left: 0 });
    for (const p of waiting.slice(0, 3)) expect(await statusOf(p.registrationId)).toBe("registered");
    for (const p of waiting.slice(3)) expect(await statusOf(p.registrationId)).toBe("waitlisted");
    expect(await waitingPlaces(eventId)).toEqual([1, 2, 3]);
    expect(await outboxOf(db.pool, eventId, "promotion")).toHaveLength(3);
  });

  it("raise to 100: all 6 promoted, none left, registered 8", async () => {
    const { eventId } = await eventWith({ capacity: 2, registered: 2, waiting: 6 });
    expect(asEvent(await setCapacity(eventId, { capacity: 100 }))).toMatchObject({ registered: 8, seats_left: 92 });
    expect(await countOf(eventId, "waitlisted")).toBe(0);
    expect(await outboxOf(db.pool, eventId, "promotion")).toHaveLength(6);
  });

  it("capacity 2 full, 1 waiting, raise to 5: 1 promoted", async () => {
    const { eventId, waiting } = await eventWith({ capacity: 2, registered: 2, waiting: 1 });
    expect(asEvent(await setCapacity(eventId, { capacity: 5 }))).toMatchObject({ registered: 3, seats_left: 2 });
    expect(await statusOf(waiting[0].registrationId)).toBe("registered");
    expect(await outboxOf(db.pool, eventId, "promotion")).toHaveLength(1);
  });

  it("raise by 1 with 3 waiting: 1 promoted", async () => {
    const { eventId, waiting } = await eventWith({ capacity: 2, registered: 2, waiting: 3 });
    expect(asEvent(await setCapacity(eventId, { capacity: 3 }))).toMatchObject({ registered: 3, seats_left: 0 });
    expect(await statusOf(waiting[0].registrationId)).toBe("registered");
    expect(await waitingPlaces(eventId)).toEqual([1, 2]);
    expect(await outboxOf(db.pool, eventId, "promotion")).toHaveLength(1);
    expect(await countOf(eventId, "registered")).toBeLessThanOrEqual(await storedCapacity(eventId));
  });
});

describe("CP10: order is queue_no (tests first)", () => {
  it("promotes the lowest queue_no first, not by created_at, id or name, and skips cancelled rows", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { startsAt: A, capacity: 1 });
    await person(db.pool, eventId);
    // Waiting rows A, B, C, D in queue order, B cancelled. Ids, created_at and
    // names run the other way, so only queue_no gives A, C.
    const labels = ["A", "B", "C", "D"];
    const rows: { label: string; id: string }[] = [];
    for (const [i, label] of labels.entries()) {
      const userId = await insertUser(db.pool);
      await db.pool.query("UPDATE users SET name = $2 WHERE id = $1", [userId, `${9 - i} person`]);
      const id = `${"f".repeat(7)}${9 - i}-0000-7000-8000-${randomUUID().slice(-12)}`;
      await db.pool.query(
        `INSERT INTO registrations (id, event_id, user_id, status, ticket_code, created_at, cancelled_at)
         VALUES ($1, $2, $3, $4::text, $5, now() - make_interval(mins => $6::int),
                 CASE WHEN $4::text = 'cancelled' THEN now() END)`,
        [id, eventId, userId, label === "B" ? "cancelled" : "waitlisted", makeTicketCode(), i],
      );
      rows.push({ label, id });
    }
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.id]));

    asEvent(await setCapacity(eventId, { capacity: 3 }));
    expect(await statusOf(byLabel.A)).toBe("registered");
    expect(await statusOf(byLabel.B)).toBe("cancelled");
    expect(await statusOf(byLabel.C)).toBe("registered");
    expect(await statusOf(byLabel.D)).toBe("waitlisted");
    expect(await waitingPlaces(eventId)).toEqual([1]);
    expect(regIds(await outboxOf(db.pool, eventId, "promotion"))).toEqual(sorted([byLabel.A, byLabel.C]));
  });
});

describe("CP11: a promoted row keeps everything but its status", () => {
  it("changes only status on promoted rows and nothing on any other row", async () => {
    const { eventId, waiting } = await eventWith({ capacity: 2, registered: 2, waiting: 3 });
    await person(db.pool, eventId, "cancelled");
    const before = await eventState(db.pool, eventId);
    asEvent(await setCapacity(eventId, { capacity: 4 }));
    const after = await eventState(db.pool, eventId);
    const promoted = new Set([waiting[0].registrationId, waiting[1].registrationId]);
    expect(after.registrations).toEqual(
      before.registrations.map((r) => (promoted.has(r.id as string) ? { ...r, status: "registered" } : r)),
    );
    for (const r of after.registrations.filter((x) => promoted.has(x.id as string))) {
      expect(r.checked_in_at).toBeNull();
      expect(r.cancelled_at).toBeNull();
    }
  });
});

describe("CP12: one promotion outbox row per promoted person (tests first)", () => {
  it("raise by 3 with 5 waiting: three rows, one per promoted person, with the CR7 text", async () => {
    const { eventId, seated, waiting } = await eventWith({ capacity: 2, registered: 2, waiting: 5, title: "Rust & Tea" });
    // The locked row's version and start, not the defaults.
    await db.pool.query("UPDATE events SET schedule_version = 4, starts_at = $2 WHERE id = $1", [eventId, B]);
    const cancelled = await person(db.pool, eventId, "cancelled");

    asEvent(await setCapacity(eventId, { capacity: 5 }));
    const rows = await outboxOf(db.pool, eventId);
    expect(rows.every((r) => r.kind === "promotion")).toBe(true);
    expect(regIds(rows)).toEqual(ids(waiting.slice(0, 3)));
    for (const p of waiting.slice(0, 3)) {
      const mine = rows.filter((r) => r.to_email === p.email);
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({
        registration_id: p.registrationId,
        kind: "promotion",
        schedule_version: 4,
        event_starts_at: B,
        status: "pending",
        sent_at: null,
        subject: "You have a seat at Rust & Tea",
        body: `Rust & Tea\nStarts: ${B.toISOString()} (UTC)\nTicket code: ${p.ticketCode}`,
      });
    }
    for (const p of [...seated, ...waiting.slice(3), cancelled]) {
      expect(rows.filter((r) => r.to_email === p.email)).toEqual([]);
    }
  });

  it("an existing promotion row of the same version is a second guard: no error, still one row", async () => {
    const { eventId, waiting } = await eventWith({ capacity: 1, registered: 1, waiting: 2 });
    const existing = await insertOutbox(db.pool, waiting[0].registrationId, { kind: "promotion", scheduleVersion: 1 });
    asEvent(await setCapacity(eventId, { capacity: 2 }));
    expect(await statusOf(waiting[0].registrationId)).toBe("registered");
    expect((await outboxOf(db.pool, eventId, "promotion")).map((r) => r.id)).toEqual([existing]);
  });
});

describe("CP13: waiting people are served only as far as the seats go", () => {
  // (capacity, registered, waiting, new capacity, promoted)
  const cases: [number, number, number, number, number][] = [
    [2, 2, 0, 3, 0],
    [2, 2, 1, 3, 1],
    [2, 2, 4, 3, 1],
    [2, 2, 4, 4, 2],
    [2, 2, 4, 6, 4],
    [2, 2, 4, 50, 4],
    [5, 5, 3, 5, 0],
    // States only SQL can make (DATABASE.md 3.9).
    [3, 1, 2, 4, 2],
    [3, 1, 2, 2, 1],
    [3, 1, 2, 3, 0],
    [10, 3, 2, 3, 0],
  ];
  for (const [capacity, registered, waitingCount, next, promotedCount] of cases) {
    it(`capacity ${capacity}, ${registered} registered, ${waitingCount} waiting -> ${next}: ${promotedCount} promoted`, async () => {
      const { eventId, waiting } = await eventWith({ capacity, registered, waiting: waitingCount });
      const event = asEvent(await setCapacity(eventId, { capacity: next }));
      expect(event.capacity).toBe(next);
      expect(event.registered).toBe(registered + promotedCount);
      const seated = await countOf(eventId, "registered");
      const left = await countOf(eventId, "waitlisted");
      expect(seated).toBeLessThanOrEqual(next);
      if (left > 0) expect(seated).toBe(next);
      expect(left).toBe(waitingCount - promotedCount);
      expect(regIds(await outboxOf(db.pool, eventId, "promotion"))).toEqual(ids(waiting.slice(0, promotedCount)));
    });
  }
});

describe("CP14: errors", () => {
  it("no answer contains an email address or a ticket code", async () => {
    const { eventId, seated, waiting } = await eventWith({ capacity: 2, registered: 2, waiting: 2 });
    const replies = [
      await setCapacity(eventId, { capacity: 1 }),
      await setCapacity(eventId, { capacity: 3 }),
      await setCapacity(eventId, { capacity: 3 }),
      await setCapacity(eventId, { capacity: "x" }),
    ];
    for (const reply of replies) {
      expect(reply.text).not.toContain("@");
      for (const p of [...seated, ...waiting]) expect(reply.text).not.toContain(p.ticketCode);
    }
  });
});

describe("CP15: shape", () => {
  it("answers exactly the organizer event keys, equal to GET /events/:id, without Cache-Control", async () => {
    const { eventId } = await eventWith({ capacity: 2, registered: 2, waiting: 3 });
    const res = await fetch(`${api.url}/events/${eventId}/capacity`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: owner.cookie },
      body: JSON.stringify({ capacity: 4 }),
    });
    expect(res.headers.get("cache-control")).toBeNull();
    const text = await res.text();
    const event = asEvent({ status: res.status, body: JSON.parse(text), text });
    expect(text).not.toContain("organizer_id");
    for (const key of ["capacity", "registered", "seats_left", "schedule_version"] as const) {
      expect(typeof event[key]).toBe("number");
    }
    for (const key of ["starts_at", "ends_at", "created_at"] as const) expect(event[key]).toMatch(ISO_UTC);
    expect(event).toMatchObject({ capacity: 4, registered: 4, seats_left: 0 });
    const read = await call(api, "GET", `/events/${eventId}`, { cookie: owner.cookie });
    expect(event).toEqual(read.body);
  });
});

describe("CP16: reads afterwards", () => {
  it("every read shows the new numbers and the promoted people", async () => {
    const { eventId, waiting } = await eventWith({ capacity: 2, registered: 2, waiting: 3 });
    const [w1, w2, w3] = waiting;
    asEvent(await setCapacity(eventId, { capacity: 4 }));

    expect((await call(api, "GET", `/public/events/${eventId}`)).body).toMatchObject({
      capacity: 4,
      seats_left: 0,
      full: true,
    });
    const list = (await call(api, "GET", "/public/events")).body as { events: { id: string }[] };
    expect(list.events.find((e) => e.id === eventId)).toMatchObject({ capacity: 4, seats_left: 0, full: true });

    for (const p of [w1, w2]) {
      const mine = await call(api, "GET", `/events/${eventId}/registrations/me`, { cookie: p.cookie });
      expect(mine.body).toMatchObject({ status: "registered", ticket_code: p.ticketCode, waitlist_position: null });
      const all = (await call(api, "GET", "/me/registrations", { cookie: p.cookie })).body as {
        registrations: { id: string; status: string }[];
      };
      expect(all.registrations.find((r) => r.id === p.registrationId)?.status).toBe("registered");
    }
    const still = await call(api, "GET", `/events/${eventId}/registrations/me`, { cookie: w3.cookie });
    expect(still.body).toMatchObject({ status: "waitlisted", waitlist_position: 1 });

    const organizerList = (await call(api, "GET", `/events/${eventId}/registrations`, { cookie: owner.cookie })).body as {
      registrations: { id: string; status: string }[];
    };
    for (const p of [w1, w2]) {
      expect(organizerList.registrations.find((r) => r.id === p.registrationId)?.status).toBe("registered");
    }
    expect((await call(api, "GET", `/events/${eventId}/arrivals`, { cookie: owner.cookie })).body).toMatchObject({
      capacity: 4,
      registered: 4,
    });

    const emails = await call(api, "GET", `/events/${eventId}/registrations/${w1.registrationId}/emails`, {
      cookie: owner.cookie,
    });
    expect(emails.status, emails.text).toBe(200);
    expect((emails.body as { emails: { kind: string; to_email: string }[] }).emails).toEqual([
      expect.objectContaining({ kind: "promotion", to_email: w1.email }),
    ]);
  });
});

describe("CP17: reminders go through the normal worker only", () => {
  // Own time (2032), so no other event of this file is in the reminder window.
  const R = new Date("2032-06-01T08:00:00.000Z");

  it("writes and deletes no reminder; the worker then reminds the newly seated people once", async () => {
    const { eventId, seated, waiting } = await eventWith({ capacity: 2, registered: 2, waiting: 3, startsAt: R });
    const sentEarlier = await insertOutbox(db.pool, seated[0].registrationId, {
      kind: "reminder",
      scheduleVersion: 1,
      status: "sent",
      sentAt: new Date(),
    });
    const pendingEarlier = await insertOutbox(db.pool, seated[1].registrationId, { kind: "reminder", scheduleVersion: 1 });

    asEvent(await setCapacity(eventId, { capacity: 4 }));
    expect((await outboxOf(db.pool, eventId, "reminder")).map((r) => r.id).sort()).toEqual(
      sorted([sentEarlier, pendingEarlier]),
    );

    const now = new Date(R.getTime() - HOUR);
    await enqueueReminders(db.pool, now);
    const reminders = await outboxOf(db.pool, eventId, "reminder");
    expect(regIds(reminders)).toEqual(sorted([...ids(seated), ...ids(waiting.slice(0, 2))]));
    expect(reminders.filter((r) => r.registration_id === waiting[2].registrationId)).toEqual([]);

    await enqueueReminders(db.pool, now);
    expect(await outboxOf(db.pool, eventId, "reminder")).toHaveLength(4);
  });
});

describe("CP18: writes are limited", () => {
  it("changes only events.capacity, promoted statuses and promotion rows, and logs nothing", async () => {
    const { eventId, waiting } = await eventWith({ capacity: 2, registered: 2, waiting: 3 });
    const before = await allTables(db.pool);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      asEvent(await setCapacity(eventId, { capacity: 4 }));
      expect(log).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
    const after = await allTables(db.pool);
    for (const table of ["organizers", "users"]) expect(after[table], table).toEqual(before[table]);
    expect(after.events).toEqual(before.events.map((e) => (e.id === eventId ? { ...e, capacity: 4 } : e)));
    const promoted = new Set([waiting[0].registrationId, waiting[1].registrationId]);
    expect(after.registrations).toEqual(
      before.registrations.map((r) => (promoted.has(r.id as string) ? { ...r, status: "registered" } : r)),
    );
    expect(after.outbox.filter((o) => before.outbox.some((b) => b.id === o.id))).toEqual(before.outbox);
    const added = after.outbox.filter((o) => !before.outbox.some((b) => b.id === o.id));
    expect(added.map((o) => o.kind)).toEqual(["promotion", "promotion"]);
    expect(sorted(added.map((o) => o.registration_id as string))).toEqual(sorted([...promoted]));
  });
});

describe("CP19: one transaction (tests first)", () => {
  it("waits for the same FOR UPDATE lock on the event as the register service", async () => {
    const { eventId } = await eventWith({ capacity: 2, registered: 2, waiting: 2 });
    const client = await db.pool.connect();
    let done = false;
    let pending: Promise<Reply> | undefined;
    let blocked: number | null | undefined;
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM events WHERE id = $1 FOR UPDATE", [eventId]);
      const holder = await backendPid(client);
      pending = setCapacity(eventId, { capacity: 4 }).finally(() => {
        done = true;
      });
      blocked = await waitUntilBlockedBy(db.pool, holder, () => done);
      expect(await outboxOf(db.pool, eventId, "promotion")).toEqual([]);
      expect(await storedCapacity(eventId)).toBe(2);
    } finally {
      await client.query("COMMIT");
      client.release();
    }
    expect(asEvent(await pending!).registered).toBe(4);
    expect(blocked).not.toBeNull();
  });

  it("rolls back and answers 500 internal when the outbox insert fails; nothing is written", async () => {
    const { eventId } = await eventWith({ capacity: 2, registered: 2, waiting: 3 });
    const before = await eventState(db.pool, eventId);
    const undo = failStatement(db.pool, "INSERT INTO outbox");
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expectError(await setCapacity(eventId, { capacity: 4 }), 500, "internal");
    } finally {
      undo();
      error.mockRestore();
    }
    expect(await eventState(db.pool, eventId)).toEqual(before);
    expect(asEvent(await setCapacity(eventId, { capacity: 4 })).registered).toBe(4);
  });
});

// For the races: the promotion and ticket rows of each registration.
async function emailKindsByRegistration(eventId: string): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  for (const row of await outboxOf(db.pool, eventId)) {
    map.set(row.registration_id, [...(map.get(row.registration_id) ?? []), row.kind].sort());
  }
  return map;
}

describe("CP20: lock race with register (tests first)", () => {
  for (let round = 0; round < 3; round++) {
    it(`a raise to 6 and 20 registrations: 6 seats, the queue intact, one email each (round ${round})`, async () => {
      const { eventId, seated, waiting } = await eventWith({ capacity: 2, registered: 2, waiting: 3 });
      const newcomers = await Promise.all(Array.from({ length: 20 }, () => attendee(db.pool)));
      const replies = await Promise.all([
        setCapacity(eventId, { capacity: 6 }),
        ...newcomers.map((a) => call(api, "POST", `/events/${eventId}/registrations`, { cookie: a.cookie })),
      ]);
      expect(replies[0].status, replies[0].text).toBe(200);
      for (const reply of replies.slice(1)) expect([200, 201], reply.text).toContain(reply.status);

      expect(await countOf(eventId, "registered")).toBe(6);
      expect(await countOf(eventId, "waitlisted")).toBe(19);
      expect(await waitingPlaces(eventId)).toEqual(Array.from({ length: 19 }, (_v, i) => i + 1));
      for (const p of waiting) expect(await statusOf(p.registrationId)).toBe("registered");

      const kinds = await emailKindsByRegistration(eventId);
      const seatedBefore = new Set(ids(seated));
      for (const row of await registrationsOf(eventId)) {
        const mine = kinds.get(row.id) ?? [];
        if (seatedBefore.has(row.id)) expect(mine).toEqual([]);
        else if (row.status === "registered") expect([["promotion"], ["ticket"]]).toContainEqual(mine);
        else expect(mine).toEqual([]);
      }
      for (const p of waiting) expect(kinds.get(p.registrationId)).toEqual(["promotion"]);
    });
  }
});

describe("CP21: the change reads after the lock (tests first)", () => {
  it("promotes a waiting row added while it waited for the lock", async () => {
    const { eventId, waiting } = await eventWith({ capacity: 2, registered: 2, waiting: 1 });
    const client = await db.pool.connect();
    let done = false;
    let pending: Promise<Reply> | undefined;
    let blocked: number | null | undefined;
    let added: string | undefined;
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM events WHERE id = $1 FOR UPDATE", [eventId]);
      const holder = await backendPid(client);
      pending = setCapacity(eventId, { capacity: 5 }).finally(() => {
        done = true;
      });
      blocked = await waitUntilBlockedBy(db.pool, holder, () => done);
      const userId = await insertUser(db.pool);
      const { rows } = await client.query<{ id: string }>(
        "INSERT INTO registrations (event_id, user_id, status, ticket_code) VALUES ($1, $2, 'waitlisted', $3) RETURNING id",
        [eventId, userId, makeTicketCode()],
      );
      added = rows[0].id;
    } finally {
      await client.query("COMMIT");
      client.release();
    }
    expect(blocked).not.toBeNull();
    expect(asEvent(await pending!)).toMatchObject({ registered: 4, seats_left: 1 });
    expect(await statusOf(waiting[0].registrationId)).toBe("registered");
    expect(await statusOf(added!)).toBe("registered");
    expect(regIds(await outboxOf(db.pool, eventId, "promotion"))).toEqual(sorted([waiting[0].registrationId, added!]));
  });

  it("answers 409 event_cancelled and writes nothing when the event was cancelled while it waited", async () => {
    const { eventId } = await eventWith({ capacity: 2, registered: 2, waiting: 2 });
    const client = await db.pool.connect();
    let done = false;
    let pending: Promise<Reply> | undefined;
    let blocked: number | null | undefined;
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM events WHERE id = $1 FOR UPDATE", [eventId]);
      const holder = await backendPid(client);
      pending = setCapacity(eventId, { capacity: 5 }).finally(() => {
        done = true;
      });
      blocked = await waitUntilBlockedBy(db.pool, holder, () => done);
      await client.query("UPDATE events SET status = 'cancelled', cancelled_at = now() WHERE id = $1", [eventId]);
    } finally {
      await client.query("COMMIT");
      client.release();
    }
    const before = await eventState(db.pool, eventId);
    expect(blocked).not.toBeNull();
    expectError(await pending!, 409, "event_cancelled");
    expect(await eventState(db.pool, eventId)).toEqual(before);
  });

  it("uses the schedule version committed while it waited", async () => {
    const { eventId, waiting } = await eventWith({ capacity: 1, registered: 1, waiting: 1 });
    const client = await db.pool.connect();
    let done = false;
    let pending: Promise<Reply> | undefined;
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM events WHERE id = $1 FOR UPDATE", [eventId]);
      const holder = await backendPid(client);
      pending = setCapacity(eventId, { capacity: 2 }).finally(() => {
        done = true;
      });
      await waitUntilBlockedBy(db.pool, holder, () => done);
      await client.query("UPDATE events SET starts_at = $2, schedule_version = 2 WHERE id = $1", [eventId, B]);
    } finally {
      await client.query("COMMIT");
      client.release();
    }
    asEvent(await pending!);
    expect(await outboxOf(db.pool, eventId, "promotion")).toEqual([
      expect.objectContaining({ registration_id: waiting[0].registrationId, schedule_version: 2, event_starts_at: B }),
    ]);
  });
});

describe("CP22: raise against cancelRegistration (tests first)", () => {
  for (let round = 0; round < 5; round++) {
    it(`A cancels while the capacity goes to 3: B and the two first waiting people are seated (round ${round})`, async () => {
      const { eventId, seated, waiting } = await eventWith({ capacity: 2, registered: 2, waiting: 4 });
      const [a, b] = seated;
      const [cancel, raise] = await Promise.all([
        call(api, "POST", `/events/${eventId}/registrations/me/cancel`, { cookie: a.cookie }),
        setCapacity(eventId, { capacity: 3 }),
      ]);
      expect(cancel.status, cancel.text).toBe(200);
      expect(raise.status, raise.text).toBe(200);

      expect(await statusOf(a.registrationId)).toBe("cancelled");
      const seatedNow = (await registrationsOf(eventId)).filter((r) => r.status === "registered").map((r) => r.id);
      expect(sorted(seatedNow)).toEqual(sorted([b.registrationId, waiting[0].registrationId, waiting[1].registrationId]));
      const promotions = await outboxOf(db.pool, eventId, "promotion");
      expect(regIds(promotions)).toEqual(ids(waiting.slice(0, 2)));
      expect(await waitingPlaces(eventId)).toEqual([1, 2]);
    });
  }
});

describe("CP23: two capacity changes at once (tests first)", () => {
  for (let round = 0; round < 3; round++) {
    it(`(a) the same value twice: one effect (round ${round})`, async () => {
      const { eventId, waiting } = await eventWith({ capacity: 2, registered: 2, waiting: 4 });
      const replies = await Promise.all([setCapacity(eventId, { capacity: 4 }), setCapacity(eventId, { capacity: 4 })]);
      for (const reply of replies) expect(asEvent(reply)).toMatchObject({ capacity: 4, registered: 4 });
      expect(regIds(await outboxOf(db.pool, eventId, "promotion"))).toEqual(ids(waiting.slice(0, 2)));
      expect(await waitingPlaces(eventId)).toEqual([1, 2]);
    });

    it(`(b) raises to 4 and 6 over 5 waiting: one promotion row per seated person (round ${round})`, async () => {
      const { eventId } = await eventWith({ capacity: 2, registered: 2, waiting: 5 });
      const [four, six] = await Promise.all([setCapacity(eventId, { capacity: 4 }), setCapacity(eventId, { capacity: 6 })]);
      asEvent(six);
      const final = await storedCapacity(eventId);
      expect([4, 6]).toContain(final);
      if (four.status !== 200) {
        // The raise to 6 committed first and seated 6 people, so 4 is below the
        // count (CP5).
        expect(four.status, four.text).toBe(409);
        expect(four.body).toEqual({ error: "capacity_below_registered", registered: 6 });
      }
      expect(await countOf(eventId, "registered")).toBe(Math.min(final, 7));
      const promotions = await outboxOf(db.pool, eventId, "promotion");
      expect(promotions).toHaveLength(Math.min(final, 7) - 2);
      expect(new Set(promotions.map((r) => r.registration_id)).size).toBe(promotions.length);
    });

    it(`(c) a raise and a lowering to the count: never more seated than capacity (round ${round})`, async () => {
      // A state only SQL can make: 2 seated of 4, 3 waiting.
      const { eventId } = await eventWith({ capacity: 4, registered: 2, waiting: 3 });
      const [raise, lower] = await Promise.all([setCapacity(eventId, { capacity: 6 }), setCapacity(eventId, { capacity: 2 })]);
      asEvent(raise);
      if (lower.status !== 200) {
        expect(lower.status, lower.text).toBe(409);
        expect(lower.body).toEqual({ error: "capacity_below_registered", registered: 5 });
      }
      const seated = await countOf(eventId, "registered");
      expect(seated).toBeLessThanOrEqual(await storedCapacity(eventId));
      const promotions = await outboxOf(db.pool, eventId, "promotion");
      expect(promotions).toHaveLength(seated - 2);
      expect(new Set(promotions.map((r) => r.registration_id)).size).toBe(promotions.length);
    });
  }
});

describe("CP24: against the M7 routes (tests first)", () => {
  for (let round = 0; round < 4; round++) {
    it(`(a) a raise and an event cancel at once: the event ends cancelled (round ${round})`, async () => {
      const { eventId, seated, waiting } = await eventWith({ capacity: 2, registered: 2, waiting: 3 });
      const [raise, cancelled] = await Promise.all([setCapacity(eventId, { capacity: 4 }), cancelEvent(api, eventId, owner.cookie)]);
      expect(cancelled.status, cancelled.text).toBe(200);
      expect((await eventState(db.pool, eventId)).event?.status).toBe("cancelled");

      const promotions = await outboxOf(db.pool, eventId, "promotion");
      if (raise.status === 200) {
        expect(regIds(promotions)).toEqual(ids(waiting.slice(0, 2)));
        expect(await storedCapacity(eventId)).toBe(4);
      } else {
        expectError(raise, 409, "event_cancelled");
        expect(promotions).toEqual([]);
        expect(await storedCapacity(eventId)).toBe(2);
      }
      expect(regIds(await outboxOf(db.pool, eventId, "event_cancelled"))).toEqual(ids([...seated, ...waiting]));
      expect(await countOf(eventId, "registered")).toBe(0);
      expect(await countOf(eventId, "waitlisted")).toBe(0);
    });

    it(`(b) a raise and a reschedule at once: promotion rows carry the version read under the lock (round ${round})`, async () => {
      const { eventId, waiting } = await eventWith({ capacity: 2, registered: 2, waiting: 3 });
      const [raise, moved] = await Promise.all([
        setCapacity(eventId, { capacity: 4 }),
        reschedule(api, eventId, { starts_at: B.toISOString() }, owner.cookie),
      ]);
      asEvent(raise);
      asEvent(moved);
      const promotions = await outboxOf(db.pool, eventId, "promotion");
      expect(regIds(promotions)).toEqual(ids(waiting.slice(0, 2)));
      const version = promotions[0].schedule_version;
      expect([1, 2]).toContain(version);
      for (const row of promotions) {
        expect(row.schedule_version).toBe(version);
        expect(row.event_starts_at).toEqual(version === 2 ? B : A);
      }
      expect((await eventState(db.pool, eventId)).event).toMatchObject({ schedule_version: 2, capacity: 4 });
    });
  }
});
