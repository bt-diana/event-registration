import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Running } from "../auth/helpers.js";
import { createTestDb, insertEvent, insertRegistration, insertUser, type TestDb } from "../db/helpers.js";
import {
  call,
  countEvents,
  DAY,
  HOUR,
  MALFORMED_IDS,
  organizer,
  ORGANIZER_KEYS,
  startApi,
  type Account,
} from "./helpers.js";

// POST /events, GET /events, GET /events/:id (events.md E1-E3, E5, E6, E8, E10, E17, E18).

let db: TestDb;
let api: Running;
let owner: Account;

beforeAll(async () => {
  db = await createTestDb();
  api = startApi(db.pool);
  owner = await organizer(db.pool);
});

afterAll(async () => {
  await api?.close();
  await db?.drop();
});

type OrganizerEvent = {
  id: string;
  title: string;
  description: string;
  starts_at: string;
  ends_at: string;
  duration_minutes: number;
  capacity: number;
  registered: number;
  seats_left: number;
  status: string;
  schedule_version: number;
  cancelled_at: string | null;
  created_at: string;
};

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "Spring meetup",
    starts_at: "2030-01-01T10:00:00Z",
    duration_minutes: 90,
    capacity: 25,
    ...overrides,
  };
}

async function create(body: unknown, account: Account = owner) {
  return call(api, "POST", "/events", { body, cookie: account.cookie });
}

async function list(account: Account = owner): Promise<OrganizerEvent[]> {
  const reply = await call(api, "GET", "/events", { cookie: account.cookie });
  expect(reply.status, reply.text).toBe(200);
  return (reply.body as { events: OrganizerEvent[] }).events;
}

async function read(id: string, account: Account = owner): Promise<OrganizerEvent> {
  const reply = await call(api, "GET", `/events/${id}`, { cookie: account.cookie });
  expect(reply.status, reply.text).toBe(200);
  return reply.body as OrganizerEvent;
}

describe("E1: POST /events creates one event owned by the caller", () => {
  it("answers 201 with the organizer event shape and stores one row with the cookie's organizer id", async () => {
    const author = await organizer(db.pool);
    const before = await countEvents(db.pool);
    const startedAt = Date.now();

    const reply = await create(validBody(), author);
    expect(reply.status, reply.text).toBe(201);
    expect(Object.keys(reply.body as object)).toEqual(ORGANIZER_KEYS);
    const event = reply.body as OrganizerEvent;
    expect(event).toEqual({
      id: expect.any(String),
      title: "Spring meetup",
      description: "",
      starts_at: "2030-01-01T10:00:00.000Z",
      ends_at: "2030-01-01T11:30:00.000Z",
      duration_minutes: 90,
      capacity: 25,
      registered: 0,
      seats_left: 25,
      status: "active",
      schedule_version: 1,
      cancelled_at: null,
      created_at: expect.stringMatching(ISO_UTC),
    });
    expect(Date.parse(event.created_at)).toBeGreaterThanOrEqual(startedAt - HOUR);
    expect(reply.text).not.toContain("organizer_id");

    expect(await countEvents(db.pool)).toBe(before + 1);
    const { rows } = await db.pool.query(
      "SELECT organizer_id, status, schedule_version, cancelled_at FROM events WHERE id = $1",
      [event.id],
    );
    expect(rows).toEqual([{ organizer_id: author.id, status: "active", schedule_version: 1, cancelled_at: null }]);
  });

  it("ignores organizer_id, status and other extra fields in the body", async () => {
    const author = await organizer(db.pool);
    const other = await organizer(db.pool);
    const reply = await create(
      validBody({
        organizer_id: other.id,
        status: "cancelled",
        schedule_version: 7,
        cancelled_at: "2030-01-01T00:00:00Z",
        registered: 3,
        id: "01900000-0000-7000-8000-000000000001",
      }),
      author,
    );
    expect(reply.status, reply.text).toBe(201);
    const event = reply.body as OrganizerEvent;
    expect(event).toMatchObject({ status: "active", schedule_version: 1, cancelled_at: null, registered: 0 });
    expect(event.id).not.toBe("01900000-0000-7000-8000-000000000001");

    const { rows } = await db.pool.query("SELECT organizer_id, status FROM events WHERE id = $1", [event.id]);
    expect(rows).toEqual([{ organizer_id: author.id, status: "active" }]);
    expect(await list(other)).toEqual([]);
  });
});

