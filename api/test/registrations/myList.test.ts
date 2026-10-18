import { request as httpRequest } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import { mintSessionCookie, type Running } from "../auth/helpers.js";
import { createTestDb, insertEvent, insertRegistration, insertUser, uniqueEmail, type TestDb } from "../db/helpers.js";
import { attendee, call, DAY, HOUR, MINUTE, organizer, startApi, type Account, type Reply } from "../events/helpers.js";
import {
  asRegistration,
  cancelEventInDb,
  cancelRegistrationInDb,
  counts,
  myRegistration,
  REGISTRATION_KEYS,
  register,
} from "./helpers.js";

// GET /me/registrations, the attendee's own registrations list
// (docs/specs/my-registrations.md MR1-MR15). Written before the route.

// The item: the registration shape (registration.md R21) plus three event keys,
// in the order of my-registrations.md section 3.
const ITEM_KEYS = [...REGISTRATION_KEYS, "event_title", "event_starts_at", "event_status"];

type Item = {
  id: string;
  event_id: string;
  status: "registered" | "waitlisted" | "cancelled";
  ticket_code: string;
  waitlist_position: number | null;
  checked_in_at: string | null;
  created_at: string;
  event_title: string;
  event_starts_at: string;
  event_status: "active" | "cancelled" | "passed";
};

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

function myList(cookie?: string, query = ""): Promise<Reply> {
  return call(api, "GET", `/me/registrations${query}`, { cookie });
}

// Answers 200 and the items, each checked for the exact key list (MR2, MR3).
async function items(cookie: string, query = ""): Promise<Item[]> {
  const reply = await myList(cookie, query);
  expect(reply.status, reply.text).toBe(200);
  expect(Object.keys(reply.body as object)).toEqual(["registrations"]);
  const registrations = (reply.body as { registrations: Item[] }).registrations;
  for (const item of registrations) expect(Object.keys(item), reply.text).toEqual(ITEM_KEYS);
  return registrations;
}

// fetch cannot send a body with GET; node:http can (MR4: a body is ignored).
function getWithBody(path: string, cookie: string, body: unknown): Promise<Reply> {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      `${api.url}${path}`,
      {
        method: "GET",
        headers: {
          cookie,
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (text += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: text === "" ? null : JSON.parse(text), text }));
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}

async function setCreatedAt(pool: pg.Pool, registrationId: string, at: Date): Promise<void> {
  await pool.query("UPDATE registrations SET created_at = $2 WHERE id = $1", [registrationId, at]);
}

describe("MR1: guards on GET /me/registrations (tests first)", () => {
  it("answers 401 not_logged_in without a valid login and 403 wrong_role to an organizer, with no query and nothing written", async () => {
    const person = await attendee(db.pool);
    const eventId = await insertEvent(db.pool, owner.id);
    await insertRegistration(db.pool, eventId, person.id, "registered");
    const expired = await mintSessionCookie("user", person.id, Date.now() - 8 * DAY);
    const before = await counts(db.pool);
    const query = vi.spyOn(db.pool, "query");
    const connect = vi.spyOn(db.pool, "connect");
    try {
      for (const cookie of [undefined, "session=garbage", expired]) {
        const reply = await myList(cookie);
        expect(reply, String(cookie)).toMatchObject({ status: 401, body: { error: "not_logged_in" } });
        expect(Object.keys(reply.body as object)).toEqual(["error"]);
      }
      const reply = await myList(owner.cookie);
      expect(reply).toMatchObject({ status: 403, body: { error: "wrong_role" } });
      expect(Object.keys(reply.body as object)).toEqual(["error"]);
      // The organizer cannot reach anybody's list through the query string.
      const sneaky = await myList(owner.cookie, `?user_id=${person.id}`);
      expect(sneaky).toMatchObject({ status: 403, body: { error: "wrong_role" } });
      expect(query).not.toHaveBeenCalled();
      expect(connect).not.toHaveBeenCalled();
    } finally {
      query.mockRestore();
      connect.mockRestore();
    }
    expect(await counts(db.pool)).toEqual(before);
  });
});

