import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import { mintSessionCookie, type Running } from "../auth/helpers.js";
import { createTestDb, insertEvent, insertRegistration, insertUser, uniqueEmail, type TestDb } from "../db/helpers.js";
import { attendee, call, DAY, HOUR, MALFORMED_IDS, organizer, startApi, UNKNOWN_ID, type Account, type Reply } from "../events/helpers.js";
import { cancelEventInDb, cancelRegistrationInDb, register } from "../registrations/helpers.js";

// GET /events/:id/arrivals, the organizer arrivals counter (arrivals.md
// AR1-AR15). Written before the route: AR1, AR3, AR4, AR5, AR8, AR10 and AR11
// are the tests first.

// The arrivals shape, in the order of arrivals.md section 3 (D49).
const ARRIVALS_KEYS = ["capacity", "registered", "arrived"];

type Arrivals = { capacity: number; registered: number; arrived: number };
type Status = "registered" | "waitlisted" | "cancelled";

let db: TestDb;
let api: Running;
let owner: Account;
let other: Account;

beforeAll(async () => {
  db = await createTestDb();
  api = startApi(db.pool);
  owner = await organizer(db.pool);
  other = await organizer(db.pool);
});

afterAll(async () => {
  await api?.close();
  await db?.drop();
});

// `null` sends no cookie at all (an undefined argument would take the default).
function read(eventId: string, cookie: string | null = owner.cookie, target: Running = api): Promise<Reply> {
  return call(target, "GET", `/events/${eventId}/arrivals`, { cookie: cookie ?? undefined });
}

// Answers 200 with exactly the three keys, each a whole JSON number, and
// arrived never above registered in one answer (AR2, AR5, AR12).
async function arrivals(eventId: string, cookie: string = owner.cookie, target: Running = api): Promise<Arrivals> {
  const reply = await read(eventId, cookie, target);
  expect(reply.status, reply.text).toBe(200);
  expect(Object.keys(reply.body as object), reply.text).toEqual(ARRIVALS_KEYS);
  const body = reply.body as Arrivals;
  for (const key of ARRIVALS_KEYS) {
    const value = (body as Record<string, unknown>)[key];
    expect(typeof value, `${key} in ${reply.text}`).toBe("number");
    expect(Number.isInteger(value), `${key} in ${reply.text}`).toBe(true);
  }
  expect(body.arrived, reply.text).toBeLessThanOrEqual(body.registered);
  return body;
}

// A 404 not_found with only the `error` key (AR8, AR14).
function expectNotFound(reply: Reply): void {
  expect(reply, reply.text).toMatchObject({ status: 404, body: { error: "not_found" } });
  expect(Object.keys(reply.body as object), reply.text).toEqual(["error"]);
}

// An error with only the `error` key (AR14, checkin.md C19).
function expectError(reply: Reply, status: number, error: string): void {
  expect(reply, reply.text).toMatchObject({ status, body: { error } });
  expect(Object.keys(reply.body as object), reply.text).toEqual(["error"]);
}

function checkIn(code: string, cookie: string = owner.cookie): Promise<Reply> {
  return call(api, "POST", "/checkin", { cookie, body: { ticket_code: code } });
}

