import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import { mintSessionCookie, type Running } from "../auth/helpers.js";
import { createTestDb, insertEvent, insertRegistration, makeTicketCode, uniqueEmail, type TestDb } from "../db/helpers.js";
import { attendee, call, DAY, HOUR, organizer, startApi, type Account, type Reply } from "../events/helpers.js";
import { cancelEventInDb, cancelRegistrationInDb } from "../registrations/helpers.js";

// POST /checkin (checkin.md C1-C14, C19, and the C16 part "a refused check-in
// changes nothing"). Step 25: written before the route (B6, test first).

// The check-in shape, in the order of checkin.md C14 and section 3.
const CHECKIN_KEYS = ["registration_id", "ticket_code", "event_id", "event_title", "attendee_name", "checked_in_at"];

// The only error with more keys than `error` (C5, C19).
const ALREADY_KEYS = ["error", "checked_in_at", "attendee_name"];

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

type CheckedIn = {
  registration_id: string;
  ticket_code: string;
  event_id: string;
  event_title: string;
  attendee_name: string;
  checked_in_at: string;
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

function checkIn(code: unknown, cookie: string | undefined = owner.cookie): Promise<Reply> {
  return call(api, "POST", "/checkin", { cookie, body: { ticket_code: code } });
}

// Answers 200 with exactly the check-in keys (C14).
function asCheckedIn(reply: Reply): CheckedIn {
  expect(reply.status, reply.text).toBe(200);
  expect(Object.keys(reply.body as object), reply.text).toEqual(CHECKIN_KEYS);
  return reply.body as CheckedIn;
}

// A 409 or 404 with only the `error` key (C19).
function expectError(reply: Reply, status: number, error: string): void {
  expect(reply, reply.text).toMatchObject({ status, body: { error } });
  expect(Object.keys(reply.body as object), reply.text).toEqual(["error"]);
}

// A 409 already_checked_in with the original time and the name (C5).
function expectAlready(reply: Reply, checkedInAt: string, name: string): void {
  expect(reply.status, reply.text).toBe(409);
  expect(Object.keys(reply.body as object), reply.text).toEqual(ALREADY_KEYS);
  expect(reply.body).toEqual({ error: "already_checked_in", checked_in_at: checkedInAt, attendee_name: name });
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

// A registration of a named attendee on an event of `organizerId`.
async function ticket(
  options: {
    organizerId?: string;
    eventId?: string;
    status?: "registered" | "waitlisted" | "cancelled";
    name?: string;
    code?: string;
  } = {},
) {
  const eventId = options.eventId ?? (await insertEvent(db.pool, options.organizerId ?? owner.id));
  const name = options.name ?? `Guest ${makeTicketCode()}`;
  const person = await namedUser(db.pool, name);
  const row = await insertRegistration(db.pool, eventId, person.id, options.status ?? "registered", options.code);
  return { eventId, name, email: person.email, userId: person.id, id: row.id, code: row.ticketCode };
}

async function storedCheckIn(registrationId: string): Promise<Date | null> {
  const { rows } = await db.pool.query<{ checked_in_at: Date | null }>(
    "SELECT checked_in_at FROM registrations WHERE id = $1",
    [registrationId],
  );
  return rows[0].checked_in_at;
}

async function setCheckedIn(registrationId: string, at: Date): Promise<void> {
  await db.pool.query("UPDATE registrations SET checked_in_at = $2 WHERE id = $1", [registrationId, at]);
}

// Every row of every table a check-in could touch, to show what changed.
type Snapshot = Record<"registrations" | "outbox" | "events" | "users" | "organizers", Record<string, unknown>[]>;

async function snapshot(): Promise<Snapshot> {
  const read = async (table: string) => (await db.pool.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
  return {
    registrations: await read("registrations"),
    outbox: await read("outbox"),
    events: await read("events"),
    users: await read("users"),
    organizers: await read("organizers"),
  };
}

// The snapshot `before` with only this registration's checked_in_at changed.
function withCheckIn(before: Snapshot, registrationId: string, at: Date | null): Snapshot {
  return {
    ...before,
    registrations: before.registrations.map((row) =>
      row.id === registrationId ? { ...row, checked_in_at: at } : row,
    ),
  };
}

function list(eventId: string, cookie = owner.cookie): Promise<Reply> {
  return call(api, "GET", `/events/${eventId}/registrations`, { cookie });
}

// Raw SQL text of each pool.query call recorded by a spy.
function statements(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls.map(([text]) => (typeof text === "string" ? text : (text as { text: string }).text));
}

describe("C1: guards on POST /checkin (tests first)", () => {
  it("answers 401 not_logged_in without a valid login and 403 wrong_role to an attendee, before the body check", async () => {
    const t = await ticket();
    const person = await attendee(db.pool);
    const expired = await mintSessionCookie("organizer", owner.id, Date.now() - 8 * DAY);
    const bodies: unknown[] = [{ ticket_code: t.code }, { ticket_code: 5 }, {}, undefined];
    const before = await snapshot();
    const query = vi.spyOn(db.pool, "query");
    try {
      for (const body of bodies) {
        for (const cookie of [undefined, "session=garbage", expired]) {
          const reply = await call(api, "POST", "/checkin", { cookie, body });
          expect(reply, `${cookie} ${JSON.stringify(body)}`).toMatchObject({
            status: 401,
            body: { error: "not_logged_in" },
          });
          expect(Object.keys(reply.body as object)).toEqual(["error"]);
        }
        const reply = await call(api, "POST", "/checkin", { cookie: person.cookie, body });
        expect(reply, JSON.stringify(body)).toMatchObject({ status: 403, body: { error: "wrong_role" } });
        expect(Object.keys(reply.body as object)).toEqual(["error"]);
      }
      expect(query).not.toHaveBeenCalled();
    } finally {
      query.mockRestore();
    }
    expect(await snapshot()).toEqual(before);
  });

  it("does not let the attendee check in their own ticket", async () => {
    const person = await attendee(db.pool);
    const eventId = await insertEvent(db.pool, owner.id);
    const row = await insertRegistration(db.pool, eventId, person.id, "registered");
    expectError(await checkIn(row.ticketCode, person.cookie), 403, "wrong_role");
    expect(await storedCheckIn(row.id)).toBeNull();
  });
});

describe("C2: the ticket_code body", () => {
  it("trims and upper-cases the code: ' abcd2345wx ' finds ABCD2345WX", async () => {
    const t = await ticket({ code: "ABCD2345WX" });
    const body = asCheckedIn(await checkIn(" abcd2345wx "));
    expect(body.registration_id).toBe(t.id);
    expect(body.ticket_code).toBe("ABCD2345WX");
  });

  it("trims tabs and newlines too", async () => {
    const t = await ticket();
    const body = asCheckedIn(await checkIn(`\t${t.code.toLowerCase()}\n`));
    expect(body.registration_id).toBe(t.id);
  });

  it("ignores other body fields", async () => {
    const t = await ticket();
    const foreign = await ticket({ organizerId: other.id });
    const reply = await call(api, "POST", "/checkin", {
      cookie: owner.cookie,
      body: {
        ticket_code: t.code,
        event_id: foreign.eventId,
        organizer_id: other.id,
        registration_id: foreign.id,
        checked_in_at: "2000-01-01T00:00:00.000Z",
      },
    });
    const body = asCheckedIn(reply);
    expect(body.registration_id).toBe(t.id);
    expect(body.event_id).toBe(t.eventId);
    expect(body.checked_in_at).not.toBe("2000-01-01T00:00:00.000Z");
    expect(await storedCheckIn(foreign.id)).toBeNull();
  });

  it("answers 400 invalid_input for a missing, non-string or malformed code, without a query", async () => {
    const t = await ticket({ code: "QRST6789MN" });
    const badCodes: unknown[] = [
      undefined,
      null,
      1234567890,
      true,
      ["QRST6789MN"],
      { code: "QRST6789MN" },
      "",
      "   ",
      "QRST6789M",
      "QRST6789MNP",
      "QRST 6789MN",
      "QRST6789 MN",
      "QRST-6789MN",
      "QRST6789M-",
      "QRST6789MI",
      "QRST6789MO",
      "QRST6789M0",
      "QRST6789M1",
      "qrst6789mo",
      "QRST6789MÄ",
      "' OR '1'='1",
    ];
    const before = await snapshot();
    const query = vi.spyOn(db.pool, "query");
    const connect = vi.spyOn(db.pool, "connect");
    try {
      for (const code of badCodes) {
        expectError(await checkIn(code), 400, "invalid_input");
      }
      for (const body of [undefined, {}, { ticketCode: t.code }, { code: t.code }]) {
        const reply = await call(api, "POST", "/checkin", { cookie: owner.cookie, body });
        expectError(reply, 400, "invalid_input");
      }
      for (const raw of [JSON.stringify(t.code), "[]", `["${t.code}"]`, "null", "not json"]) {
        const reply = await call(api, "POST", "/checkin", { cookie: owner.cookie, raw });
        expectError(reply, 400, "invalid_input");
      }
      expect(query).not.toHaveBeenCalled();
      expect(connect).not.toHaveBeenCalled();
    } finally {
      query.mockRestore();
      connect.mockRestore();
    }
    expect(await snapshot()).toEqual(before);
    expect(await storedCheckIn(t.id)).toBeNull();
  });
});

describe("C3: the first check-in (B6, tests first)", () => {
  it("sets checked_in_at = now() and answers 200 with the check-in shape and the stored time", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { title: "Door Night" });
    const t = await ticket({ eventId, name: "Ann Door" });
    const before = await snapshot();

    const startedAt = Date.now();
    const body = asCheckedIn(await checkIn(t.code));
    const endedAt = Date.now();

    expect(body).toEqual({
      registration_id: t.id,
      ticket_code: t.code,
      event_id: eventId,
      event_title: "Door Night",
      attendee_name: "Ann Door",
      checked_in_at: expect.stringMatching(ISO_UTC),
    });
    const stored = await storedCheckIn(t.id);
    expect(stored).not.toBeNull();
    expect(body.checked_in_at).toBe(stored!.toISOString());
    // The database clock and this process's clock are on the same machine.
    expect(stored!.getTime()).toBeGreaterThanOrEqual(startedAt - 1000);
    expect(stored!.getTime()).toBeLessThanOrEqual(endedAt + 1000);
    expect(await snapshot()).toEqual(withCheckIn(before, t.id, stored));
  });

  it("checks in with one conditional UPDATE, without a lock or a transaction", async () => {
    const t = await ticket();
    const query = vi.spyOn(db.pool, "query");
    try {
      asCheckedIn(await checkIn(t.code));
      const sql = statements(query);
      expect(sql).toHaveLength(1);
      expect(sql[0]).toMatch(/^\s*UPDATE\s+registrations\b/i);
      for (const text of sql) {
        expect(text).not.toMatch(/\bFOR\s+(UPDATE|SHARE|NO KEY UPDATE|KEY SHARE)\b/i);
        expect(text).not.toMatch(/^\s*(BEGIN|START TRANSACTION)\b/i);
      }
    } finally {
      query.mockRestore();
    }
  });
});

describe("C4 and C5: a ticket is checked in only once (B6, tests first)", () => {
  it("of 5 parallel check-ins with one code exactly one answers 200, four 409 with the original time (5 rounds)", async () => {
    for (let round = 0; round < 5; round++) {
      const t = await ticket({ name: `Parallel Guest ${round}` });
      const before = await snapshot();

      const replies = await Promise.all(Array.from({ length: 5 }, () => checkIn(t.code)));

      expect(replies.map((r) => r.status).sort(), `round ${round}`).toEqual([200, 409, 409, 409, 409]);
      const winner = asCheckedIn(replies.find((r) => r.status === 200)!);
      expect(winner.registration_id).toBe(t.id);
      const stored = await storedCheckIn(t.id);
      expect(winner.checked_in_at).toBe(stored!.toISOString());
      for (const reply of replies.filter((r) => r.status === 409)) {
        expectAlready(reply, winner.checked_in_at, t.name);
      }
      // One row changed, once.
      expect(await snapshot()).toEqual(withCheckIn(before, t.id, stored));
    }
  });

  it("answers a later second check-in with 409 already_checked_in, the first time and the name", async () => {
    const t = await ticket({ name: "Ben Twice" });
    const first = asCheckedIn(await checkIn(t.code));
    const afterFirst = await snapshot();
    await new Promise((resolve) => setTimeout(resolve, 30));

    const second = await checkIn(` ${t.code.toLowerCase()} `);
    expectAlready(second, first.checked_in_at, "Ben Twice");
    const third = await checkIn(t.code);
    expectAlready(third, first.checked_in_at, "Ben Twice");

    expect((await storedCheckIn(t.id))!.toISOString()).toBe(first.checked_in_at);
    expect(await snapshot()).toEqual(afterFirst);
  });

  it("answers already_checked_in with the stored time for a ticket checked in earlier", async () => {
    const t = await ticket({ name: "Cleo Early" });
    const at = new Date("2030-05-06T07:08:09.123Z");
    await setCheckedIn(t.id, at);
    const before = await snapshot();
    expectAlready(await checkIn(t.code), at.toISOString(), "Cleo Early");
    expect(await snapshot()).toEqual(before);
  });
});

describe("C6: unknown and foreign codes answer the same 404 (tests first)", () => {
  it("answers 404 not_found for an unknown code and for another organizer's ticket, with the same body", async () => {
    const foreign = await ticket({ organizerId: other.id, name: "Foreign Guest" });
    const foreignDone = await ticket({ organizerId: other.id, name: "Foreign Arrived" });
    await setCheckedIn(foreignDone.id, new Date("2030-01-01T00:00:00.000Z"));
    const foreignWaiting = await ticket({ organizerId: other.id, status: "waitlisted" });
    const foreignCancelled = await ticket({ organizerId: other.id, status: "cancelled" });
    let unknownCode = makeTicketCode();
    while ((await db.pool.query("SELECT 1 FROM registrations WHERE ticket_code = $1", [unknownCode])).rowCount) {
      unknownCode = makeTicketCode();
    }
    const before = await snapshot();

    const unknown = await checkIn(unknownCode);
    expectError(unknown, 404, "not_found");
    for (const t of [foreign, foreignDone, foreignWaiting, foreignCancelled]) {
      const reply = await checkIn(t.code);
      expect(reply.status).toBe(unknown.status);
      expect(reply.text).toBe(unknown.text);
      for (const hidden of [t.id, t.eventId, t.name, t.email, "checked_in_at", "Test event"]) {
        expect(reply.text).not.toContain(hidden);
      }
    }
    expect(await snapshot()).toEqual(before);

    // The owner can still check the ticket in.
    expect(asCheckedIn(await checkIn(foreign.code, other.cookie)).registration_id).toBe(foreign.id);
  });
});

describe("C7, C8: waiting and cancelled tickets (tests first)", () => {
  it("answers 409 waitlisted for a waitlisted ticket and changes nothing", async () => {
    const t = await ticket({ status: "waitlisted" });
    const before = await snapshot();
    expectError(await checkIn(t.code), 409, "waitlisted");
    expect(await snapshot()).toEqual(before);
  });

  it("answers 409 registration_cancelled for a cancelled ticket and changes nothing", async () => {
    const inserted = await ticket({ status: "cancelled" });
    const seated = await ticket();
    await cancelRegistrationInDb(db.pool, seated.id);
    const waiting = await ticket({ status: "waitlisted" });
    await cancelRegistrationInDb(db.pool, waiting.id);
    const before = await snapshot();
    for (const t of [inserted, seated, waiting]) {
      expectError(await checkIn(t.code), 409, "registration_cancelled");
    }
    expect(await snapshot()).toEqual(before);
  });
});

describe("C9: a cancelled event wins (tests first)", () => {
  it("answers 409 event_cancelled for every ticket of a cancelled event, also a checked-in one", async () => {
    const eventId = await insertEvent(db.pool, owner.id);
    const seated = await ticket({ eventId });
    const arrived = await ticket({ eventId });
    await setCheckedIn(arrived.id, new Date("2030-02-03T04:05:06.789Z"));
    const waiting = await ticket({ eventId, status: "waitlisted" });
    const cancelled = await ticket({ eventId, status: "cancelled" });
    await cancelEventInDb(db.pool, eventId);
    const before = await snapshot();

    for (const t of [seated, arrived, waiting, cancelled]) {
      expectError(await checkIn(t.code), 409, "event_cancelled");
    }
    expect(await snapshot()).toEqual(before);
  });
});

describe("C10, C11: no time window", () => {
  it("allows check-in for a passed event; a repeat answers already_checked_in", async () => {
    const eventId = await insertEvent(db.pool, owner.id, {
      startsAt: new Date(Date.now() - 3 * HOUR),
      durationMinutes: 60,
    });
    const t = await ticket({ eventId, name: "Late Larry" });
    const first = asCheckedIn(await checkIn(t.code));
    expect(first.registration_id).toBe(t.id);
    expectAlready(await checkIn(t.code), first.checked_in_at, "Late Larry");
  });

  it("allows check-in for an event that has not started yet", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { startsAt: new Date(Date.now() + 30 * DAY) });
    const t = await ticket({ eventId });
    expect(asCheckedIn(await checkIn(t.code)).registration_id).toBe(t.id);
  });
});