describe("MR2: the answer", () => {
  it("answers 200 { registrations: [] } to an attendee with no registrations", async () => {
    const person = await attendee(db.pool);
    const reply = await myList(person.cookie);
    expect(reply.status, reply.text).toBe(200);
    expect(reply.body).toEqual({ registrations: [] });
  });

  it("answers 200 with exactly one key at the top", async () => {
    const person = await attendee(db.pool);
    await insertRegistration(db.pool, await insertEvent(db.pool, owner.id), person.id, "registered");
    const reply = await myList(person.cookie);
    expect(reply.status, reply.text).toBe(200);
    expect(Object.keys(reply.body as object)).toEqual(["registrations"]);
    expect((reply.body as { registrations: Item[] }).registrations).toHaveLength(1);
  });
});

describe("MR3: exactly the item keys, nothing leaked", () => {
  it("has the registration shape plus event_title, event_starts_at and event_status, with the stored values", async () => {
    const email = uniqueEmail("mr3");
    const userId = await insertUser(db.pool, email);
    const cookie = await mintSessionCookie("user", userId);
    const startsAt = new Date("2031-04-05T06:07:08.910Z");
    const eventId = await insertEvent(db.pool, owner.id, {
      title: "Item keys event",
      startsAt,
      capacity: 7,
      description: "SECRET-DESCRIPTION-MR3",
    });
    const row = await insertRegistration(db.pool, eventId, userId, "registered");
    const at = new Date("2031-01-02T03:04:05.678Z");
    await setCreatedAt(db.pool, row.id, at);
    // Someone else on the same event.
    const otherEmail = uniqueEmail("mr3-other");
    const otherId = await insertUser(db.pool, otherEmail);
    const otherRow = await insertRegistration(db.pool, eventId, otherId, "waitlisted");

    const reply = await myList(cookie);
    expect(reply.status, reply.text).toBe(200);
    const got = (reply.body as { registrations: Item[] }).registrations;
    expect(got).toHaveLength(1);
    expect(Object.keys(got[0])).toEqual(ITEM_KEYS);
    expect(got[0]).toEqual({
      id: row.id,
      event_id: eventId,
      status: "registered",
      ticket_code: row.ticketCode,
      waitlist_position: null,
      checked_in_at: null,
      created_at: at.toISOString(),
      event_title: "Item keys event",
      event_starts_at: startsAt.toISOString(),
      event_status: "active",
    });

    for (const key of [
      "user_id",
      "queue_no",
      "cancelled_at",
      "organizer_id",
      "capacity",
      "description",
      "email",
      "name",
      "password_hash",
      "duration_minutes",
      "event_stored_status",
    ]) {
      expect(reply.text).not.toContain(`"${key}"`);
    }
    for (const hidden of [
      userId,
      email,
      owner.id,
      "SECRET-DESCRIPTION-MR3",
      otherId,
      otherEmail,
      otherRow.id,
      otherRow.ticketCode,
    ]) {
      expect(reply.text).not.toContain(hidden);
    }
  });

  it("answers checked_in_at as an ISO string once it is set", async () => {
    const person = await attendee(db.pool);
    const row = await insertRegistration(db.pool, await insertEvent(db.pool, owner.id), person.id, "registered");
    const at = new Date("2030-05-06T07:08:09.123Z");
    await db.pool.query("UPDATE registrations SET checked_in_at = $2 WHERE id = $1", [row.id, at]);
    const [item] = await items(person.cookie);
    expect(item.checked_in_at).toBe(at.toISOString());
  });
});

describe("MR4: own rows only (tests first)", () => {
  it("shows A exactly A's rows and B exactly B's row; ?user_id= and a body are ignored", async () => {
    const a = await attendee(db.pool);
    const b = await attendee(db.pool);
    const shared = await insertEvent(db.pool, owner.id, { capacity: 1 });
    const onlyA = await insertEvent(db.pool, owner.id);
    const a1 = await insertRegistration(db.pool, shared, a.id, "registered");
    const a2 = await insertRegistration(db.pool, onlyA, a.id, "waitlisted");
    const b1 = await insertRegistration(db.pool, shared, b.id, "waitlisted");

    const mineA = await items(a.cookie);
    expect(mineA.map((item) => item.id).sort()).toEqual([a1.id, a2.id].sort());
    const mineB = await items(b.cookie);
    expect(mineB.map((item) => item.id)).toEqual([b1.id]);

    // The user id comes from the cookie only.
    const viaQuery = await items(a.cookie, `?user_id=${b.id}`);
    expect(viaQuery).toEqual(mineA);
    const viaBody = await getWithBody("/me/registrations", a.cookie, { user_id: b.id });
    expect(viaBody.status, viaBody.text).toBe(200);
    expect(viaBody.body).toEqual({ registrations: mineA });
    for (const hidden of [b.id, b1.id, b1.ticketCode]) {
      expect(viaQuery.map((item) => JSON.stringify(item)).join()).not.toContain(hidden);
      expect(viaBody.text).not.toContain(hidden);
    }
  });

  it("does not show rows of attendees who are not logged in, on any event", async () => {
    const person = await attendee(db.pool);
    const eventId = await insertEvent(db.pool, owner.id);
    for (let i = 0; i < 3; i++) {
      await insertRegistration(db.pool, eventId, await insertUser(db.pool), "registered");
    }
    const mine = await insertRegistration(db.pool, eventId, person.id, "registered");
    expect((await items(person.cookie)).map((item) => item.id)).toEqual([mine.id]);
  });
});

