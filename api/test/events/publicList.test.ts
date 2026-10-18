import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mintSessionCookie, type Running } from "../auth/helpers.js";
import { createTestDb, insertEvent, insertRegistration, insertUser, uniqueEmail, type TestDb } from "../db/helpers.js";
import { call, DAY, HOUR, MINUTE, organizer, PUBLIC_KEYS, startApi, type Account } from "./helpers.js";

// GET /public/events (docs/specs/events-public-list.md PL1-PL11). Rows are made
// with SQL and deleted after each test. Answers are filtered by the ids a test
// inserted, so other rows never change the result (PL9 uses a far-future clock).

let db: TestDb;
let api: Running;
let owner: Account;

// Rows made by the current test, deleted in afterEach.
let madeEvents: string[] = [];
let madeUsers: string[] = [];

beforeAll(async () => {
  db = await createTestDb();
  api = startApi(db.pool);
  owner = await organizer(db.pool);
});

afterAll(async () => {
  await api?.close();
  await db?.drop();
});

afterEach(async () => {
  vi.useRealTimers();
  await db.pool.query("DELETE FROM registrations WHERE event_id = ANY($1::uuid[])", [madeEvents]);
  await db.pool.query("DELETE FROM events WHERE id = ANY($1::uuid[])", [madeEvents]);
  await db.pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [madeUsers]);
  madeEvents = [];
  madeUsers = [];
});

// The public list item, in the order of PL5: the public event without description.
const LIST_KEYS = PUBLIC_KEYS.filter((key) => key !== "description");

// A fixed server clock for the tests that need exact times.
const T0 = new Date("2031-03-01T12:00:00.000Z");

type ListItem = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  duration_minutes: number;
  capacity: number;
  status: string;
  has_started: boolean;
  seats_left: number;
  full: boolean;
};

// Moves the clock of this process (the app runs in it) to `at`. Only Date is faked.
function setNow(at: Date): void {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(at);
}

async function event(options: Parameters<typeof insertEvent>[2] = {}): Promise<string> {
  const id = await insertEvent(db.pool, owner.id, options);
  madeEvents.push(id);
  return id;
}

async function user(email?: string): Promise<string> {
  const id = await insertUser(db.pool, email);
  madeUsers.push(id);
  return id;
}

async function cancelInDb(id: string): Promise<void> {
  await db.pool.query("UPDATE events SET status = 'cancelled', cancelled_at = now() WHERE id = $1", [id]);
}

// GET /public/events; fails the test unless the answer is 200.
async function list(options: { cookie?: string; query?: string } = {}): Promise<ListItem[]> {
  const reply = await call(api, "GET", `/public/events${options.query ?? ""}`, { cookie: options.cookie });
  expect(reply.status, reply.text).toBe(200);
  return (reply.body as { events: ListItem[] }).events;
}

// The listed ids that this test inserted, in the answered order.
async function listedIds(at: Date, ids: string[]): Promise<string[]> {
  setNow(at);
  try {
    return (await list()).map((item) => item.id).filter((id) => ids.includes(id));
  } finally {
    vi.useRealTimers();
  }
}

