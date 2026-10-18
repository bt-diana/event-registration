import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import { mintSessionCookie, type Running } from "../auth/helpers.js";
import { createTestDb, insertEvent, insertRegistration, insertUser, uniqueEmail, type TestDb } from "../db/helpers.js";
import { attendee, call, DAY, HOUR, MALFORMED_IDS, organizer, startApi, UNKNOWN_ID, type Account, type Reply } from "../events/helpers.js";
import {
  asRegistration,
  cancelEventInDb,
  cancelRegistrationInDb,
  myRegistration,
  REGISTRATION_KEYS,
  register,
} from "../registrations/helpers.js";

// GET /events/:id/registrations, the organizer registrations list
// (checkin.md C1 for this route, C15-C19). Step 26, written before the route.

// The list item: the registration shape (registration.md R21) plus the name
// and email of the attendee, in the order of checkin.md section 3.
const LIST_KEYS = [...REGISTRATION_KEYS, "attendee_name", "attendee_email"];

type Item = {
  id: string;
  event_id: string;
  status: "registered" | "waitlisted";
  ticket_code: string;
  waitlist_position: number | null;
  checked_in_at: string | null;
  created_at: string;
  attendee_name: string;
  attendee_email: string;
};

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

function list(eventId: string, cookie?: string): Promise<Reply> {
  return call(api, "GET", `/events/${eventId}/registrations`, { cookie });
}

// Answers 200 and the items, each checked for the exact key list (C15).
async function items(eventId: string, cookie = owner.cookie): Promise<Item[]> {
  const reply = await list(eventId, cookie);
  expect(reply.status, reply.text).toBe(200);
  expect(Object.keys(reply.body as object)).toEqual(["registrations"]);
  const registrations = (reply.body as { registrations: Item[] }).registrations;
  for (const item of registrations) expect(Object.keys(item), reply.text).toEqual(LIST_KEYS);
  return registrations;
}