describe("MR5: every registration status is listed, with history", () => {
  it("lists registered, waitlisted and cancelled rows; a cancelled row keeps its code and has no place", async () => {
    const person = await attendee(db.pool);
    const seat = await insertRegistration(db.pool, await insertEvent(db.pool, owner.id), person.id, "registered");
    const wait = await insertRegistration(
      db.pool,
      await insertEvent(db.pool, owner.id, { capacity: 0 }),
      person.id,
      "waitlisted",
    );
    const goneEvent = await insertEvent(db.pool, owner.id, { capacity: 0 });
    const gone = await insertRegistration(db.pool, goneEvent, person.id, "waitlisted");
    await cancelRegistrationInDb(db.pool, gone.id);

    const byId = new Map((await items(person.cookie)).map((item) => [item.id, item]));
    expect(byId.size).toBe(3);
    expect(byId.get(seat.id)).toMatchObject({ status: "registered", ticket_code: seat.ticketCode, waitlist_position: null });
    expect(byId.get(wait.id)).toMatchObject({ status: "waitlisted", ticket_code: wait.ticketCode, waitlist_position: 1 });
    expect(byId.get(gone.id)).toMatchObject({
      event_id: goneEvent,
      status: "cancelled",
      ticket_code: gone.ticketCode,
      waitlist_position: null,
    });
  });

  it("lists both rows after a cancel and a new registration for the same event", async () => {
    const person = await attendee(db.pool);
    const eventId = await insertEvent(db.pool, owner.id, { capacity: 5 });
    const first = asRegistration(await register(api, eventId, person.cookie));
    await cancelRegistrationInDb(db.pool, first.id);
    const again = await register(api, eventId, person.cookie);
    expect(again.status, again.text).toBe(201);
    const second = asRegistration(again);

    const got = await items(person.cookie);
    expect(got).toHaveLength(2);
    expect(got.map((item) => item.event_id)).toEqual([eventId, eventId]);
    const byId = new Map(got.map((item) => [item.id, item]));
    expect(byId.get(first.id)).toMatchObject({ status: "cancelled", ticket_code: first.ticket_code });
    expect(byId.get(second.id)).toMatchObject({ status: "registered", ticket_code: second.ticket_code });
    expect(first.ticket_code).not.toBe(second.ticket_code);
  });
});

describe("MR6: the place on the waiting list (tests first)", () => {
  it("is the R7/R17 place for waiting items, null otherwise, and gets smaller after cancels before it", async () => {
    const person = await attendee(db.pool);
    const eventId = await insertEvent(db.pool, owner.id, { capacity: 0 });
    const a = await insertRegistration(db.pool, eventId, await insertUser(db.pool), "waitlisted");
    const b = await insertRegistration(db.pool, eventId, await insertUser(db.pool), "waitlisted");
    const mine = await insertRegistration(db.pool, eventId, person.id, "waitlisted");
    await insertRegistration(db.pool, eventId, await insertUser(db.pool), "waitlisted");
    // Waiting rows of another event are not counted.
    const otherEvent = await insertEvent(db.pool, owner.id, { capacity: 0 });
    await insertRegistration(db.pool, otherEvent, await insertUser(db.pool), "waitlisted");
    const mineOther = await insertRegistration(db.pool, otherEvent, person.id, "waitlisted");
    const seated = await insertRegistration(db.pool, await insertEvent(db.pool, owner.id), person.id, "registered");
    const cancelledEvent = await insertEvent(db.pool, owner.id, { capacity: 0 });
    const cancelled = await insertRegistration(db.pool, cancelledEvent, person.id, "waitlisted");
    await cancelRegistrationInDb(db.pool, cancelled.id);

    const place = async (id: string) => (await items(person.cookie)).find((item) => item.id === id)?.waitlist_position;
    // The same number as the single read of registration.md R17.
    const single = asRegistration(await myRegistration(api, eventId, person.cookie));
    expect(single.waitlist_position).toBe(3);
    expect(await place(mine.id)).toBe(3);
    expect(await place(mineOther.id)).toBe(2);
    expect(await place(seated.id)).toBeNull();
    expect(await place(cancelled.id)).toBeNull();

    await cancelRegistrationInDb(db.pool, a.id);
    expect(await place(mine.id)).toBe(2);
    await cancelRegistrationInDb(db.pool, b.id);
    expect(await place(mine.id)).toBe(1);
    expect(asRegistration(await myRegistration(api, eventId, person.cookie)).waitlist_position).toBe(1);
  });
});

