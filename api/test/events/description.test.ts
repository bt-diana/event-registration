import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Running } from "../auth/helpers.js";
import { createTestDb, insertEvent, type TestDb } from "../db/helpers.js";
import {
  attendee,
  call,
  countEvents,
  DAY,
  organizer,
  ORGANIZER_KEYS,
  startApi,
  UNKNOWN_ID,
  type Account,
} from "./helpers.js";

// The event description (docs/specs/event-description.md DS3-DS12). DS1 and DS2
// are in api/test/db/constraints.test.ts and api/test/db/migrate.test.ts.

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

type WithDescription = { id: string; description: string };

const EMOJI = "\u{1F600}";

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

// Creates an event and answers it; fails the test unless the answer is 201.
async function created(description: unknown, account: Account = owner): Promise<WithDescription> {
  const reply = await create(validBody({ description }), account);
  expect(reply.status, reply.text).toBe(201);
  return reply.body as WithDescription;
}

async function storedDescription(id: string): Promise<string> {
  const { rows } = await db.pool.query<{ description: string }>("SELECT description FROM events WHERE id = $1", [
    id,
  ]);
  return rows[0].description;
}

async function expectInvalid(body: unknown, name: string): Promise<void> {
  const before = await countEvents(db.pool);
  const reply = await create(body);
  expect(reply.status, `${name}: ${reply.text}`).toBe(400);
  expect(reply.body, name).toEqual({ error: "invalid_input" });
  expect(await countEvents(db.pool), name).toBe(before);
}

describe("DS6: length limit of 2000 code points after trimming (tests first)", () => {
  it("accepts 2000 characters and stores them", async () => {
    const text = "x".repeat(2000);
    const event = await created(text);
    expect(event.description).toBe(text);
    expect(await storedDescription(event.id)).toBe(text);
  });

  it("accepts 2000 emoji (4000 UTF-16 units), counted as code points", async () => {
    const text = EMOJI.repeat(2000);
    expect(text.length).toBe(4000);
    const event = await created(text);
    expect(event.description).toBe(text);
    expect(await storedDescription(event.id)).toBe(text);
  });

  it("counts after trimming: 2000 characters with spaces around are accepted", async () => {
    const text = "y".repeat(2000);
    const event = await created(`   ${text}\n\t `);
    expect(event.description).toBe(text);
  });

  it("answers 400 invalid_input and writes nothing for 2001 characters or 2001 emoji", async () => {
    await expectInvalid(validBody({ description: "x".repeat(2001) }), "2001 characters");
    await expectInvalid(validBody({ description: EMOJI.repeat(2001) }), "2001 emoji");
    await expectInvalid(validBody({ description: `a${" ".repeat(10)}${"b".repeat(1990)}` }), "inner spaces count");
  });
});

describe("DS7: bad type or content (tests first)", () => {
  const bad: Array<[string, unknown]> = [
    ["a number", 5],
    ["zero", 0],
    ["true", true],
    ["false", false],
    ["an array", ["text"]],
    ["an empty array", []],
    ["an object", { text: "hi" }],
    ["an empty object", {}],
    ["a NUL character", "a\u0000b"],
    ["only a NUL character", "\u0000"],
    ["a NUL at the end", "Doors at 9.\u0000"],
  ];

  it.each(bad)("answers 400 invalid_input and writes nothing for %s", async (name, description) => {
    await expectInvalid(validBody({ description }), name);
  });

  it("never answers 500 for a bad description", async () => {
    for (const [name, description] of bad) {
      const reply = await create(validBody({ description }));
      expect(reply.status, name).not.toBe(500);
    }
  });
});