describe("E2: create validation", () => {
  const future = () => new Date(Date.now() + DAY).toISOString();
  const bad: Array<[string, { body?: unknown; raw?: string }]> = [
    ["no body", {}],
    ["array", { raw: "[]" }],
    ["array with an object", { raw: JSON.stringify([validBody()]) }],
    ["string", { raw: '"text"' }],
    ["number", { raw: "5" }],
    ["null", { raw: "null" }],
    ["bad JSON", { raw: "{" }],
    ["empty object", { body: {} }],
    ["title missing", { body: validBody({ title: undefined }) }],
    ["title null", { body: validBody({ title: null }) }],
    ["title a number", { body: validBody({ title: 5 }) }],
    ["title empty", { body: validBody({ title: "" }) }],
    ["title blank", { body: validBody({ title: "  \t\n " }) }],
    ["title 201 characters", { body: validBody({ title: "x".repeat(201) }) }],
    ["title 201 code points", { body: validBody({ title: "\u{1F600}".repeat(201) }) }],
    ["title with NUL", { body: validBody({ title: "a\u0000b" }) }],
    ["starts_at missing", { body: validBody({ starts_at: undefined }) }],
    ["starts_at a number", { body: validBody({ starts_at: Date.now() + DAY }) }],
    ["starts_at not a date", { body: validBody({ starts_at: "next friday" }) }],
    ["starts_at without offset", { body: validBody({ starts_at: "2030-01-01T10:00:00" }) }],
    ["starts_at date only", { body: validBody({ starts_at: "2030-01-01" }) }],
    ["starts_at impossible day", { body: validBody({ starts_at: "2030-02-30T10:00:00Z" }) }],
    ["starts_at hour 25", { body: validBody({ starts_at: "2030-01-01T25:00:00Z" }) }],
    ["starts_at space instead of T", { body: validBody({ starts_at: "2030-01-01 10:00:00Z" }) }],
    ["starts_at in the past", { body: validBody({ starts_at: "2020-01-01T10:00:00Z" }) }],
    ["starts_at a second ago", { body: validBody({ starts_at: new Date(Date.now() - 1000).toISOString() }) }],
    ["capacity missing", { body: validBody({ capacity: undefined }) }],
    ["capacity a string", { body: validBody({ capacity: "10" }) }],
    ["capacity a fraction", { body: validBody({ capacity: 1.5 }) }],
    ["capacity 0", { body: validBody({ capacity: 0 }) }],
    ["capacity -1", { body: validBody({ capacity: -1 }) }],
    ["capacity 100001", { body: validBody({ capacity: 100001 }) }],
    ["capacity null", { body: validBody({ capacity: null }) }],
    ["duration missing", { body: validBody({ duration_minutes: undefined }) }],
    ["duration a string", { body: validBody({ duration_minutes: "60" }) }],
    ["duration a fraction", { body: validBody({ duration_minutes: 30.5 }) }],
    ["duration 0", { body: validBody({ duration_minutes: 0 }) }],
    ["duration -1", { body: validBody({ duration_minutes: -1 }) }],
    ["duration 1441", { body: validBody({ duration_minutes: 1441 }) }],
    ["duration null", { body: validBody({ duration_minutes: null }) }],
  ];

  it.each(bad)("answers 400 invalid_input and writes nothing: %s", async (_name, input) => {
    const before = await countEvents(db.pool);
    const reply = await call(api, "POST", "/events", { ...input, cookie: owner.cookie });
    expect(reply.status, reply.text).toBe(400);
    expect(reply.body).toEqual({ error: "invalid_input" });
    expect(await countEvents(db.pool)).toBe(before);
  });

  it("accepts the limits: title of 200 code points, capacity 1 and 100000, duration 1 and 1440", async () => {
    const ok: Array<Record<string, unknown>> = [
      validBody({ title: "x".repeat(200), starts_at: future() }),
      validBody({ title: "\u{1F600}".repeat(200) }),
      validBody({ capacity: 1 }),
      validBody({ capacity: 100000 }),
      validBody({ duration_minutes: 1 }),
      validBody({ duration_minutes: 1440 }),
      validBody({ starts_at: "2030-01-01T10:00Z" }),
      validBody({ starts_at: "2030-01-01T10:00:00.5+05:30" }),
    ];
    for (const body of ok) {
      const reply = await create(body);
      expect(reply.status, `${JSON.stringify(body)} ${reply.text}`).toBe(201);
    }
  });
});