describe("MR7: the derived event status (tests first)", () => {
  it("is active, running active, cancelled, passed, and cancelled wins over passed, for any registration status", async () => {
    const person = await attendee(db.pool);
    const expected = new Map<string, Item["event_status"]>();
    // One set of five events per registration status (one active row per
    // account and event).
    for (const status of ["registered", "waitlisted", "cancelled"] as const) {
      const future = await insertEvent(db.pool, owner.id, { title: "future" });
      const running = await insertEvent(db.pool, owner.id, {
        title: "running",
        startsAt: new Date(Date.now() - 30 * MINUTE),
        durationMinutes: 60,
      });
      const cancelled = await insertEvent(db.pool, owner.id, { title: "cancelled" });
      await cancelEventInDb(db.pool, cancelled);
      const passed = await insertEvent(db.pool, owner.id, {
        title: "passed",
        startsAt: new Date(Date.now() - 3 * HOUR),
        durationMinutes: 60,
      });
      const cancelledPassed = await insertEvent(db.pool, owner.id, {
        title: "cancelled and passed",
        startsAt: new Date(Date.now() - 2 * DAY),
        durationMinutes: 60,
      });
      await cancelEventInDb(db.pool, cancelledPassed);
      expected.set(future, "active");
      expected.set(running, "active");
      expected.set(cancelled, "cancelled");
      expected.set(passed, "passed");
      expected.set(cancelledPassed, "cancelled");
      for (const eventId of [future, running, cancelled, passed, cancelledPassed]) {
        await insertRegistration(db.pool, eventId, person.id, status);
      }
    }

    const got = await items(person.cookie);
    expect(got).toHaveLength(15);
    for (const item of got) {
      expect(item.event_status, `${item.event_title} ${item.status}`).toBe(expected.get(item.event_id));
    }
  });

  it("follows the stored status: an event cancelled by SQL shows cancelled on the next read", async () => {
    const person = await attendee(db.pool);
    const eventId = await insertEvent(db.pool, owner.id);
    await insertRegistration(db.pool, eventId, person.id, "registered");
    expect((await items(person.cookie))[0].event_status).toBe("active");
    await cancelEventInDb(db.pool, eventId);
    expect((await items(person.cookie))[0].event_status).toBe("cancelled");
  });
});

describe("MR8: event title and start follow the event", () => {
  it("shows the stored title and start as ISO UTC, and the new values after a change by SQL", async () => {
    const person = await attendee(db.pool);
    const startsAt = new Date("2032-07-08T09:10:11.120Z");
    const eventId = await insertEvent(db.pool, owner.id, { title: "Old title", startsAt });
    await insertRegistration(db.pool, eventId, person.id, "registered");

    const [before] = await items(person.cookie);
    expect(before).toMatchObject({ event_title: "Old title", event_starts_at: startsAt.toISOString() });

    const moved = new Date("2033-01-02T03:04:05.000Z");
    await db.pool.query("UPDATE events SET title = 'New title', starts_at = $2 WHERE id = $1", [eventId, moved]);
    const [after] = await items(person.cookie);
    expect(after).toMatchObject({ event_title: "New title", event_starts_at: moved.toISOString() });
    expect(after.event_starts_at).toMatch(/Z$/);
  });
});

