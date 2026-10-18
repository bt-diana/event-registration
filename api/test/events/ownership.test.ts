import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from "vitest";
import { mintSessionCookie, type Running } from "../auth/helpers.js";
import { createTestDb, insertEvent, type TestDb } from "../db/helpers.js";
import {
  attendee,
  call,
  countEvents,
  DAY,
  MALFORMED_IDS,
  organizer,
  ORGANIZER_KEYS,
  startApi,
  UNKNOWN_ID,
  type Account,
} from "./helpers.js";

// Tests first (events.md E4, E7, E9; DATABASE.md 3.8).

let db: TestDb;
let api: Running;
let orgA: Account;
let orgB: Account;
let orgEmpty: Account;
let person: Account;
let eventsA: string[];
let eventB: string;

beforeAll(async () => {
  db = await createTestDb();
  api = startApi(db.pool);
  orgA = await organizer(db.pool);
  orgB = await organizer(db.pool);
  orgEmpty = await organizer(db.pool);
  person = await attendee(db.pool);
  eventsA = [
    await insertEvent(db.pool, orgA.id, { title: "A first", startsAt: new Date(Date.now() + 2 * DAY) }),
    await insertEvent(db.pool, orgA.id, { title: "A second", startsAt: new Date(Date.now() + 3 * DAY) }),
  ];
  eventB = await insertEvent(db.pool, orgB.id, { title: "B only", startsAt: new Date(Date.now() + DAY) });
});

afterAll(async () => {
  await api?.close();
  await db?.drop();
});

describe("E4: GET /events lists only the caller's events", () => {
  it("answers 200 with only organizer A's events, in the organizer event shape", async () => {
    const reply = await call(api, "GET", "/events", { cookie: orgA.cookie });
    expect(reply.status).toBe(200);
    const { events } = reply.body as { events: Array<Record<string, unknown>> };
    expect(Object.keys(reply.body as object)).toEqual(["events"]);
    expect(events.map((e) => e.id)).toEqual(eventsA);
    for (const event of events) {
      expect(Object.keys(event)).toEqual(ORGANIZER_KEYS);
    }
    expect(reply.text).not.toContain(eventB);
    expect(reply.text).not.toContain("organizer_id");
    expect(reply.text).not.toContain(orgA.id);
  });

  it("answers organizer B with only B's event", async () => {
    const reply = await call(api, "GET", "/events", { cookie: orgB.cookie });
    expect(reply.status).toBe(200);
    const { events } = reply.body as { events: Array<{ id: string }> };
    expect(events.map((e) => e.id)).toEqual([eventB]);
    for (const id of eventsA) expect(reply.text).not.toContain(id);
  });

  it("answers { events: [] } to an organizer with no events", async () => {
    const reply = await call(api, "GET", "/events", { cookie: orgEmpty.cookie });
    expect(reply).toMatchObject({ status: 200, body: { events: [] } });
  });
});

describe("E7: another organizer's event is the same 404 as an unknown id", () => {
  it("answers the owner 200 (control)", async () => {
    const reply = await call(api, "GET", `/events/${eventB}`, { cookie: orgB.cookie });
    expect(reply.status).toBe(200);
    expect((reply.body as { id: string }).id).toBe(eventB);
  });

  it("answers 404 not_found for another organizer's event, exactly like an unknown id", async () => {
    const foreign = await call(api, "GET", `/events/${eventB}`, { cookie: orgA.cookie });
    const unknown = await call(api, "GET", `/events/${UNKNOWN_ID}`, { cookie: orgA.cookie });
    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual({ error: "not_found" });
    expect(unknown.status).toBe(foreign.status);
    expect(unknown.text).toBe(foreign.text);
    expect(foreign.text).not.toContain("B only");
  });

  it("does not show B's event to an organizer with no events either", async () => {
    const reply = await call(api, "GET", `/events/${eventB}`, { cookie: orgEmpty.cookie });
    expect(reply).toMatchObject({ status: 404, body: { error: "not_found" } });
  });
});

describe("E9: guards on the organizer routes", () => {
  let querySpy: MockInstance;

  const validBody = () => ({
    title: "Should not exist",
    starts_at: new Date(Date.now() + DAY).toISOString(),
    duration_minutes: 60,
    capacity: 10,
  });

  // Each request with the path and body that would work for an organizer.
  const requests = () => [
    { method: "POST" as const, path: "/events", body: validBody() as unknown },
    { method: "POST" as const, path: "/events", body: { title: 5 } as unknown },
    { method: "GET" as const, path: "/events", body: undefined },
    { method: "GET" as const, path: `/events/${eventsA[0]}`, body: undefined },
    { method: "GET" as const, path: `/events/${UNKNOWN_ID}`, body: undefined },
    { method: "GET" as const, path: `/events/${MALFORMED_IDS[0]}`, body: undefined },
  ];

  beforeAll(() => {
    querySpy = vi.spyOn(db.pool, "query");
  });

  afterEach(() => {
    querySpy.mockClear();
  });

  afterAll(() => {
    querySpy.mockRestore();
  });

  it("answers 401 not_logged_in without a cookie, runs no query and writes nothing", async () => {
    const before = await countEvents(db.pool);
    querySpy.mockClear();
    for (const { method, path, body } of requests()) {
      const reply = await call(api, method, path, { body });
      expect(reply, `${method} ${path}`).toMatchObject({ status: 401, body: { error: "not_logged_in" } });
    }
    expect(querySpy).not.toHaveBeenCalled();
    expect(await countEvents(db.pool)).toBe(before);
  });

  it("answers 401 for a bad, a foreign-signed or an expired cookie", async () => {
    const good = orgA.cookie;
    const bad = [
      good.slice(0, -1) + (good.endsWith("A") ? "B" : "A"),
      `session=${encodeURIComponent(`organizer.${orgA.id}.${Date.now() + DAY}`)}`,
      await mintSessionCookie("organizer", orgA.id, Date.now() - 8 * DAY),
    ];
    for (const cookie of bad) {
      for (const { method, path, body } of requests()) {
        const reply = await call(api, method, path, { body, cookie });
        expect(reply, `${method} ${path}`).toMatchObject({ status: 401, body: { error: "not_logged_in" } });
      }
    }
    expect(querySpy).not.toHaveBeenCalled();
  });

  it("answers 403 wrong_role to an attendee, also for a bad body or id, and writes nothing", async () => {
    const before = await countEvents(db.pool);
    querySpy.mockClear();
    for (const { method, path, body } of requests()) {
      const reply = await call(api, method, path, { body, cookie: person.cookie });
      expect(reply, `${method} ${path}`).toMatchObject({ status: 403, body: { error: "wrong_role" } });
    }
    expect(querySpy).not.toHaveBeenCalled();
    expect(await countEvents(db.pool)).toBe(before);
    const { rows } = await db.pool.query("SELECT 1 FROM events WHERE title = 'Should not exist'");
    expect(rows).toHaveLength(0);
  });
});