// An attendee row with a given name.
async function namedUser(pool: pg.Pool, name: string): Promise<{ id: string; email: string }> {
  const email = uniqueEmail(name.toLowerCase().replace(/\s+/g, "-"));
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, 'hash') RETURNING id`,
    [email, name],
  );
  return { id: rows[0].id, email };
}

// A registration of a new attendee, made by SQL.
async function row(eventId: string, status: Status = "registered", pool: pg.Pool = db.pool) {
  return insertRegistration(pool, eventId, await insertUser(pool), status);
}

async function setCheckedIn(registrationId: string, at: Date = new Date(), pool: pg.Pool = db.pool): Promise<void> {
  await pool.query("UPDATE registrations SET checked_in_at = $2 WHERE id = $1", [registrationId, at]);
}

// `n` rows of one status; the first `arrivedCount` of them checked in by SQL.
async function rows(eventId: string, n: number, status: Status, arrivedCount = 0) {
  const made = [];
  for (let i = 0; i < n; i++) {
    const r = await row(eventId, status);
    if (i < arrivedCount) await setCheckedIn(r.id);
    made.push(r);
  }
  return made;
}

// Every row of every table, to show that a read changed nothing (AR15).
async function snapshot(): Promise<Record<string, Record<string, unknown>[]>> {
  const result: Record<string, Record<string, unknown>[]> = {};
  for (const table of ["registrations", "outbox", "events", "users", "organizers"]) {
    result[table] = (await db.pool.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
  }
  return result;
}

// Raw SQL text of each pool.query call recorded by a spy.
function statements(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls.map(([text]) => (typeof text === "string" ? text : (text as { text: string }).text));
}

describe("AR1: guards on GET /events/:id/arrivals (tests first)", () => {
  it("answers 401 not_logged_in without a valid login and 403 wrong_role to an attendee, before the id check and without a query", async () => {
    const eventId = await insertEvent(db.pool, owner.id);
    await rows(eventId, 2, "registered", 1);
    const foreign = await insertEvent(db.pool, other.id);
    const person = await attendee(db.pool);
    await insertRegistration(db.pool, eventId, person.id, "registered");
    const expired = await mintSessionCookie("organizer", owner.id, Date.now() - 8 * DAY);
    const query = vi.spyOn(db.pool, "query");
    const connect = vi.spyOn(db.pool, "connect");
    try {
      for (const id of [eventId, foreign, UNKNOWN_ID, ...MALFORMED_IDS.map(encodeURIComponent)]) {
        for (const cookie of [null, "session=garbage", expired]) {
          const reply = await read(id, cookie);
          expectError(reply, 401, "not_logged_in");
        }
        // Even an attendee registered at this event cannot read the counter.
        expectError(await read(id, person.cookie), 403, "wrong_role");
      }
      expect(query).not.toHaveBeenCalled();
      expect(connect).not.toHaveBeenCalled();
    } finally {
      query.mockRestore();
      connect.mockRestore();
    }
  });
});

describe("AR8: unknown, malformed and foreign events answer the same 404 (tests first)", () => {
  it("answers 404 not_found for an unknown uuid and for another organizer's event, with the same body", async () => {
    const foreign = await insertEvent(db.pool, other.id, { capacity: 37, title: "Foreign Secret Gala" });
    const guest = await namedUser(db.pool, "Foreign Guest");
    const seat = await insertRegistration(db.pool, foreign, guest.id, "registered");
    await setCheckedIn(seat.id);
    await rows(foreign, 2, "waitlisted");
    const cancelledForeign = await insertEvent(db.pool, other.id);
    await cancelEventInDb(db.pool, cancelledForeign);

    const unknown = await read(UNKNOWN_ID);
    expectNotFound(unknown);
    for (const id of [foreign, cancelledForeign]) {
      const notMine = await read(id);
      expectNotFound(notMine);
      expect(notMine.status).toBe(unknown.status);
      expect(notMine.text).toBe(unknown.text);
      for (const hidden of [id, other.id, "Foreign Secret Gala", "37", seat.ticketCode, guest.email, "Foreign Guest"]) {
        expect(notMine.text).not.toContain(hidden);
      }
    }

    // The owner still reads it.
    expect(await arrivals(foreign, other.cookie)).toEqual({ capacity: 37, registered: 1, arrived: 1 });
  });

  it("answers 404 for an id that is not a uuid without a query", async () => {
    const unknown = await read(UNKNOWN_ID);
    const query = vi.spyOn(db.pool, "query");
    const connect = vi.spyOn(db.pool, "connect");
    try {
      for (const id of MALFORMED_IDS) {
        const reply = await read(encodeURIComponent(id));
        expectNotFound(reply);
        expect(reply.text, id).toBe(unknown.text);
      }
      expect(query).not.toHaveBeenCalled();
      expect(connect).not.toHaveBeenCalled();
    } finally {
      query.mockRestore();
      connect.mockRestore();
    }
  });
});

describe("AR3: registered counts only taken seats (tests first)", () => {
  it("counts the registered rows of that event only, never waitlisted, cancelled or other events' rows", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { capacity: 3 });
    await rows(eventId, 3, "registered");
    await rows(eventId, 2, "waitlisted");
    await rows(eventId, 1, "cancelled");
    const seatGone = await row(eventId, "registered");
    await cancelRegistrationInDb(db.pool, seatGone.id);
    const waitGone = await row(eventId, "waitlisted");
    await cancelRegistrationInDb(db.pool, waitGone.id);
    const sibling = await insertEvent(db.pool, owner.id, { capacity: 3 });
    await rows(sibling, 2, "registered", 1);
    const foreign = await insertEvent(db.pool, other.id, { capacity: 3 });
    await rows(foreign, 3, "registered", 3);

    expect(await arrivals(eventId)).toEqual({ capacity: 3, registered: 3, arrived: 0 });
    expect(await arrivals(sibling)).toEqual({ capacity: 3, registered: 2, arrived: 1 });
  });

  it("is the same number as registered in the organizer event shape (events.md E10)", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { capacity: 2 });
    const people = [await attendee(db.pool), await attendee(db.pool), await attendee(db.pool)];
    for (const person of people) {
      const reply = await register(api, eventId, person.cookie);
      expect(reply.status, reply.text).toBe(201);
    }
    await rows(eventId, 1, "cancelled");

    const event = await call(api, "GET", `/events/${eventId}`, { cookie: owner.cookie });
    expect(event.status, event.text).toBe(200);
    const { capacity, registered } = event.body as { capacity: number; registered: number };
    expect(await arrivals(eventId)).toEqual({ capacity, registered, arrived: 0 });
    expect(registered).toBe(2);
  });
});

describe("AR4: arrived counts only checked-in registered rows (tests first)", () => {
  it("counts registered rows with checked_in_at set and not the ones without", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { capacity: 4 });
    const [a, b] = await rows(eventId, 4, "registered");
    await setCheckedIn(a.id);
    expect(await arrivals(eventId)).toEqual({ capacity: 4, registered: 4, arrived: 1 });
    await setCheckedIn(b.id, new Date("2030-01-01T00:00:00.000Z"));
    expect(await arrivals(eventId)).toEqual({ capacity: 4, registered: 4, arrived: 2 });
    await db.pool.query("UPDATE registrations SET checked_in_at = NULL WHERE id = $1", [a.id]);
    expect(await arrivals(eventId)).toEqual({ capacity: 4, registered: 4, arrived: 1 });
  });

  it("the table CHECK refuses a check-in time on a waitlisted or cancelled row", async () => {
    const eventId = await insertEvent(db.pool, owner.id);
    const waiting = await row(eventId, "waitlisted");
    const gone = await row(eventId, "cancelled");
    for (const r of [waiting, gone]) {
      await expect(setCheckedIn(r.id)).rejects.toThrow(/check constraint/i);
    }
  });

  it("never counts a waitlisted or cancelled row, even with a wrong checked_in_at set by SQL", async () => {
    // The CHECK forbids such a row, so it is made in a schema of its own where
    // the CHECK is dropped. The route must filter on the status itself.
    const loose = await createTestDb();
    const looseApi = startApi(loose.pool);
    try {
      const { rows: checks } = await loose.pool.query<{ conname: string }>(
        `SELECT conname FROM pg_constraint
          WHERE conrelid = 'registrations'::regclass AND contype = 'c'
            AND pg_get_constraintdef(oid) LIKE '%checked_in_at%'`,
      );
      expect(checks).toHaveLength(1);
      await loose.pool.query(`ALTER TABLE registrations DROP CONSTRAINT ${checks[0].conname}`);

      const boss = await organizer(loose.pool);
      const eventId = await insertEvent(loose.pool, boss.id, { capacity: 2 });
      const seated = await row(eventId, "registered", loose.pool);
      await setCheckedIn(seated.id, new Date(), loose.pool);
      await row(eventId, "registered", loose.pool);
      for (const status of ["waitlisted", "cancelled", "waitlisted", "cancelled"] as const) {
        const wrong = await row(eventId, status, loose.pool);
        await setCheckedIn(wrong.id, new Date(), loose.pool);
      }
      const { rows: stored } = await loose.pool.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM registrations WHERE event_id = $1 AND checked_in_at IS NOT NULL",
        [eventId],
      );
      expect(stored[0].n).toBe(5);

      expect(await arrivals(eventId, boss.cookie, looseApi)).toEqual({ capacity: 2, registered: 2, arrived: 1 });
    } finally {
      await looseApi.close();
      await loose.drop();
    }
  });
});

describe("AR5: arrived is never above registered (tests first)", () => {
  it("gives the exact values for many mixed rows", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { capacity: 9 });
    await rows(eventId, 9, "registered", 4);
    await rows(eventId, 5, "waitlisted");
    await rows(eventId, 3, "cancelled");
    const leaver = await row(eventId, "registered");
    await cancelRegistrationInDb(db.pool, leaver.id);
    const waitGone = await row(eventId, "waitlisted");
    await cancelRegistrationInDb(db.pool, waitGone.id);

    const got = await arrivals(eventId);
    expect(got).toEqual({ capacity: 9, registered: 9, arrived: 4 });
    expect(got.arrived).toBeLessThanOrEqual(got.registered);
  });

  it("all arrived gives arrived equal to registered, never above", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { capacity: 3 });
    await rows(eventId, 3, "registered", 3);
    await rows(eventId, 4, "waitlisted");
    await rows(eventId, 2, "cancelled");
    expect(await arrivals(eventId)).toEqual({ capacity: 3, registered: 3, arrived: 3 });
  });
});

describe("AR10: consistent with POST /checkin (tests first)", () => {
  it("a 200 check-in raises arrived by one; refused and repeated check-ins change nothing", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { capacity: 3 });
    const [a, b] = await rows(eventId, 3, "registered");
    const waiting = await row(eventId, "waitlisted");
    const gone = await row(eventId, "cancelled");
    const seatGone = await row(eventId, "registered");
    await cancelRegistrationInDb(db.pool, seatGone.id);
    const foreignEvent = await insertEvent(db.pool, other.id);
    const foreign = await row(foreignEvent, "registered");
    const start = await arrivals(eventId);
    expect(start).toEqual({ capacity: 3, registered: 3, arrived: 0 });

    // Refused check-ins (C4-C9) leave the numbers as they are.
    expectError(await checkIn(waiting.ticketCode), 409, "waitlisted");
    expect(await arrivals(eventId)).toEqual(start);
    expectError(await checkIn(gone.ticketCode), 409, "registration_cancelled");
    expect(await arrivals(eventId)).toEqual(start);
    expectError(await checkIn(seatGone.ticketCode), 409, "registration_cancelled");
    expect(await arrivals(eventId)).toEqual(start);
    expectError(await checkIn(foreign.ticketCode), 404, "not_found");
    expect(await arrivals(eventId)).toEqual(start);
    expectError(await checkIn("ZZZZZZZZZZ"), 404, "not_found");
    expect(await arrivals(eventId)).toEqual(start);
    expectError(await checkIn("not a code"), 400, "invalid_input");
    expect(await arrivals(eventId)).toEqual(start);
    // The other organizer cannot check in this event's ticket.
    expectError(await checkIn(a.ticketCode, other.cookie), 404, "not_found");
    expect(await arrivals(eventId)).toEqual(start);

    // A 200 check-in: one higher, registered unchanged.
    const first = await checkIn(a.ticketCode);
    expect(first.status, first.text).toBe(200);
    const afterFirst = await arrivals(eventId);
    expect(afterFirst).toEqual({ capacity: 3, registered: 3, arrived: 1 });

    // The same ticket again never raises arrived.
    expect((await checkIn(a.ticketCode)).status).toBe(409);
    expect((await checkIn(` ${a.ticketCode.toLowerCase()} `)).status).toBe(409);
    expect(await arrivals(eventId)).toEqual(afterFirst);

    // The foreign event's numbers did not move either.
    expect(await arrivals(foreignEvent, other.cookie)).toEqual({ capacity: 10, registered: 1, arrived: 0 });

    // A cancelled event refuses check-ins; the numbers stay and still answer 200.
    await cancelEventInDb(db.pool, eventId);
    expectError(await checkIn(b.ticketCode), 409, "event_cancelled");
    expect(await arrivals(eventId)).toEqual(afterFirst);
  });
});

describe("AR11: right after a concurrent check-in (tests first)", () => {
  it("5 parallel check-ins of one code raise arrived by one; 5 of 5 different codes raise it by five (5 rounds)", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { capacity: 30 });
    for (let round = 0; round < 5; round++) {
      const fresh = await rows(eventId, 6, "registered");
      const before = await arrivals(eventId);
      expect(before, `round ${round}`).toEqual({ capacity: 30, registered: 6 * (round + 1), arrived: 6 * round });

      const same = await Promise.all(Array.from({ length: 5 }, () => checkIn(fresh[0].ticketCode)));
      expect(same.map((r) => r.status).sort(), `round ${round}`).toEqual([200, 409, 409, 409, 409]);
      const afterSame = await arrivals(eventId);
      expect(afterSame, `round ${round}`).toEqual({ ...before, arrived: before.arrived + 1 });

      const different = await Promise.all(fresh.slice(1).map((t) => checkIn(t.ticketCode)));
      expect(different.map((r) => r.status), `round ${round}`).toEqual([200, 200, 200, 200, 200]);
      expect(await arrivals(eventId), `round ${round}`).toEqual({ ...before, arrived: before.arrived + 6 });
    }
  });
});

describe("AR2: the shape", () => {
  it("answers exactly capacity, registered and arrived as numbers, and nothing else", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { capacity: 12, title: "Private Title Night" });
    const ann = await namedUser(db.pool, "Ann Hidden");
    const seat = await insertRegistration(db.pool, eventId, ann.id, "registered");
    await setCheckedIn(seat.id);
    const wait = await row(eventId, "waitlisted");
    const foreignEvent = await insertEvent(db.pool, other.id, { title: "Other Org Party" });
    const foreignSeat = await row(foreignEvent, "registered");

    const reply = await read(eventId);
    expect(reply.status, reply.text).toBe(200);
    expect(Object.keys(reply.body as object)).toEqual(ARRIVALS_KEYS);
    expect(reply.body).toStrictEqual({ capacity: 12, registered: 1, arrived: 1 });
    expect(reply.text).toBe('{"capacity":12,"registered":1,"arrived":1}');
    for (const hidden of [
      eventId,
      "event_id",
      "Private Title Night",
      "organizer_id",
      owner.id,
      seat.id,
      seat.ticketCode,
      wait.ticketCode,
      ann.id,
      ann.email,
      "Ann Hidden",
      foreignEvent,
      "Other Org Party",
      foreignSeat.ticketCode,
    ]) {
      expect(reply.text).not.toContain(hidden);
    }
  });
});

describe("AR6: capacity is stored, not derived", () => {
  it("is not reduced by taken seats and not clamped when registered is above it", async () => {
    const roomy = await insertEvent(db.pool, owner.id, { capacity: 5 });
    await rows(roomy, 3, "registered", 2);
    expect(await arrivals(roomy)).toEqual({ capacity: 5, registered: 3, arrived: 2 });

    // A lowered capacity (M4): more seats taken than the event has now.
    const lowered = await insertEvent(db.pool, owner.id, { capacity: 4 });
    await rows(lowered, 4, "registered", 1);
    await db.pool.query("UPDATE events SET capacity = 2 WHERE id = $1", [lowered]);
    expect(await arrivals(lowered)).toEqual({ capacity: 2, registered: 4, arrived: 1 });

    const none = await insertEvent(db.pool, owner.id, { capacity: 0 });
    expect(await arrivals(none)).toEqual({ capacity: 0, registered: 0, arrived: 0 });
  });
});

describe("AR7: an event with nobody", () => {
  it("answers 200 with registered 0, arrived 0 and the real capacity", async () => {
    const empty = await insertEvent(db.pool, owner.id, { capacity: 25 });
    expect(await arrivals(empty)).toEqual({ capacity: 25, registered: 0, arrived: 0 });

    const onlyOthers = await insertEvent(db.pool, owner.id, { capacity: 0 });
    await rows(onlyOthers, 2, "waitlisted");
    await rows(onlyOthers, 1, "cancelled");
    expect(await arrivals(onlyOthers)).toEqual({ capacity: 0, registered: 0, arrived: 0 });
  });
});

describe("AR9: cancelled and passed events", () => {
  it("answers 200 with the real numbers for a cancelled and for a passed event of the organizer", async () => {
    const cancelled = await insertEvent(db.pool, owner.id, { capacity: 3 });
    const passed = await insertEvent(db.pool, owner.id, {
      capacity: 3,
      startsAt: new Date(Date.now() - 3 * HOUR),
      durationMinutes: 60,
    });
    for (const eventId of [cancelled, passed]) {
      await rows(eventId, 3, "registered", 2);
      await rows(eventId, 1, "waitlisted");
      await rows(eventId, 1, "cancelled");
    }
    await cancelEventInDb(db.pool, cancelled);
    expect(await arrivals(cancelled)).toEqual({ capacity: 3, registered: 3, arrived: 2 });
    expect(await arrivals(passed)).toEqual({ capacity: 3, registered: 3, arrived: 2 });
  });
});

describe("AR12: one statement, one snapshot", () => {
  it("reads the numbers in one statement, without a lock or a transaction", async () => {
    const eventId = await insertEvent(db.pool, owner.id);
    await rows(eventId, 2, "registered", 1);
    await rows(eventId, 1, "waitlisted");
    const query = vi.spyOn(db.pool, "query");
    const connect = vi.spyOn(db.pool, "connect");
    try {
      expect(await arrivals(eventId)).toEqual({ capacity: 10, registered: 2, arrived: 1 });
      const sql = statements(query);
      expect(sql).toHaveLength(1);
      for (const text of sql) {
        expect(text).not.toMatch(/\bFOR\s+(UPDATE|SHARE|NO KEY UPDATE|KEY SHARE)\b/i);
        expect(text).not.toMatch(/^\s*(BEGIN|START TRANSACTION)\b/i);
      }
      // pool.query checks a client out once by itself; a transaction would need
      // a client of its own from pool.connect.
      expect(connect).toHaveBeenCalledTimes(1);
    } finally {
      query.mockRestore();
      connect.mockRestore();
    }
  });

  it("never shows arrived above registered while check-ins and registrations happen", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { capacity: 8 });
    const seats = await rows(eventId, 4, "registered");
    const people = [];
    for (let i = 0; i < 6; i++) people.push(await attendee(db.pool));

    const reads: Promise<Arrivals>[] = [];
    const work = [
      ...seats.map((t) => checkIn(t.ticketCode)),
      ...people.map((p) => register(api, eventId, p.cookie)),
    ];
    for (let i = 0; i < 10; i++) reads.push(arrivals(eventId));
    const replies = await Promise.all(work);
    const snapshots = await Promise.all(reads);

    expect(replies.map((r) => r.status)).toEqual([200, 200, 200, 200, 201, 201, 201, 201, 201, 201]);
    for (const s of snapshots) {
      expect(s.capacity).toBe(8);
      expect(s.arrived).toBeLessThanOrEqual(s.registered);
      expect(s.registered).toBeGreaterThanOrEqual(4);
      expect(s.registered).toBeLessThanOrEqual(8);
    }
    expect(await arrivals(eventId)).toEqual({ capacity: 8, registered: 8, arrived: 4 });
  });
});

describe("AR13: a fresh snapshot for polling", () => {
  it("answers with Cache-Control: no-store on 200 and on every 404", async () => {
    const eventId = await insertEvent(db.pool, owner.id);
    const foreign = await insertEvent(db.pool, other.id);
    const cases: [string, number][] = [
      [eventId, 200],
      [UNKNOWN_ID, 404],
      [foreign, 404],
      [encodeURIComponent(MALFORMED_IDS[0]), 404],
      [encodeURIComponent(MALFORMED_IDS[3]), 404],
    ];
    for (const [id, status] of cases) {
      const res = await fetch(`${api.url}/events/${id}/arrivals`, { headers: { cookie: owner.cookie } });
      expect(res.status, id).toBe(status);
      expect(res.headers.get("cache-control"), id).toBe("no-store");
    }
  });

  it("two reads with a check-in between them show the new arrived", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { capacity: 2 });
    const [t] = await rows(eventId, 2, "registered");
    expect(await arrivals(eventId)).toEqual({ capacity: 2, registered: 2, arrived: 0 });
    expect((await checkIn(t.ticketCode)).status).toBe(200);
    expect(await arrivals(eventId)).toEqual({ capacity: 2, registered: 2, arrived: 1 });
  });
});

describe("AR14: errors", () => {
  it("uses only not_logged_in, wrong_role and not_found, each with only the error key; a bad id is never 400", async () => {
    const eventId = await insertEvent(db.pool, owner.id);
    const person = await attendee(db.pool);
    expectError(await read(eventId, null), 401, "not_logged_in");
    expectError(await read(eventId, person.cookie), 403, "wrong_role");
    expectError(await read(UNKNOWN_ID), 404, "not_found");
    for (const id of MALFORMED_IDS) {
      expectError(await read(encodeURIComponent(id)), 404, "not_found");
    }
  });

  it("takes no input but the path id: a query string cannot pick another event or organizer", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { capacity: 6 });
    await rows(eventId, 2, "registered", 1);
    const foreign = await insertEvent(db.pool, other.id, { capacity: 9 });
    await rows(foreign, 3, "registered", 3);
    const reply = await call(
      api,
      "GET",
      `/events/${eventId}/arrivals?event_id=${foreign}&organizer_id=${other.id}&id=${foreign}`,
      { cookie: owner.cookie },
    );
    expect(reply).toMatchObject({ status: 200, body: { capacity: 6, registered: 2, arrived: 1 } });
    const foreignByQuery = await call(api, "GET", `/events/${foreign}/arrivals?organizer_id=${owner.id}`, {
      cookie: owner.cookie,
    });
    expectNotFound(foreignByQuery);
  });
});

describe("AR15: the route changes nothing", () => {
  it("writes no row and no outbox row, and leaves the registrations list as it was", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { capacity: 2 });
    await rows(eventId, 2, "registered", 1);
    await rows(eventId, 1, "waitlisted");
    await rows(eventId, 1, "cancelled");
    const foreign = await insertEvent(db.pool, other.id);
    const list = () => call(api, "GET", `/events/${eventId}/registrations`, { cookie: owner.cookie });
    const listBefore = await list();
    expect(listBefore.status, listBefore.text).toBe(200);
    const before = await snapshot();

    for (let i = 0; i < 3; i++) {
      expect(await arrivals(eventId)).toEqual({ capacity: 2, registered: 2, arrived: 1 });
      expectNotFound(await read(foreign));
      expectNotFound(await read(UNKNOWN_ID));
      expectNotFound(await read("abc"));
    }

    expect(await snapshot()).toEqual(before);
    const listAfter = await list();
    expect(listAfter.status).toBe(200);
    expect(listAfter.body).toEqual(listBefore.body);
    expect((listAfter.body as { registrations: unknown[] }).registrations).toHaveLength(3);
  });

  it("does not answer other methods on the path with the counter", async () => {
    const eventId = await insertEvent(db.pool, owner.id);
    const before = await snapshot();
    const reply = await call(api, "POST", `/events/${eventId}/arrivals`, { cookie: owner.cookie, body: {} });
    expectNotFound(reply);
    expect(await snapshot()).toEqual(before);
  });
});