describe("PL2: only events that are not cancelled and not ended (tests first)", () => {
  it("lists upcoming and running events, not passed or cancelled ones", async () => {
    const upcoming = await event({ startsAt: new Date(T0.getTime() + HOUR), durationMinutes: 60 });
    const running = await event({ startsAt: new Date(T0.getTime() - 30 * MINUTE), durationMinutes: 60 });
    const passed = await event({ startsAt: new Date(T0.getTime() - 2 * HOUR), durationMinutes: 60 });
    const cancelled = await event({ startsAt: new Date(T0.getTime() + HOUR), durationMinutes: 60 });
    await cancelInDb(cancelled);

    const ids = await listedIds(T0, [upcoming, running, passed, cancelled]);
    expect(ids).toEqual([running, upcoming]);
  });

  it("lists an event one millisecond before its end and not from exactly ends_at", async () => {
    const startsAt = new Date(T0.getTime() - 90 * MINUTE);
    const endsAt = new Date(startsAt.getTime() + 90 * MINUTE);
    const id = await event({ startsAt, durationMinutes: 90 });

    expect(await listedIds(new Date(endsAt.getTime() - 1), [id])).toEqual([id]);
    expect(await listedIds(endsAt, [id])).toEqual([]);
    expect(await listedIds(new Date(endsAt.getTime() + DAY), [id])).toEqual([]);
  });

  it("lists an event before and at its start (has_started false, then true)", async () => {
    const startsAt = new Date(T0.getTime() + HOUR);
    const id = await event({ startsAt, durationMinutes: 30 });

    for (const [at, started] of [
      [new Date(startsAt.getTime() - 1), false],
      [startsAt, true],
    ] as const) {
      setNow(at);
      try {
        const item = (await list()).find((e) => e.id === id);
        expect(item).toMatchObject({ status: "active", has_started: started });
      } finally {
        vi.useRealTimers();
      }
    }
  });

  it("uses the real server clock when nothing is injected", async () => {
    const future = await event({ startsAt: new Date(Date.now() + DAY) });
    const running = await event({ startsAt: new Date(Date.now() - 30 * MINUTE), durationMinutes: 60 });
    const ended = await event({ startsAt: new Date(Date.now() - 2 * HOUR), durationMinutes: 60 });

    const ids = (await list()).map((item) => item.id).filter((id) => [future, running, ended].includes(id));
    expect(ids).toEqual([running, future]);
  });
});

describe("PL3: cancelled wins (tests first)", () => {
  it("does not list a cancelled event that is still upcoming or running", async () => {
    const cancelledUpcoming = await event({ startsAt: new Date(T0.getTime() + DAY), durationMinutes: 60 });
    const cancelledRunning = await event({ startsAt: new Date(T0.getTime() - 10 * MINUTE), durationMinutes: 60 });
    const cancelledPassed = await event({ startsAt: new Date(T0.getTime() - DAY), durationMinutes: 60 });
    for (const id of [cancelledUpcoming, cancelledRunning, cancelledPassed]) await cancelInDb(id);

    expect(await listedIds(T0, [cancelledUpcoming, cancelledRunning, cancelledPassed])).toEqual([]);
  });
});

describe("PL4: order by starts_at, then id (tests first)", () => {
  it("puts a running event before upcoming ones, soonest first", async () => {
    const later = await event({ startsAt: new Date(T0.getTime() + 2 * DAY) });
    const soon = await event({ startsAt: new Date(T0.getTime() + HOUR) });
    const running = await event({ startsAt: new Date(T0.getTime() - 20 * MINUTE), durationMinutes: 60 });
    const middle = await event({ startsAt: new Date(T0.getTime() + DAY) });

    expect(await listedIds(T0, [later, soon, running, middle])).toEqual([running, soon, middle, later]);
  });

  it("orders events with the same starts_at by id ascending", async () => {
    const startsAt = new Date(T0.getTime() + 3 * HOUR);
    const tied: string[] = [];
    for (let i = 0; i < 5; i++) tied.push(await event({ startsAt }));
    const before = await event({ startsAt: new Date(startsAt.getTime() - 1) });
    const after = await event({ startsAt: new Date(startsAt.getTime() + 1) });

    const byId = [...tied].sort();
    expect(await listedIds(T0, [...tied, before, after])).toEqual([before, ...byId, after]);
  });
});

describe("PL5: the item shape (tests first)", () => {
  it("answers exactly id, title, starts_at, ends_at, duration_minutes, capacity, status, has_started, seats_left, full", async () => {
    const id = await event({
      title: "Open day",
      description: "A long text that the list never shows.",
      capacity: 7,
      startsAt: new Date("2031-03-02T10:00:00Z"),
      durationMinutes: 90,
    });
    await insertRegistration(db.pool, id, await user(), "registered");

    setNow(T0);
    const reply = await call(api, "GET", "/public/events");
    vi.useRealTimers();
    expect(reply.status).toBe(200);
    expect(Object.keys(reply.body as object)).toEqual(["events"]);

    const items = (reply.body as { events: Record<string, unknown>[] }).events;
    for (const item of items) expect(Object.keys(item)).toEqual(LIST_KEYS);

    expect(items.find((item) => item.id === id)).toEqual({
      id,
      title: "Open day",
      starts_at: "2031-03-02T10:00:00.000Z",
      ends_at: "2031-03-02T11:30:00.000Z",
      duration_minutes: 90,
      capacity: 7,
      status: "active",
      has_started: false,
      seats_left: 6,
      full: false,
    });
    expect(reply.text).not.toContain("description");
    expect(reply.text).not.toContain("A long text");
  });

  it("answers has_started true and status active for a running event, with the same keys", async () => {
    const id = await event({
      capacity: 2,
      startsAt: new Date(T0.getTime() - 10 * MINUTE),
      durationMinutes: 60,
    });

    setNow(T0);
    let item: ListItem | undefined;
    try {
      item = (await list()).find((e) => e.id === id);
    } finally {
      vi.useRealTimers();
    }
    expect(Object.keys(item!)).toEqual(LIST_KEYS);
    expect(item).toMatchObject({
      status: "active",
      has_started: true,
      starts_at: new Date(T0.getTime() - 10 * MINUTE).toISOString(),
      ends_at: new Date(T0.getTime() + 50 * MINUTE).toISOString(),
      seats_left: 2,
      full: false,
    });
  });
});