describe("C12: race-safe classification", () => {
  it("retries once when the ticket was promoted from the waiting list between the UPDATE and the read", async () => {
    const t = await ticket({ status: "waitlisted", name: "Pat Promoted" });
    const original = db.pool.query.bind(db.pool) as (text: string, values?: unknown[]) => Promise<pg.QueryResult>;
    let promoted = false;
    const query = vi.spyOn(db.pool, "query").mockImplementation((async (text: string, values?: unknown[]) => {
      const result = await original(text, values);
      if (!promoted && /^\s*UPDATE\s+registrations\b/i.test(text) && result.rowCount === 0) {
        promoted = true;
        await original("UPDATE registrations SET status = 'registered' WHERE id = $1", [t.id]);
      }
      return result;
    }) as never);
    let reply: Reply;
    try {
      reply = await checkIn(t.code);
    } finally {
      query.mockRestore();
    }
    expect(promoted).toBe(true);
    const body = asCheckedIn(reply);
    expect(body).toMatchObject({ registration_id: t.id, attendee_name: "Pat Promoted" });
    expect(body.checked_in_at).toBe((await storedCheckIn(t.id))!.toISOString());
  });
});

describe("C13, C14: what a check-in changes and answers", () => {
  it("changes only checked_in_at of that one row and writes no outbox row", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { capacity: 2 });
    const t = await ticket({ eventId });
    const neighbour = await ticket({ eventId });
    await ticket({ eventId, status: "waitlisted" });
    const before = await snapshot();
    asCheckedIn(await checkIn(t.code));
    const stored = await storedCheckIn(t.id);
    expect(await snapshot()).toEqual(withCheckIn(before, t.id, stored));
    expect(await storedCheckIn(neighbour.id)).toBeNull();
  });

  it("answers exactly the check-in keys and never the email or internal columns", async () => {
    const t = await ticket({ name: "Dee Private" });
    const reply = await checkIn(t.code);
    const body = asCheckedIn(reply);
    expect(body.checked_in_at).toMatch(ISO_UTC);
    for (const hidden of [t.email, t.userId, owner.id, "email", "user_id", "queue_no", "password_hash", "cancelled_at"]) {
      expect(reply.text).not.toContain(hidden);
    }
  });
});