describe("E3: stored values", () => {
  it("trims the title, stores the instant of starts_at, answers it in UTC, keeps duration_minutes", async () => {
    const reply = await create(
      validBody({ title: "  Spaced title \n", starts_at: "2030-06-01T12:30:00+02:00", duration_minutes: 45 }),
    );
    expect(reply.status, reply.text).toBe(201);
    const event = reply.body as OrganizerEvent;
    expect(event).toMatchObject({
      title: "Spaced title",
      starts_at: "2030-06-01T10:30:00.000Z",
      ends_at: "2030-06-01T11:15:00.000Z",
      duration_minutes: 45,
    });

    const { rows } = await db.pool.query<{ title: string; starts_at: Date; duration_minutes: number }>(
      "SELECT title, starts_at, duration_minutes FROM events WHERE id = $1",
      [event.id],
    );
    expect(rows[0].title).toBe("Spaced title");
    expect(rows[0].starts_at.toISOString()).toBe("2030-06-01T10:30:00.000Z");
    expect(rows[0].duration_minutes).toBe(45);
  });

  it("keeps milliseconds and negative offsets", async () => {
    const reply = await create(validBody({ starts_at: "2030-01-01T23:15:30.250-08:00" }));
    expect(reply.status, reply.text).toBe(201);
    expect((reply.body as OrganizerEvent).starts_at).toBe("2030-01-02T07:15:30.250Z");
  });
});

describe("E5: list order", () => {
  it("lists every event of the organizer by starts_at, then id, past and cancelled too", async () => {
    const author = await organizer(db.pool);
    const same = new Date("2031-05-05T09:00:00Z");
    const later = await insertEvent(db.pool, author.id, { startsAt: new Date("2032-01-01T00:00:00Z") });
    const sameA = await insertEvent(db.pool, author.id, { startsAt: same });
    const past = await insertEvent(db.pool, author.id, { startsAt: new Date(Date.now() - 30 * DAY) });
    const sameB = await insertEvent(db.pool, author.id, { startsAt: same });
    const cancelled = await insertEvent(db.pool, author.id, {
      startsAt: new Date("2031-01-01T00:00:00Z"),
      status: "cancelled",
    });
    const [firstSame, secondSame] = [sameA, sameB].sort();

    const events = await list(author);
    expect(events.map((e) => e.id)).toEqual([past, cancelled, firstSame, secondSame, later]);
    expect(events.map((e) => e.status)).toEqual(["passed", "cancelled", "active", "active", "active"]);
  });
});

describe("E6: GET /events/:id for an own event", () => {
  it("answers 200 with the organizer event shape, the same as the create answer", async () => {
    const created = await create(validBody({ title: "Read me" }));
    expect(created.status).toBe(201);
    const event = created.body as OrganizerEvent;

    const reply = await call(api, "GET", `/events/${event.id}`, { cookie: owner.cookie });
    expect(reply.status).toBe(200);
    expect(Object.keys(reply.body as object)).toEqual(ORGANIZER_KEYS);
    expect(reply.body).toEqual(event);
  });

  it("lists the created event with the same fields", async () => {
    const author = await organizer(db.pool);
    const created = await create(validBody({ title: "In the list" }), author);
    expect(await list(author)).toEqual([created.body]);
  });
});