describe("MR9: newest first, then id descending (tests first)", () => {
  it("orders by created_at descending with id descending as the tie-break, on every read", async () => {
    const person = await attendee(db.pool);
    // Event starts and statuses in the opposite order, so they cannot decide.
    const soon = await insertEvent(db.pool, owner.id, { startsAt: new Date(Date.now() + HOUR) });
    const late = await insertEvent(db.pool, owner.id, { startsAt: new Date(Date.now() + 30 * DAY) });
    const ended = await insertEvent(db.pool, owner.id, {
      startsAt: new Date(Date.now() - 2 * DAY),
      durationMinutes: 60,
    });
    const r1 = await insertRegistration(db.pool, late, person.id, "registered");
    const r2 = await insertRegistration(db.pool, soon, person.id, "waitlisted");
    const r3 = await insertRegistration(db.pool, ended, person.id, "cancelled");
    const r4 = await insertRegistration(db.pool, soon, person.id, "cancelled");
    const r5 = await insertRegistration(db.pool, late, person.id, "cancelled");

    const base = Date.parse("2030-01-01T10:00:00.000Z");
    await setCreatedAt(db.pool, r1.id, new Date(base));
    await setCreatedAt(db.pool, r2.id, new Date(base + 3000));
    await setCreatedAt(db.pool, r3.id, new Date(base + 1000));
    // r4 and r5 share one created_at, the newest: id decides between them.
    await setCreatedAt(db.pool, r4.id, new Date(base + 5000));
    await setCreatedAt(db.pool, r5.id, new Date(base + 5000));

    const tie = [r4.id, r5.id].sort().reverse();
    const order = [...tie, r2.id, r3.id, r1.id];
    for (let read = 0; read < 3; read++) {
      expect((await items(person.cookie)).map((item) => item.id)).toEqual(order);
    }
  });

  it("puts a new registration first", async () => {
    const person = await attendee(db.pool);
    const older = await insertRegistration(db.pool, await insertEvent(db.pool, owner.id), person.id, "registered");
    await setCreatedAt(db.pool, older.id, new Date(Date.now() - DAY));
    const eventId = await insertEvent(db.pool, owner.id);
    const created = asRegistration(await register(api, eventId, person.cookie));
    expect((await items(person.cookie)).map((item) => item.id)).toEqual([created.id, older.id]);
  });
});

describe("MR10: one statement for the whole list (tests first)", () => {
  it("runs exactly one query, no lock, no transaction, for 5 registrations of mixed statuses", async () => {
    const person = await attendee(db.pool);
    const statuses = ["registered", "waitlisted", "cancelled", "registered", "waitlisted"] as const;
    for (const status of statuses) {
      const eventId = await insertEvent(db.pool, owner.id, { capacity: status === "waitlisted" ? 0 : 5 });
      await insertRegistration(db.pool, eventId, person.id, status);
    }
    // A client from pool.connect() would not pass through pool.query, so one
    // pool.query call also means no explicit transaction on a client.
    const query = vi.spyOn(db.pool, "query");
    let got: Item[];
    try {
      got = await items(person.cookie);
      const statements = query.mock.calls.map(([text]) =>
        typeof text === "string" ? text : (text as { text: string }).text,
      );
      expect(statements).toHaveLength(1);
      expect(statements[0]).toMatch(/\bregistrations\b/i);
      expect(statements[0]).toMatch(/\bevents\b/i);
      expect(statements[0]).not.toMatch(/\bFOR\s+(UPDATE|SHARE|NO KEY UPDATE|KEY SHARE)\b/i);
      expect(statements[0]).not.toMatch(/^\s*(BEGIN|START TRANSACTION)\b/i);
    } finally {
      query.mockRestore();
    }
    expect(got).toHaveLength(5);
    expect(got.map((item) => item.status).sort()).toEqual([...statuses].sort());
  });
});