describe("DS10: the public answer has exactly the public keys with description (tests first)", () => {
  const PUBLIC_KEYS = [
    "id",
    "title",
    "description",
    "starts_at",
    "ends_at",
    "duration_minutes",
    "capacity",
    "status",
    "has_started",
    "seats_left",
    "full",
  ];

  it("answers exactly the key list, with the stored description", async () => {
    const event = await created("Bring a laptop.");
    const reply = await call(api, "GET", `/public/events/${event.id}`);
    expect(reply.status, reply.text).toBe(200);
    expect(Object.keys(reply.body as object)).toEqual(PUBLIC_KEYS);
    expect((reply.body as WithDescription).description).toBe("Bring a laptop.");
    for (const hidden of ["organizer_id", "registered", "schedule_version", "created_at", "cancelled_at", owner.id]) {
      expect(reply.text, hidden).not.toContain(hidden);
    }
  });

  it("answers '' for an event made without a description", async () => {
    const id = await insertEvent(db.pool, owner.id);
    const reply = await call(api, "GET", `/public/events/${id}`);
    expect(reply.status).toBe(200);
    expect(Object.keys(reply.body as object)).toEqual(PUBLIC_KEYS);
    expect((reply.body as WithDescription).description).toBe("");
  });

  it("answers the stored text also for cancelled and passed events", async () => {
    const text = "Still explains itself.";
    const cancelled = await insertEvent(db.pool, owner.id, { description: text });
    await db.pool.query("UPDATE events SET status = 'cancelled', cancelled_at = now() WHERE id = $1", [cancelled]);
    const passed = await insertEvent(db.pool, owner.id, {
      description: text,
      startsAt: new Date(Date.now() - 2 * DAY),
    });

    for (const [id, status] of [
      [cancelled, "cancelled"],
      [passed, "passed"],
    ]) {
      const reply = await call(api, "GET", `/public/events/${id}`);
      expect(reply.status).toBe(200);
      expect(Object.keys(reply.body as object)).toEqual(PUBLIC_KEYS);
      expect(reply.body, status).toMatchObject({ status, description: text, seats_left: 0, full: false });
    }
  });
});

describe("DS3: POST /events stores and answers the trimmed description", () => {
  it("answers 201 with the organizer shape and description, and stores the same text", async () => {
    const reply = await create(validBody({ description: "  A short talk about databases.  " }));
    expect(reply.status, reply.text).toBe(201);
    expect(Object.keys(reply.body as object)).toEqual(ORGANIZER_KEYS);
    const event = reply.body as WithDescription;
    expect(event.description).toBe("A short talk about databases.");
    expect(await storedDescription(event.id)).toBe("A short talk about databases.");
  });
});

describe("DS4: no description is ''", () => {
  const empty: Array<[string, unknown]> = [
    ["missing", undefined],
    ["null", null],
    ["empty", ""],
    ["only spaces", "     "],
    ["only whitespace", " \t\n\r\n  "],
  ];

  it.each(empty)("stores and answers '' when the description is %s", async (_name, description) => {
    const event = await created(description);
    expect(event.description).toBe("");
    expect(await storedDescription(event.id)).toBe("");
  });
});

describe("DS5: trim rule", () => {
  it("removes leading and trailing whitespace and keeps inner spaces, tabs and line breaks", async () => {
    const event = await created("  Bring a laptop.\n\nDoors at 9.  ");
    expect(event.description).toBe("Bring a laptop.\n\nDoors at 9.");
    expect(await storedDescription(event.id)).toBe("Bring a laptop.\n\nDoors at 9.");

    const inner = "Line one\r\n\tindented   line\n\n\nend";
    const second = await created(`\n\n${inner}\t \n`);
    expect(second.description).toBe(inner);
  });
});

describe("DS8: the other create rules are unchanged", () => {
  it("answers 201 for a valid body without description", async () => {
    const reply = await create(validBody());
    expect(reply.status, reply.text).toBe(201);
    expect((reply.body as WithDescription).description).toBe("");
  });

  it("answers 400 for a bad field with a valid description", async () => {
    const description = "A valid text.";
    await expectInvalid(validBody({ description, title: "" }), "empty title");
    await expectInvalid(validBody({ description, title: undefined }), "no title");
    await expectInvalid(validBody({ description, starts_at: "2020-01-01T10:00:00Z" }), "past start");
    await expectInvalid(validBody({ description, capacity: 0 }), "capacity 0");
    await expectInvalid(validBody({ description, duration_minutes: 1441 }), "duration 1441");
  });

  it("answers 400 when only the description is bad", async () => {
    await expectInvalid(validBody({ description: 42 }), "description 42");
  });
});