// An attendee row with a given name and email.
async function namedUser(pool: pg.Pool, name: string): Promise<{ id: string; email: string }> {
  const email = uniqueEmail(name.toLowerCase().replace(/\s+/g, "-"));
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, 'hash') RETURNING id`,
    [email, name],
  );
  return { id: rows[0].id, email };
}

async function setCreatedAt(pool: pg.Pool, registrationId: string, at: Date): Promise<void> {
  await pool.query("UPDATE registrations SET created_at = $2 WHERE id = $1", [registrationId, at]);
}

async function setCheckedIn(pool: pg.Pool, registrationId: string, at: Date | null = null): Promise<void> {
  await pool.query("UPDATE registrations SET checked_in_at = coalesce($2, now()) WHERE id = $1", [
    registrationId,
    at,
  ]);
}

describe("C15: the organizer's registrations list", () => {
  it("lists the registered and waitlisted rows in order, with exactly the list keys", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { capacity: 2 });
    const ann = await namedUser(db.pool, "Ann One");
    const bob = await namedUser(db.pool, "Bob Two");
    const cat = await namedUser(db.pool, "Cat Three");
    const dan = await namedUser(db.pool, "Dan Four");
    const eve = await namedUser(db.pool, "Eve Five");
    const fay = await namedUser(db.pool, "Fay Six");

    // queue_no follows the insert order: r1, w1, wGone, w2, r2, gone.
    const r1 = await insertRegistration(db.pool, eventId, ann.id, "registered");
    const w1 = await insertRegistration(db.pool, eventId, bob.id, "waitlisted");
    const wGone = await insertRegistration(db.pool, eventId, cat.id, "waitlisted");
    const w2 = await insertRegistration(db.pool, eventId, eve.id, "waitlisted");
    const r2 = await insertRegistration(db.pool, eventId, dan.id, "registered");
    const gone = await insertRegistration(db.pool, eventId, fay.id, "cancelled");
    await cancelRegistrationInDb(db.pool, wGone.id);

    // created_at decides the list order, not queue_no. r1 and w1 have the same
    // created_at, so id decides between them.
    const base = Date.parse("2030-01-01T10:00:00.000Z");
    await setCreatedAt(db.pool, wGone.id, new Date(base));
    await setCreatedAt(db.pool, r2.id, new Date(base + 1000));
    await setCreatedAt(db.pool, w2.id, new Date(base + 2000));
    await setCreatedAt(db.pool, r1.id, new Date(base + 3000));
    await setCreatedAt(db.pool, w1.id, new Date(base + 3000));
    await setCreatedAt(db.pool, gone.id, new Date(base + 4000));
    const checkedIn = new Date("2030-01-02T09:30:15.250Z");
    await setCheckedIn(db.pool, r2.id, checkedIn);

    const expected: Record<string, Item> = {
      [r1.id]: {
        id: r1.id,
        event_id: eventId,
        status: "registered",
        ticket_code: r1.ticketCode,
        waitlist_position: null,
        checked_in_at: null,
        created_at: new Date(base + 3000).toISOString(),
        attendee_name: "Ann One",
        attendee_email: ann.email,
      },
      [w1.id]: {
        id: w1.id,
        event_id: eventId,
        status: "waitlisted",
        ticket_code: w1.ticketCode,
        // The cancelled waiting row is not counted (R7, R18).
        waitlist_position: 1,
        checked_in_at: null,
        created_at: new Date(base + 3000).toISOString(),
        attendee_name: "Bob Two",
        attendee_email: bob.email,
      },
      [w2.id]: {
        id: w2.id,
        event_id: eventId,
        status: "waitlisted",
        ticket_code: w2.ticketCode,
        // The place follows queue_no, not the list order (R7).
        waitlist_position: 2,
        checked_in_at: null,
        created_at: new Date(base + 2000).toISOString(),
        attendee_name: "Eve Five",
        attendee_email: eve.email,
      },
      [r2.id]: {
        id: r2.id,
        event_id: eventId,
        status: "registered",
        ticket_code: r2.ticketCode,
        waitlist_position: null,
        checked_in_at: checkedIn.toISOString(),
        created_at: new Date(base + 1000).toISOString(),
        attendee_name: "Dan Four",
        attendee_email: dan.email,
      },
    };
    const tie = [r1.id, w1.id].sort();
    const order = [r2.id, w2.id, ...tie];

    const got = await items(eventId);
    expect(got).toEqual(order.map((id) => expected[id]));
  });

  it("never shows user_id, queue_no, cancelled_at, cancelled rows or another event's rows", async () => {
    const eventId = await insertEvent(db.pool, owner.id);
    const sibling = await insertEvent(db.pool, owner.id);
    const foreign = await insertEvent(db.pool, other.id);
    const shown = await namedUser(db.pool, "Shown Person");
    const cancelled = await namedUser(db.pool, "Cancelled Person");
    const elsewhere = await namedUser(db.pool, "Elsewhere Person");
    const row = await insertRegistration(db.pool, eventId, shown.id, "registered");
    const gone = await insertRegistration(db.pool, eventId, cancelled.id, "cancelled");
    const siblingRow = await insertRegistration(db.pool, sibling, elsewhere.id, "registered");
    const foreignRow = await insertRegistration(db.pool, foreign, elsewhere.id, "waitlisted");

    const reply = await list(eventId, owner.cookie);
    expect(reply.status, reply.text).toBe(200);
    const got = (reply.body as { registrations: Item[] }).registrations;
    expect(got.map((item) => item.id)).toEqual([row.id]);
    for (const key of ["user_id", "queue_no", "cancelled_at", "password_hash", "organizer_id"]) {
      expect(reply.text).not.toContain(key);
    }
    for (const hidden of [
      shown.id,
      owner.id,
      gone.id,
      gone.ticketCode,
      cancelled.email,
      "Cancelled Person",
      siblingRow.id,
      siblingRow.ticketCode,
      foreignRow.id,
      foreignRow.ticketCode,
      elsewhere.email,
      "Elsewhere Person",
    ]) {
      expect(reply.text).not.toContain(hidden);
    }
  });

  it("answers { registrations: [] } for an own event with nobody, or only cancelled rows", async () => {
    const empty = await insertEvent(db.pool, owner.id);
    expect(await items(empty)).toEqual([]);

    const onlyCancelled = await insertEvent(db.pool, owner.id);
    await insertRegistration(db.pool, onlyCancelled, await insertUser(db.pool), "cancelled");
    const reply = await list(onlyCancelled, owner.cookie);
    expect(reply).toMatchObject({ status: 200, body: { registrations: [] } });
  });

  it("has the same registration part as the attendee's own read, plus name and email", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { capacity: 1 });
    const seated = await attendee(db.pool);
    const waiting = await attendee(db.pool);
    const first = await register(api, eventId, seated.cookie);
    const second = await register(api, eventId, waiting.cookie);
    expect([first.status, second.status]).toEqual([201, 201]);

    const got = await items(eventId);
    expect(got).toHaveLength(2);
    for (const [index, person] of [seated, waiting].entries()) {
      const mine = asRegistration(await myRegistration(api, eventId, person.cookie));
      const { attendee_name, attendee_email, ...registration } = got[index];
      expect(registration).toEqual(mine);
      const { rows } = await db.pool.query<{ name: string; email: string }>(
        "SELECT name, email FROM users WHERE id = $1",
        [person.id],
      );
      expect({ attendee_name, attendee_email }).toEqual(rows[0]);
    }
    expect(got.map((item) => [item.status, item.waitlist_position])).toEqual([
      ["registered", null],
      ["waitlisted", 1],
    ]);
  });
});

describe("C16: the list follows the data (list side)", () => {
  it("after a check-in only that item's checked_in_at changes; the arrivals count follows", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { capacity: 2 });
    const a = await insertRegistration(db.pool, eventId, await insertUser(db.pool), "registered");
    const b = await insertRegistration(db.pool, eventId, await insertUser(db.pool), "registered");
    await insertRegistration(db.pool, eventId, await insertUser(db.pool), "waitlisted");

    // The counter of checkin.md section 2: checked-in registered items out of
    // the registered items; waiting items never count.
    const arrivals = (snapshot: Item[]) => {
      const seated = snapshot.filter((item) => item.status === "registered");
      return [seated.filter((item) => item.checked_in_at !== null).length, seated.length];
    };

    const before = await items(eventId);
    expect(arrivals(before)).toEqual([0, 2]);

    // POST /checkin is a later step; the check-in is made by SQL here.
    await setCheckedIn(db.pool, b.id);
    const after = await items(eventId);
    expect(arrivals(after)).toEqual([1, 2]);
    const { rows } = await db.pool.query<{ checked_in_at: Date }>(
      "SELECT checked_in_at FROM registrations WHERE id = $1",
      [b.id],
    );
    expect(after).toEqual(
      before.map((item) =>
        item.id === b.id ? { ...item, checked_in_at: rows[0].checked_in_at.toISOString() } : item,
      ),
    );
    expect(after.find((item) => item.id === a.id)?.checked_in_at).toBeNull();
    for (const item of after.filter((item) => item.status === "waitlisted")) {
      expect(item.checked_in_at).toBeNull();
    }
  });
});

describe("C17: unknown, malformed and foreign events answer the same 404 (tests first)", () => {
  it("answers 404 not_found for an unknown uuid and for another organizer's event, with the same body", async () => {
    const foreign = await insertEvent(db.pool, other.id);
    const person = await namedUser(db.pool, "Foreign Guest");
    const row = await insertRegistration(db.pool, foreign, person.id, "registered");

    const unknown = await list(UNKNOWN_ID, owner.cookie);
    const notMine = await list(foreign, owner.cookie);
    expect(unknown).toMatchObject({ status: 404, body: { error: "not_found" } });
    expect(Object.keys(unknown.body as object)).toEqual(["error"]);
    expect(notMine.status).toBe(unknown.status);
    expect(notMine.text).toBe(unknown.text);
    for (const hidden of [row.id, row.ticketCode, person.email, "Foreign Guest"]) {
      expect(notMine.text).not.toContain(hidden);
    }

    // The owner still sees it.
    expect((await items(foreign, other.cookie)).map((item) => item.id)).toEqual([row.id]);
  });

  it("answers 404 for an id that is not a uuid without a query", async () => {
    const query = vi.spyOn(db.pool, "query");
    const connect = vi.spyOn(db.pool, "connect");
    try {
      for (const id of MALFORMED_IDS) {
        const reply = await list(encodeURIComponent(id), owner.cookie);
        expect(reply, id).toMatchObject({ status: 404, body: { error: "not_found" } });
      }
      expect(query).not.toHaveBeenCalled();
      expect(connect).not.toHaveBeenCalled();
    } finally {
      query.mockRestore();
      connect.mockRestore();
    }
  });

  it("answers 200 with the rows for a cancelled event and for a passed event of the organizer", async () => {
    const cancelled = await insertEvent(db.pool, owner.id);
    const passed = await insertEvent(db.pool, owner.id, {
      startsAt: new Date(Date.now() - 3 * HOUR),
      durationMinutes: 60,
    });
    for (const eventId of [cancelled, passed]) {
      const seat = await insertRegistration(db.pool, eventId, await insertUser(db.pool), "registered");
      const wait = await insertRegistration(db.pool, eventId, await insertUser(db.pool), "waitlisted");
      if (eventId === cancelled) await cancelEventInDb(db.pool, eventId);
      const got = await items(eventId);
      expect(got.map((item) => [item.id, item.status, item.waitlist_position])).toEqual([
        [seat.id, "registered", null],
        [wait.id, "waitlisted", 1],
      ]);
    }
  });
});

describe("C18: a fresh snapshot for polling", () => {
  it("answers with Cache-Control: no-store", async () => {
    const eventId = await insertEvent(db.pool, owner.id);
    const res = await fetch(`${api.url}/events/${eventId}/registrations`, { headers: { cookie: owner.cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("reads the rows in one statement, without a lock or a transaction", async () => {
    const eventId = await insertEvent(db.pool, owner.id);
    await insertRegistration(db.pool, eventId, await insertUser(db.pool), "registered");
    await insertRegistration(db.pool, eventId, await insertUser(db.pool), "waitlisted");
    const query = vi.spyOn(db.pool, "query");
    try {
      expect(await items(eventId)).toHaveLength(2);
      const statements = query.mock.calls.map(([text]) =>
        typeof text === "string" ? text : (text as { text: string }).text,
      );
      for (const sql of statements) {
        expect(sql).not.toMatch(/\bFOR\s+(UPDATE|SHARE|NO KEY UPDATE|KEY SHARE)\b/i);
        expect(sql).not.toMatch(/^\s*(BEGIN|START TRANSACTION)\b/i);
      }
      expect(statements.filter((sql) => /\bregistrations\b/i.test(sql))).toHaveLength(1);
    } finally {
      query.mockRestore();
    }
  });

  it("two reads with a check-in between them show the new checked_in_at", async () => {
    const eventId = await insertEvent(db.pool, owner.id);
    const row = await insertRegistration(db.pool, eventId, await insertUser(db.pool), "registered");
    expect((await items(eventId))[0].checked_in_at).toBeNull();
    const at = new Date("2030-03-04T05:06:07.890Z");
    await setCheckedIn(db.pool, row.id, at);
    expect((await items(eventId))[0].checked_in_at).toBe(at.toISOString());
  });
});

describe("C1: guards on GET /events/:id/registrations (tests first)", () => {
  it("answers 401 not_logged_in without a valid login and 403 wrong_role to an attendee, before the id check", async () => {
    const eventId = await insertEvent(db.pool, owner.id);
    await insertRegistration(db.pool, eventId, await insertUser(db.pool), "registered");
    const person = await attendee(db.pool);
    const expired = await mintSessionCookie("organizer", owner.id, Date.now() - 8 * DAY);
    const query = vi.spyOn(db.pool, "query");
    try {
      for (const id of [eventId, UNKNOWN_ID, MALFORMED_IDS[0]]) {
        for (const cookie of [undefined, "session=garbage", expired]) {
          const reply = await list(id, cookie);
          expect(reply, `${cookie} ${id}`).toMatchObject({ status: 401, body: { error: "not_logged_in" } });
          expect(Object.keys(reply.body as object)).toEqual(["error"]);
        }
        const reply = await list(id, person.cookie);
        expect(reply, id).toMatchObject({ status: 403, body: { error: "wrong_role" } });
        expect(Object.keys(reply.body as object)).toEqual(["error"]);
      }
      expect(query).not.toHaveBeenCalled();
    } finally {
      query.mockRestore();
    }
  });

  it("leaves the attendee routes on the same path working", async () => {
    const eventId = await insertEvent(db.pool, owner.id);
    const person = await attendee(db.pool);
    const created = await register(api, eventId, person.cookie);
    expect(created.status, created.text).toBe(201);
    const mine = await myRegistration(api, eventId, person.cookie);
    expect(mine.status, mine.text).toBe(200);
    expect((await items(eventId)).map((item) => item.id)).toEqual([asRegistration(created).id]);
  });
});