describe("MR11: a fresh read every time", () => {
  it("answers with Cache-Control: no-store", async () => {
    const person = await attendee(db.pool);
    const res = await fetch(`${api.url}/me/registrations`, { headers: { cookie: person.cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("two reads with a registration between them show the new item", async () => {
    const person = await attendee(db.pool);
    expect(await items(person.cookie)).toEqual([]);
    const eventId = await insertEvent(db.pool, owner.id);
    const created = asRegistration(await register(api, eventId, person.cookie));
    expect((await items(person.cookie)).map((item) => item.id)).toEqual([created.id]);
  });
});

describe("MR12: the route changes nothing", () => {
  it("writes no row and leaves the single-event routes as they were", async () => {
    const person = await attendee(db.pool);
    const eventId = await insertEvent(db.pool, owner.id, { capacity: 1 });
    const created = await register(api, eventId, person.cookie);
    expect(created.status, created.text).toBe(201);
    const rowsBefore = await db.pool.query("SELECT * FROM registrations WHERE user_id = $1 ORDER BY id", [person.id]);
    const before = await counts(db.pool);

    for (let i = 0; i < 3; i++) await items(person.cookie);

    expect(await counts(db.pool)).toEqual(before);
    const rowsAfter = await db.pool.query("SELECT * FROM registrations WHERE user_id = $1 ORDER BY id", [person.id]);
    expect(rowsAfter.rows).toEqual(rowsBefore.rows);

    const single = await myRegistration(api, eventId, person.cookie);
    expect(single.status, single.text).toBe(200);
    expect(asRegistration(single)).toEqual(asRegistration(created));
    const repeat = await register(api, eventId, person.cookie);
    expect(repeat.status, repeat.text).toBe(200);
    expect(asRegistration(repeat)).toEqual(asRegistration(created));
  });
});

describe("MR13: cancelled and passed events keep their registrations in the list", () => {
  it("lists rows of a cancelled and of a passed event", async () => {
    const person = await attendee(db.pool);
    const cancelled = await insertEvent(db.pool, owner.id);
    const created = asRegistration(await register(api, cancelled, person.cookie));
    await cancelEventInDb(db.pool, cancelled);
    const passed = await insertEvent(db.pool, owner.id, {
      startsAt: new Date(Date.now() - 3 * HOUR),
      durationMinutes: 60,
    });
    const old = await insertRegistration(db.pool, passed, person.id, "registered");

    const byId = new Map((await items(person.cookie)).map((item) => [item.id, item]));
    expect(byId.get(created.id)).toMatchObject({ event_id: cancelled, status: "registered", event_status: "cancelled" });
    expect(byId.get(old.id)).toMatchObject({ event_id: passed, status: "registered", event_status: "passed" });
  });
});

describe("MR14: errors and no input", () => {
  it("uses { error } for both errors and ignores any query string (no 400, no 404)", async () => {
    const person = await attendee(db.pool);
    const row = await insertRegistration(db.pool, await insertEvent(db.pool, owner.id), person.id, "registered");
    for (const query of ["?limit=abc", "?sort=-created_at&page=2", "?status=cancelled", "?event_id=abc", "?x=%27%20OR%20%271%27%3D%271"]) {
      expect((await items(person.cookie, query)).map((item) => item.id), query).toEqual([row.id]);
    }
    const anonymous = await myList(undefined, "?limit=abc");
    expect(anonymous.body).toEqual({ error: "not_logged_in" });
    const wrong = await myList(owner.cookie, "?limit=abc");
    expect(wrong.body).toEqual({ error: "wrong_role" });
  });
});

describe("MR15: the path is not shadowed and shadows nothing", () => {
  it("reaches the list with a plain GET; /auth/me, /events/:id/registrations/me and the 404 handler answer as before", async () => {
    const person = await attendee(db.pool);
    const eventId = await insertEvent(db.pool, owner.id);
    const created = asRegistration(await register(api, eventId, person.cookie));

    expect((await items(person.cookie)).map((item) => item.id)).toEqual([created.id]);

    const me = await call(api, "GET", "/auth/me", { cookie: person.cookie });
    expect(me.status, me.text).toBe(200);
    expect(me.body).toMatchObject({ id: person.id, role: "user" });
    const organizerMe = await call(api, "GET", "/auth/me", { cookie: owner.cookie });
    expect(organizerMe.status, organizerMe.text).toBe(200);

    expect(asRegistration(await myRegistration(api, eventId, person.cookie))).toEqual(created);

    for (const path of ["/me", "/me/registrations/extra", `/me/registrations/${created.id}`, "/registrations/me"]) {
      const reply = await call(api, "GET", path, { cookie: person.cookie });
      expect(reply, path).toMatchObject({ status: 404, body: { error: "not_found" } });
    }
    const post = await call(api, "POST", "/me/registrations", { cookie: person.cookie, body: {} });
    expect(post).toMatchObject({ status: 404, body: { error: "not_found" } });
  });
});