describe("DS9: the organizer shape has description in create, read and list", () => {
  it("answers the same description in POST, GET /events/:id and GET /events", async () => {
    const author = await organizer(db.pool);
    const event = await created("  Same text everywhere.\nTwo lines. ", author);
    expect(event.description).toBe("Same text everywhere.\nTwo lines.");

    const read = await call(api, "GET", `/events/${event.id}`, { cookie: author.cookie });
    expect(read.status).toBe(200);
    expect(Object.keys(read.body as object)).toEqual(ORGANIZER_KEYS);
    expect(read.body).toEqual(event);

    const list = await call(api, "GET", "/events", { cookie: author.cookie });
    expect(list.status).toBe(200);
    const events = (list.body as { events: WithDescription[] }).events;
    expect(events).toEqual([event]);
    expect(Object.keys(events[0])).toEqual(ORGANIZER_KEYS);
  });

  it("answers '' for an event made by SQL without description, in read and list", async () => {
    const author = await organizer(db.pool);
    const id = await insertEvent(db.pool, author.id);

    const read = await call(api, "GET", `/events/${id}`, { cookie: author.cookie });
    expect(read.status).toBe(200);
    expect(Object.keys(read.body as object)).toEqual(ORGANIZER_KEYS);
    expect((read.body as WithDescription).description).toBe("");

    const list = await call(api, "GET", "/events", { cookie: author.cookie });
    expect((list.body as { events: WithDescription[] }).events.map((e) => e.description)).toEqual([""]);
  });
});

describe("DS11: plain text, not changed by the API", () => {
  it("answers markup, entities and quotes exactly as sent, in both shapes", async () => {
    const text = `<b>hi</b> <script>alert("x")</script> &amp; 'quotes' \\ back`;
    const event = await created(text);
    expect(event.description).toBe(text);
    expect(await storedDescription(event.id)).toBe(text);

    const read = await call(api, "GET", `/events/${event.id}`, { cookie: owner.cookie });
    expect((read.body as WithDescription).description).toBe(text);
    const pub = await call(api, "GET", `/public/events/${event.id}`);
    expect((pub.body as WithDescription).description).toBe(text);
  });
});

describe("DS12: guards run before the description check", () => {
  const SECRET = "Only for the owner page";

  it("answers 401 without login and 403 to an attendee, also for a bad description, and runs no query", async () => {
    const person = await attendee(db.pool);
    const id = await insertEvent(db.pool, owner.id, { description: SECRET });
    const before = await countEvents(db.pool);
    const spy = vi.spyOn(db.pool, "query");
    try {
      const requests = [
        { method: "POST" as const, path: "/events", body: validBody({ description: 5 }) as unknown },
        { method: "POST" as const, path: "/events", body: validBody({ description: "x".repeat(2001) }) as unknown },
        { method: "POST" as const, path: "/events", body: validBody({ description: "fine" }) as unknown },
        { method: "GET" as const, path: "/events", body: undefined },
        { method: "GET" as const, path: `/events/${id}`, body: undefined },
      ];
      for (const { method, path, body } of requests) {
        const anonymous = await call(api, method, path, { body });
        expect(anonymous, `${method} ${path}`).toMatchObject({ status: 401, body: { error: "not_logged_in" } });
        const asAttendee = await call(api, method, path, { body, cookie: person.cookie });
        expect(asAttendee, `${method} ${path}`).toMatchObject({ status: 403, body: { error: "wrong_role" } });
        expect(anonymous.text + asAttendee.text).not.toContain(SECRET);
      }
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
    expect(await countEvents(db.pool)).toBe(before);
  });

  it("answers another organizer's event with the same 404 as an unknown id, without the description", async () => {
    const id = await insertEvent(db.pool, owner.id, { description: SECRET });
    const stranger = await organizer(db.pool);

    const foreign = await call(api, "GET", `/events/${id}`, { cookie: stranger.cookie });
    const unknown = await call(api, "GET", `/events/${UNKNOWN_ID}`, { cookie: stranger.cookie });
    expect(foreign).toMatchObject({ status: 404, body: { error: "not_found" } });
    expect(foreign.text).toBe(unknown.text);
    expect(foreign.text).not.toContain(SECRET);

    const list = await call(api, "GET", "/events", { cookie: stranger.cookie });
    expect(list.text).not.toContain(SECRET);
  });
});