describe("C16: the registrations list follows check-ins", () => {
  it("a refused check-in changes nothing in the list; a check-in changes only that item", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { capacity: 2 });
    const a = await ticket({ eventId, name: "List A" });
    const b = await ticket({ eventId, name: "List B" });
    const waiting = await ticket({ eventId, status: "waitlisted" });
    const gone = await ticket({ eventId, status: "cancelled" });
    const foreign = await ticket({ organizerId: other.id });
    const first = await list(eventId);
    expect(first.status, first.text).toBe(200);

    expectError(await checkIn(waiting.code), 409, "waitlisted");
    expectError(await checkIn(gone.code), 409, "registration_cancelled");
    expectError(await checkIn(foreign.code), 404, "not_found");
    expectError(await checkIn("ZZZZZZZZZZ"), 404, "not_found");
    expectError(await checkIn("not a code"), 400, "invalid_input");
    expect((await list(eventId)).body).toEqual(first.body);

    const done = asCheckedIn(await checkIn(a.code));
    const items = (first.body as { registrations: { id: string; checked_in_at: string | null }[] }).registrations;
    const expected = {
      registrations: items.map((item) => (item.id === a.id ? { ...item, checked_in_at: done.checked_in_at } : item)),
    };
    expect((await list(eventId)).body).toEqual(expected);

    expectAlready(await checkIn(a.code), done.checked_in_at, "List A");
    expect((await list(eventId)).body).toEqual(expected);

    await cancelEventInDb(db.pool, eventId);
    expectError(await checkIn(b.code), 409, "event_cancelled");
    expect((await list(eventId)).body).toEqual(expected);
  });
});