describe("E8: GET /events/:id with an id that is not a uuid", () => {
  it("answers 404 not_found and sends no query to the database", async () => {
    const spy = vi.spyOn(db.pool, "query");
    try {
      for (const id of MALFORMED_IDS) {
        const reply = await call(api, "GET", `/events/${encodeURIComponent(id)}`, { cookie: owner.cookie });
        expect(reply, id).toMatchObject({ status: 404, body: { error: "not_found" } });
      }
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("E10: registered and seats_left in the organizer shape", () => {
  it("counts only registered rows, never answers below 0, and shows real numbers for every status", async () => {
    const author = await organizer(db.pool);
    const empty = await insertEvent(db.pool, author.id, { capacity: 4, startsAt: new Date(Date.now() + 1 * DAY) });
    const mixed = await insertEvent(db.pool, author.id, { capacity: 3, startsAt: new Date(Date.now() + 2 * DAY) });
    const over = await insertEvent(db.pool, author.id, { capacity: 1, startsAt: new Date(Date.now() + 3 * DAY) });
    const cancelled = await insertEvent(db.pool, author.id, {
      capacity: 5,
      startsAt: new Date(Date.now() + 4 * DAY),
    });
    const passed = await insertEvent(db.pool, author.id, {
      capacity: 2,
      startsAt: new Date(Date.now() - 2 * DAY),
    });

    await insertRegistration(db.pool, mixed, await insertUser(db.pool), "registered");
    await insertRegistration(db.pool, mixed, await insertUser(db.pool), "waitlisted");
    await insertRegistration(db.pool, mixed, await insertUser(db.pool), "cancelled");
    await insertRegistration(db.pool, over, await insertUser(db.pool), "registered");
    await insertRegistration(db.pool, over, await insertUser(db.pool), "registered");
    await insertRegistration(db.pool, cancelled, await insertUser(db.pool), "registered");
    await insertRegistration(db.pool, cancelled, await insertUser(db.pool), "registered");
    await db.pool.query("UPDATE events SET status = 'cancelled', cancelled_at = now() WHERE id = $1", [cancelled]);
    await insertRegistration(db.pool, passed, await insertUser(db.pool), "registered");

    const expected = {
      [empty]: { status: "active", capacity: 4, registered: 0, seats_left: 4 },
      [mixed]: { status: "active", capacity: 3, registered: 1, seats_left: 2 },
      [over]: { status: "active", capacity: 1, registered: 2, seats_left: 0 },
      [cancelled]: { status: "cancelled", capacity: 5, registered: 2, seats_left: 3 },
      [passed]: { status: "passed", capacity: 2, registered: 1, seats_left: 1 },
    };
    for (const [id, numbers] of Object.entries(expected)) {
      expect(await read(id, author), id).toMatchObject(numbers);
    }
    const listed = await list(author);
    for (const event of listed) {
      expect(event, event.id).toMatchObject(expected[event.id]);
    }

    const cancelledEvent = await read(cancelled, author);
    expect(cancelledEvent.cancelled_at).toMatch(ISO_UTC);
  });
});

describe("E17: error bodies", () => {
  it("uses { error: code } with the codes of this spec and never shows password_hash", async () => {
    expect(await call(api, "POST", "/events", { body: {}, cookie: owner.cookie })).toMatchObject({
      status: 400,
      body: { error: "invalid_input" },
    });
    expect(await call(api, "GET", "/events")).toMatchObject({ status: 401, body: { error: "not_logged_in" } });
    expect(await call(api, "GET", "/events/abc", { cookie: owner.cookie })).toMatchObject({
      status: 404,
      body: { error: "not_found" },
    });
    // `call` checks every answer for password_hash; these also must hold for the success answers.
    await list();
  });
});

describe("E18: ends_at is starts_at plus duration_minutes, in both shapes", () => {
  it("answers 2030-01-01T11:30:00.000Z for a 90 minute event from 10:00 Z", async () => {
    const author = await organizer(db.pool);
    const created = await create(validBody({ starts_at: "2030-01-01T10:00:00Z", duration_minutes: 90 }), author);
    expect(created.status).toBe(201);
    const event = created.body as OrganizerEvent;
    expect(event.ends_at).toBe("2030-01-01T11:30:00.000Z");
    expect((await read(event.id, author)).ends_at).toBe("2030-01-01T11:30:00.000Z");
    expect((await list(author))[0].ends_at).toBe("2030-01-01T11:30:00.000Z");

    const reply = await call(api, "GET", `/public/events/${event.id}`);
    expect(reply.status).toBe(200);
    expect((reply.body as { ends_at: string }).ends_at).toBe("2030-01-01T11:30:00.000Z");
  });

  it("crosses midnight and the day limit of 1440 minutes", async () => {
    const created = await create(validBody({ starts_at: "2030-12-31T23:30:00Z", duration_minutes: 1440 }));
    expect(created.status).toBe(201);
    expect((created.body as OrganizerEvent).ends_at).toBe("2031-01-01T23:30:00.000Z");
  });
});