describe("PL6: privacy (tests first)", () => {
  it("answers only the key events and no organizer, registration or person data", async () => {
    const email = uniqueEmail("secret-attendee");
    const userId = await user(email);
    const eventId = await event({ capacity: 5, startsAt: new Date(Date.now() + DAY) });
    const { ticketCode } = await insertRegistration(db.pool, eventId, userId, "registered");
    const waiting = await user();
    const { ticketCode: waitingCode } = await insertRegistration(db.pool, eventId, waiting, "waitlisted");

    const reply = await call(api, "GET", "/public/events");
    expect(reply.status).toBe(200);
    expect(Object.keys(reply.body as object)).toEqual(["events"]);
    const items = (reply.body as { events: Record<string, unknown>[] }).events;
    expect(items.map((item) => item.id)).toContain(eventId);

    for (const item of items) {
      for (const forbidden of ["organizer_id", "registered", "schedule_version", "created_at", "cancelled_at"]) {
        expect(item, forbidden).not.toHaveProperty(forbidden);
      }
    }
    for (const hidden of [
      "organizer_id",
      "registered",
      "schedule_version",
      "created_at",
      "cancelled_at",
      "registrations",
      "ticket",
      "user_id",
      "email",
      "name",
      owner.id,
      userId,
      waiting,
      email,
      ticketCode,
      waitingCode,
      "Attendee",
      "Organizer",
    ]) {
      expect(reply.text, hidden).not.toContain(hidden);
    }
  });
});

describe("PL1: no login needed", () => {
  it("answers the same 200 with no cookie, an attendee cookie and organizer cookies", async () => {
    const id = await event({ startsAt: new Date(T0.getTime() + DAY) });
    const personId = await user();
    const other = await event({ startsAt: new Date(T0.getTime() + 2 * DAY) });
    // Cookies issued at T0, so they are valid on the faked clock.
    const cookies = [
      await mintSessionCookie("user", personId, T0.getTime()),
      await mintSessionCookie("organizer", owner.id, T0.getTime()),
      "session=garbage",
    ];

    setNow(T0);
    try {
      const anonymous = await call(api, "GET", "/public/events");
      expect(anonymous.status).toBe(200);
      const ids = (anonymous.body as { events: ListItem[] }).events.map((item) => item.id);
      expect(ids.filter((x) => x === id || x === other)).toEqual([id, other]);

      for (const cookie of cookies) {
        const reply = await call(api, "GET", "/public/events", { cookie });
        expect(reply.status, cookie).toBe(200);
        expect(reply.text, cookie).toBe(anonymous.text);
      }
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("PL7: seats", () => {
  it("lists a full event with seats_left 0 and full true", async () => {
    const id = await event({ capacity: 1, startsAt: new Date(T0.getTime() + DAY) });
    await insertRegistration(db.pool, id, await user(), "registered");

    setNow(T0);
    try {
      expect((await list()).find((e) => e.id === id)).toMatchObject({
        capacity: 1,
        seats_left: 0,
        full: true,
        status: "active",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not count waitlisted and cancelled registrations", async () => {
    const id = await event({ capacity: 3, startsAt: new Date(T0.getTime() + DAY) });
    await insertRegistration(db.pool, id, await user(), "registered");
    await insertRegistration(db.pool, id, await user(), "waitlisted");
    await insertRegistration(db.pool, id, await user(), "waitlisted");
    await insertRegistration(db.pool, id, await user(), "cancelled");

    setNow(T0);
    try {
      expect((await list()).find((e) => e.id === id)).toMatchObject({ capacity: 3, seats_left: 2, full: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it("never answers below 0 seats left", async () => {
    const id = await event({ capacity: 1, startsAt: new Date(T0.getTime() + DAY) });
    await insertRegistration(db.pool, id, await user(), "registered");
    await insertRegistration(db.pool, id, await user(), "registered");

    setNow(T0);
    try {
      expect((await list()).find((e) => e.id === id)).toMatchObject({ seats_left: 0, full: true });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("PL8: at most 100 events", () => {
  it("answers the first 100 in order and ignores any query string", async () => {
    // A clock and start times before any other row, so these 101 come first.
    const now = new Date("2001-01-01T00:00:00.000Z");
    const { rows } = await db.pool.query<{ id: string }>(
      `INSERT INTO events (organizer_id, title, starts_at, capacity)
       SELECT $1, 'Bulk ' || i, $2::timestamptz + make_interval(mins => i), 5
       FROM generate_series(1, 101) AS i
       RETURNING id`,
      [owner.id, now],
    );
    const ids = rows.map((row) => row.id);
    madeEvents.push(...ids);
    const { rows: ordered } = await db.pool.query<{ id: string }>(
      "SELECT id FROM events WHERE id = ANY($1::uuid[]) ORDER BY starts_at, id",
      [ids],
    );
    const expected = ordered.map((row) => row.id).slice(0, 100);

    setNow(now);
    try {
      for (const query of ["", "?limit=500", "?cursor=abc&offset=100&page=2", "?sort=desc&status=cancelled"]) {
        const reply = await call(api, "GET", `/public/events${query}`);
        expect(reply.status, query).toBe(200);
        expect(Object.keys(reply.body as object), query).toEqual(["events"]);
        const events = (reply.body as { events: ListItem[] }).events;
        expect(events, query).toHaveLength(100);
        expect(events.map((item) => item.id), query).toEqual(expected);
      }
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("PL9: empty list", () => {
  it("answers 200 with events [] when no event qualifies", async () => {
    await event({ startsAt: new Date(T0.getTime() + DAY) });

    setNow(new Date("9999-01-01T00:00:00.000Z"));
    try {
      const reply = await call(api, "GET", "/public/events");
      expect(reply.status).toBe(200);
      expect(reply.body).toEqual({ events: [] });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("PL10: errors", () => {
  it("answers 500 internal when the database fails", async () => {
    const query = vi.spyOn(db.pool, "query").mockRejectedValueOnce(new Error("database is down"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const reply = await call(api, "GET", "/public/events");
      expect(reply).toMatchObject({ status: 500, body: { error: "internal" } });
    } finally {
      query.mockRestore();
      errors.mockRestore();
    }
  });

  it("answers the app's 404 not_found to other methods", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const res = await fetch(`${api.url}/public/events`, { method });
      expect(res.status, method).toBe(404);
      expect(await res.json(), method).toEqual({ error: "not_found" });
    }
  });
});

describe("PL11: GET /public/events/:id is unchanged", () => {
  it("still answers the public event with description, also for cancelled and passed ids", async () => {
    const open = await event({ startsAt: new Date(T0.getTime() + DAY), description: "Bring a laptop." });
    const cancelled = await event({ startsAt: new Date(T0.getTime() + DAY) });
    await cancelInDb(cancelled);
    const passed = await event({ startsAt: new Date(T0.getTime() - DAY), durationMinutes: 60 });

    setNow(T0);
    try {
      const expected = { [open]: "active", [cancelled]: "cancelled", [passed]: "passed" };
      for (const [id, status] of Object.entries(expected)) {
        const reply = await call(api, "GET", `/public/events/${id}`);
        expect(reply.status, id).toBe(200);
        expect(Object.keys(reply.body as object)).toEqual(PUBLIC_KEYS);
        expect(reply.body).toMatchObject({ id, status });
      }
      const detail = await call(api, "GET", `/public/events/${open}`);
      expect(detail.body).toMatchObject({ description: "Bring a laptop." });
    } finally {
      vi.useRealTimers();
    }
  });
});
