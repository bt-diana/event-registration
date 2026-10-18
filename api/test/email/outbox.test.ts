import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mintSessionCookie, type Running } from "../auth/helpers.js";
import {
  createTestDb,
  insertEvent,
  insertOutbox,
  insertRegistration,
  uniqueEmail,
  type OutboxKind,
  type OutboxStatus,
  type TestDb,
} from "../db/helpers.js";
import { attendee, call, DAY, MALFORMED_IDS, organizer, startApi, UNKNOWN_ID, type Account, type Reply } from "../events/helpers.js";

// GET /events/:id/emails, the organizer's list of the emails of an own event
// (email-outbox.md OB1-OB18, D60, D61, D62). Written before the route: OB1-OB10,
// OB16 and OB17 are the tests first.

const OBJECT_KEYS = ["emails", "truncated"];
const ITEM_KEYS = [
  "id",
  "registration_id",
  "kind",
  "status",
  "send_attempts",
  "send_error",
  "to_email",
  "subject",
  "schedule_version",
  "event_starts_at",
  "created_at",
  "sent_at",
  "attendee_name",
];
const KINDS: OutboxKind[] = ["ticket", "promotion", "reminder", "reschedule", "event_cancelled"];
const EMPTY = '{"emails":[],"truncated":false}';

type Item = {
  id: string;
  registration_id: string;
  kind: string;
  status: string;
  send_attempts: number;
  send_error: string | null;
  to_email: string;
  subject: string;
  schedule_version: number;
  event_starts_at: string;
  created_at: string;
  sent_at: string | null;
  attendee_name: string;
};

type Person = { id: string; email: string; name: string };
type Seat = { id: string; ticketCode: string; person: Person };

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

// `null` sends no cookie at all.
function read(eventId: string, query = "", cookie: string | null = owner.cookie): Promise<Reply> {
  return call(api, "GET", `/events/${eventId}/emails${query}`, { cookie: cookie ?? undefined });
}

// 200 with exactly the two keys and exactly the item keys in each item.
async function list(eventId: string, query = "", cookie: string = owner.cookie): Promise<{ emails: Item[]; truncated: boolean }> {
  const reply = await read(eventId, query, cookie);
  expect(reply.status, reply.text).toBe(200);
  expect(Object.keys(reply.body as object), reply.text).toEqual(OBJECT_KEYS);
  const body = reply.body as { emails: Item[]; truncated: boolean };
  expect(typeof body.truncated).toBe("boolean");
  for (const item of body.emails) expect(Object.keys(item), reply.text).toEqual(ITEM_KEYS);
  return body;
}

function expectError(reply: Reply, status: number, error: string): void {
  expect(reply, reply.text).toMatchObject({ status, body: { error } });
  expect(Object.keys(reply.body as object), reply.text).toEqual(["error"]);
}

async function person(name = "Ana Lopez"): Promise<Person> {
  const email = uniqueEmail(name.toLowerCase().replace(/\s+/g, "-"));
  const { rows } = await db.pool.query<{ id: string }>(
    `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, 'hash') RETURNING id`,
    [email, name],
  );
  return { id: rows[0].id, email, name };
}

async function seat(eventId: string, status: "registered" | "waitlisted" | "cancelled" = "registered", name?: string): Promise<Seat> {
  const p = await person(name);
  const { id, ticketCode } = await insertRegistration(db.pool, eventId, p.id, status);
  return { id, ticketCode, person: p };
}

let version = 100;

// An email of a seat; a fresh schedule version keeps the unique key free.
async function email(
  s: Seat,
  options: {
    kind?: OutboxKind;
    status?: OutboxStatus;
    createdAt?: Date;
    sendAttempts?: number;
    sendError?: string;
    subject?: string;
    body?: string;
    scheduleVersion?: number;
  } = {},
): Promise<string> {
  version += 1;
  const status = options.status;
  return insertOutbox(db.pool, s.id, {
    kind: options.kind ?? "ticket",
    scheduleVersion: options.scheduleVersion ?? version,
    toEmail: s.person.email,
    subject: options.subject ?? `Subject ${version}`,
    body: options.body ?? `Body ${version}\nTicket code: ${s.ticketCode}`,
    createdAt: options.createdAt,
    status,
    sentAt: status === "sent" ? new Date("2030-01-01T09:00:10.000Z") : undefined,
    sendAttempts: options.sendAttempts,
    sendError: options.sendError,
  });
}

// Raw SQL text of each pool.query call recorded by a spy.
function statements(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls.map(([text]) => (typeof text === "string" ? text : (text as { text: string }).text));
}

async function withoutQueries(run: () => Promise<void>): Promise<void> {
  const query = vi.spyOn(db.pool, "query");
  const connect = vi.spyOn(db.pool, "connect");
  try {
    await run();
    expect(statements(query)).toEqual([]);
    expect(connect).not.toHaveBeenCalled();
  } finally {
    query.mockRestore();
    connect.mockRestore();
  }
}

describe("OB1: guards (tests first)", () => {
  it("answers 401 without a valid login and 403 to an attendee, before any check and without a query", async () => {
    const eventId = await insertEvent(db.pool, owner.id);
    const s = await seat(eventId);
    await email(s);
    const person = await attendee(db.pool);
    await insertRegistration(db.pool, eventId, person.id);
    const expired = await mintSessionCookie("organizer", owner.id, Date.now() - 8 * DAY);
    await withoutQueries(async () => {
      for (const id of [eventId, UNKNOWN_ID, ...MALFORMED_IDS.map(encodeURIComponent)]) {
        for (const query of ["", "?kind=bad", "?status=bad", "?registration_id=bad", `?registration_id=${s.id}`]) {
          for (const cookie of [null, "session=garbage", expired]) {
            expectError(await read(id, query, cookie), 401, "not_logged_in");
          }
          expectError(await read(id, query, person.cookie), 403, "wrong_role");
        }
      }
    });
  });
});

describe("OB2: unknown, malformed and foreign events answer the same 404 (tests first)", () => {
  it("answers one 404 body for unknown and foreign events, also with a valid filter, and leaks nothing", async () => {
    const foreign = await insertEvent(db.pool, other.id, { title: "Foreign Secret Gala" });
    const guest = await seat(foreign, "registered", "Foreign Guest");
    await email(guest, { kind: "reminder", subject: "Reminder: Foreign Secret Gala starts soon" });

    const unknown = await read(UNKNOWN_ID);
    expectError(unknown, 404, "not_found");
    for (const query of ["", "?kind=reminder", "?status=pending", `?registration_id=${guest.id}`, "?kind=ticket&status=sent"]) {
      const notMine = await read(foreign, query);
      expectError(notMine, 404, "not_found");
      expect(notMine.text).toBe(unknown.text);
      for (const hidden of ["Foreign Secret Gala", guest.person.email, "Foreign Guest", guest.ticketCode, guest.id]) {
        expect(notMine.text).not.toContain(hidden);
      }
    }
    // The owner still reads it.
    expect((await list(foreign, "", other.cookie)).emails).toHaveLength(1);
  });

  it("answers 404 for an id that is not a uuid, before any query, also with a bad filter", async () => {
    const unknown = await read(UNKNOWN_ID);
    await withoutQueries(async () => {
      for (const id of MALFORMED_IDS) {
        for (const query of ["", "?kind=bad", "?status=bad", "?registration_id=bad"]) {
          const reply = await read(encodeURIComponent(id), query);
          expectError(reply, 404, "not_found");
          expect(reply.text, id).toBe(unknown.text);
        }
      }
    });
  });
});

describe("OB3 and OB4: the shape, and never the body or the ticket code (tests first)", () => {
  it("answers exactly the listed keys with the right types", async () => {
    const startsAt = new Date("2030-03-01T18:00:00.000Z");
    const eventId = await insertEvent(db.pool, owner.id, { startsAt });
    const s = await seat(eventId, "registered", "Ana Lopez");
    const sentId = await email(s, { kind: "ticket", status: "sent", scheduleVersion: 1 });
    const failedId = await email(s, {
      kind: "reminder",
      status: "error_sending",
      sendAttempts: 3,
      sendError: "resend validation_error: no",
      scheduleVersion: 2,
    });
    await db.pool.query("UPDATE outbox SET event_starts_at = $2 WHERE registration_id = $1", [s.id, startsAt]);

    const { emails, truncated } = await list(eventId);
    expect(truncated).toBe(false);
    const sent = emails.find((e) => e.id === sentId)!;
    const failed = emails.find((e) => e.id === failedId)!;
    expect(sent).toMatchObject({
      registration_id: s.id,
      kind: "ticket",
      status: "sent",
      send_attempts: 0,
      send_error: null,
      to_email: s.person.email,
      schedule_version: 1,
      event_starts_at: startsAt.toISOString(),
      sent_at: "2030-01-01T09:00:10.000Z",
      attendee_name: "Ana Lopez",
    });
    expect(failed).toMatchObject({ status: "error_sending", send_attempts: 3, send_error: "resend validation_error: no", sent_at: null });
    for (const item of emails) {
      expect(new Date(item.created_at).toISOString()).toBe(item.created_at);
      expect(typeof item.subject).toBe("string");
      expect(typeof item.schedule_version).toBe("number");
    }
  });

  it("never holds the body or the ticket code", async () => {
    const eventId = await insertEvent(db.pool, owner.id);
    const s = await seat(eventId);
    await email(s, { kind: "ticket", body: `Your seat\nTicket code: ${s.ticketCode}` });
    await email(s, { kind: "reminder", body: `Reminder\nTicket code: ${s.ticketCode}` });

    const reply = await read(eventId);
    expect(reply.status).toBe(200);
    expect(reply.text).not.toContain(s.ticketCode);
    expect(reply.text).not.toContain("Ticket code");
    for (const key of ["body", "ticket_code", "user_id", "organizer_id", "event_id", "password_hash"]) {
      expect(reply.text).not.toContain(`"${key}"`);
    }
  });
});

describe("OB5: all kinds and statuses of this event only (tests first)", () => {
  it("returns every kind and status, also of waiting and cancelled registrations, and no other event's rows", async () => {
    const eventId = await insertEvent(db.pool, owner.id);
    const seated = await seat(eventId);
    const waiting = await seat(eventId, "waitlisted");
    const gone = await seat(eventId, "cancelled");
    const mine: string[] = [];
    for (const kind of KINDS) mine.push(await email(seated, { kind }));
    mine.push(await email(seated, { kind: "reminder", status: "sent" }));
    mine.push(await email(seated, { kind: "reminder", status: "error_sending", sendAttempts: 3, sendError: "x" }));
    mine.push(await email(waiting, { kind: "promotion" }));
    mine.push(await email(gone, { kind: "event_cancelled" }));

    const sibling = await insertEvent(db.pool, owner.id);
    await email(await seat(sibling), { kind: "reminder" });
    const foreign = await insertEvent(db.pool, other.id);
    await email(await seat(foreign), { kind: "reminder" });

    const { emails } = await list(eventId);
    expect(emails.map((e) => e.id).sort()).toEqual(mine.sort());
    expect(new Set(emails.map((e) => e.kind))).toEqual(new Set(KINDS));
    expect(new Set(emails.map((e) => e.status))).toEqual(new Set(["pending", "sent", "error_sending"]));
  });
});

describe("OB6: newest first, then id (tests first)", () => {
  it("orders by created_at descending and id ascending", async () => {
    const eventId = await insertEvent(db.pool, owner.id);
    const s = await seat(eventId);
    const same = new Date("2030-01-01T10:00:00.000Z");
    const made = [
      { id: await email(s, { createdAt: new Date("2030-01-01T09:00:00.000Z") }), at: "2030-01-01T09:00:00.000Z" },
      { id: await email(s, { createdAt: same }), at: same.toISOString() },
      { id: await email(s, { createdAt: new Date("2030-01-01T11:00:00.000Z") }), at: "2030-01-01T11:00:00.000Z" },
      { id: await email(s, { createdAt: same }), at: same.toISOString() },
    ];
    const expected = [...made].sort((a, b) => (a.at === b.at ? (a.id < b.id ? -1 : 1) : a.at < b.at ? 1 : -1));
    const first = await list(eventId);
    expect(first.emails.map((e) => e.id)).toEqual(expected.map((m) => m.id));
    expect((await list(eventId)).emails.map((e) => e.id)).toEqual(expected.map((m) => m.id));
  });
});

describe("OB7 and OB8: the kind and status filters (tests first)", () => {
  async function mixed() {
    const eventId = await insertEvent(db.pool, owner.id);
    const s = await seat(eventId);
    const ids: Record<string, string> = {};
    ids.ticketSent = await email(s, { kind: "ticket", status: "sent" });
    ids.reminderPending = await email(s, { kind: "reminder" });
    ids.reminderSent = await email(s, { kind: "reminder", status: "sent" });
    ids.reminderFailed = await email(s, { kind: "reminder", status: "error_sending", sendAttempts: 3, sendError: "x" });
    ids.promotionPending = await email(s, { kind: "promotion" });
    return { eventId, ids };
  }

  it("filters by kind, by status and by both", async () => {
    const { eventId, ids } = await mixed();
    const got = async (query: string) => (await list(eventId, query)).emails.map((e) => e.id).sort();
    expect(await got("?kind=reminder")).toEqual([ids.reminderPending, ids.reminderSent, ids.reminderFailed].sort());
    expect(await got("?status=sent")).toEqual([ids.ticketSent, ids.reminderSent].sort());
    expect(await got("?kind=reminder&status=error_sending")).toEqual([ids.reminderFailed]);
    expect(await got("?kind=reschedule")).toEqual([]);
    expect((await read(eventId, "?kind=promotion&status=sent")).text).toBe(EMPTY);
    // Other parameters are ignored.
    expect(await got("?kind=reminder&limit=1&page=2&foo=bar")).toEqual(
      [ids.reminderPending, ids.reminderSent, ids.reminderFailed].sort(),
    );
  });

  it("answers 400 invalid_kind and invalid_status for a bad value, without a query", async () => {
    const { eventId } = await mixed();
    await withoutQueries(async () => {
      for (const query of ["?kind=bad", "?kind=", "?kind=Reminder", "?kind=reminder&kind=ticket", "?kind=%20reminder"]) {
        expectError(await read(eventId, query), 400, "invalid_kind");
      }
      for (const query of ["?status=bad", "?status=", "?status=SENT", "?status=sent&status=pending"]) {
        expectError(await read(eventId, query), 400, "invalid_status");
      }
    });
  });

  it("checks the id first, then kind, then status, then registration_id, and the ownership last", async () => {
    const { eventId } = await mixed();
    const foreign = await insertEvent(db.pool, other.id);
    await withoutQueries(async () => {
      expectError(await read("abc", "?kind=bad&status=bad"), 404, "not_found");
      expectError(await read(eventId, "?kind=bad&status=bad&registration_id=bad"), 400, "invalid_kind");
      expectError(await read(eventId, "?status=bad&registration_id=bad"), 400, "invalid_status");
      expectError(await read(eventId, "?kind=reminder&registration_id=bad"), 400, "invalid_registration_id");
      // A bad value on a foreign or unknown event says nothing about the event.
      expectError(await read(foreign, "?kind=bad"), 400, "invalid_kind");
      expectError(await read(UNKNOWN_ID, "?status=bad"), 400, "invalid_status");
      expectError(await read(foreign, "?registration_id=bad"), 400, "invalid_registration_id");
    });
  });
});

describe("OB9: statuses as stored (tests first)", () => {
  it("shows pending, retrying, sent and error_sending rows with their counters", async () => {
    const eventId = await insertEvent(db.pool, owner.id);
    const s = await seat(eventId);
    const fresh = await email(s);
    const retrying = await email(s, { sendAttempts: 2, sendError: "resend rate_limit_exceeded: slow down" });
    const sent = await email(s, { status: "sent" });
    const failed = await email(s, { status: "error_sending", sendAttempts: 3, sendError: "resend validation_error: [address]" });

    const byId = new Map((await list(eventId)).emails.map((e) => [e.id, e]));
    expect(byId.get(fresh)).toMatchObject({ status: "pending", send_attempts: 0, send_error: null, sent_at: null });
    expect(byId.get(retrying)).toMatchObject({
      status: "pending",
      send_attempts: 2,
      send_error: "resend rate_limit_exceeded: slow down",
      sent_at: null,
    });
    expect(byId.get(sent)).toMatchObject({ status: "sent", send_attempts: 0, sent_at: "2030-01-01T09:00:10.000Z" });
    expect(byId.get(failed)).toMatchObject({
      status: "error_sending",
      send_attempts: 3,
      send_error: "resend validation_error: [address]",
      sent_at: null,
    });
  });
});

describe("OB10: at most 200 rows, the newest (tests first)", () => {
  // `n` reminder rows of one seat, one per schedule version, a second apart.
  async function many(s: Seat, n: number): Promise<void> {
    await db.pool.query(
      `INSERT INTO outbox (registration_id, kind, schedule_version, event_starts_at, to_email, subject, body, created_at)
       SELECT $1, 'reminder', v, now(), $2, 'Reminder ' || v, 'Body', timestamptz '2030-01-01 00:00:00+00' + v * interval '1 second'
         FROM generate_series(1, $3::int) AS v`,
      [s.id, s.person.email, n],
    );
  }

  it("answers 200 items and truncated true for 201 rows, the newest ones", async () => {
    const eventId = await insertEvent(db.pool, owner.id);
    const s = await seat(eventId);
    await many(s, 201);
    const { emails, truncated } = await list(eventId);
    expect(emails).toHaveLength(200);
    expect(truncated).toBe(true);
    expect(emails[0].schedule_version).toBe(201);
    expect(emails.at(-1)!.schedule_version).toBe(2);
  });

  it("answers truncated false for exactly 200 rows, and applies the cap after the filters", async () => {
    const eventId = await insertEvent(db.pool, owner.id);
    const s = await seat(eventId);
    await many(s, 200);
    expect(await list(eventId)).toMatchObject({ truncated: false });
    expect((await list(eventId)).emails).toHaveLength(200);

    await email(s, { kind: "ticket" });
    expect(await list(eventId)).toMatchObject({ truncated: true });
    const tickets = await list(eventId, "?kind=ticket");
    expect(tickets.emails).toHaveLength(1);
    expect(tickets.truncated).toBe(false);
  });
});

describe("OB11: to_email is the stored copy, attendee_name the current name", () => {
  it("keeps the old address of the row and shows the new name", async () => {
    const eventId = await insertEvent(db.pool, owner.id);
    const s = await seat(eventId, "registered", "Old Name");
    await email(s);
    await db.pool.query("UPDATE users SET email = $2, name = 'New Name' WHERE id = $1", [s.person.id, uniqueEmail("new")]);
    const [item] = (await list(eventId)).emails;
    expect(item.to_email).toBe(s.person.email);
    expect(item.attendee_name).toBe("New Name");
  });
});

describe("OB12: empty, cancelled and passed events", () => {
  it("answers an empty list for an own event with no emails, and rows for cancelled and passed events", async () => {
    const empty = await insertEvent(db.pool, owner.id);
    expect((await read(empty)).text).toBe(EMPTY);

    const cancelled = await insertEvent(db.pool, owner.id, { status: "cancelled" });
    await email(await seat(cancelled), { kind: "event_cancelled" });
    expect((await list(cancelled)).emails).toHaveLength(1);

    const passed = await insertEvent(db.pool, owner.id, { startsAt: new Date(Date.now() - 3 * DAY), durationMinutes: 60 });
    await email(await seat(passed), { kind: "reminder", status: "sent" });
    expect((await list(passed)).emails).toHaveLength(1);
  });
});

describe("OB13: read only, one statement", () => {
  it("runs one statement and changes no row", async () => {
    const eventId = await insertEvent(db.pool, owner.id);
    const s = await seat(eventId);
    await email(s);
    await email(s, { kind: "reminder", status: "error_sending", sendAttempts: 3, sendError: "x" });
    const snapshot = async () => {
      const result: Record<string, unknown[]> = {};
      for (const table of ["outbox", "registrations", "events", "users", "organizers"]) {
        result[table] = (await db.pool.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
      }
      return result;
    };
    const before = await snapshot();
    const query = vi.spyOn(db.pool, "query");
    try {
      await list(eventId, "?kind=reminder&status=error_sending");
      const sql = statements(query);
      expect(sql).toHaveLength(1);
      expect(sql[0]).not.toMatch(/\b(INSERT|UPDATE|DELETE|FOR UPDATE|BEGIN)\b/i);
    } finally {
      query.mockRestore();
    }
    expect(await snapshot()).toEqual(before);
  });
});

describe("OB14: no-store, and fresh on every read", () => {
  it("sends Cache-Control: no-store on 200, 400 and 404", async () => {
    const eventId = await insertEvent(db.pool, owner.id);
    for (const path of [`/events/${eventId}/emails`, `/events/${eventId}/emails?kind=bad`, `/events/${UNKNOWN_ID}/emails`, "/events/abc/emails"]) {
      const res = await fetch(`${api.url}${path}`, { headers: { cookie: owner.cookie } });
      await res.text();
      expect(res.headers.get("cache-control"), path).toBe("no-store");
    }
  });

  it("shows a status change made between two reads", async () => {
    const eventId = await insertEvent(db.pool, owner.id);
    const id = await email(await seat(eventId));
    expect((await list(eventId)).emails[0].status).toBe("pending");
    await db.pool.query("UPDATE outbox SET status = 'sent', sent_at = now() WHERE id = $1", [id]);
    expect((await list(eventId)).emails[0].status).toBe("sent");
  });
});

describe("OB16: one attendee with registration_id (tests first)", () => {
  it("returns only that registration's emails, also combined with kind", async () => {
    const eventId = await insertEvent(db.pool, owner.id);
    const ana = await seat(eventId, "registered", "Ana");
    const ben = await seat(eventId, "registered", "Ben");
    const anaIds = [];
    for (const kind of KINDS) anaIds.push(await email(ana, { kind }));
    for (const kind of KINDS) await email(ben, { kind });

    const { emails } = await list(eventId, `?registration_id=${ana.id}`);
    expect(emails.map((e) => e.id).sort()).toEqual(anaIds.sort());
    expect(emails.every((e) => e.registration_id === ana.id && e.attendee_name === "Ana")).toBe(true);

    const reminders = await list(eventId, `?registration_id=${ana.id}&kind=reminder`);
    expect(reminders.emails.map((e) => e.kind)).toEqual(["reminder"]);
    expect(reminders.emails[0].registration_id).toBe(ana.id);

    // Upper case is the same uuid.
    const upper = await list(eventId, `?registration_id=${ana.id.toUpperCase()}`);
    expect(upper.emails.map((e) => e.id).sort()).toEqual(anaIds.sort());
  });

  it("answers 400 invalid_registration_id for a malformed value, without a query", async () => {
    const eventId = await insertEvent(db.pool, owner.id);
    const s = await seat(eventId);
    await withoutQueries(async () => {
      for (const query of [
        "?registration_id=abc",
        "?registration_id=",
        `?registration_id=${s.id}&registration_id=${s.id}`,
        `?registration_id=${s.id}x`,
        "?registration_id=%27%20OR%20%271%27%3D%271",
      ]) {
        expectError(await read(eventId, query), 400, "invalid_registration_id");
      }
    });
  });
});

describe("OB17: no existence leak for a registration of another event (tests first)", () => {
  async function raw(eventId: string, query: string) {
    const res = await fetch(`${api.url}/events/${eventId}/emails${query}`, { headers: { cookie: owner.cookie } });
    const headers = [...res.headers.entries()].filter(([name]) => name !== "date");
    return { status: res.status, text: await res.text(), headers };
  }

  it("answers the same 200 empty body for unknown, other-event and foreign registration ids", async () => {
    const eventId = await insertEvent(db.pool, owner.id);
    const quiet = await seat(eventId, "registered", "Quiet One");
    const sibling = await insertEvent(db.pool, owner.id);
    const siblingSeat = await seat(sibling, "registered", "Sibling Guest");
    await email(siblingSeat, { kind: "reminder", subject: "Sibling subject" });
    const foreign = await insertEvent(db.pool, other.id);
    const foreignSeat = await seat(foreign, "registered", "Foreign Guest");
    await email(foreignSeat, { kind: "reminder", subject: "Foreign subject" });

    const noEmails = await raw(eventId, `?registration_id=${quiet.id}`);
    expect(noEmails.status).toBe(200);
    expect(noEmails.text).toBe(EMPTY);
    for (const id of [UNKNOWN_ID, siblingSeat.id, foreignSeat.id]) {
      const reply = await raw(eventId, `?registration_id=${id}`);
      expect(reply).toEqual(noEmails);
    }
    // The foreign event itself is still a 404 (OB2).
    expectError(await read(foreign, `?registration_id=${foreignSeat.id}`), 404, "not_found");
  });
});

describe("OB18: any registration status", () => {
  it("returns the emails of registered, waiting, cancelled and checked-in registrations", async () => {
    const eventId = await insertEvent(db.pool, owner.id);
    const registered = await seat(eventId, "registered", "Reg");
    const waiting = await seat(eventId, "waitlisted", "Wait");
    const cancelled = await seat(eventId, "cancelled", "Gone");
    const checkedIn = await seat(eventId, "registered", "Here");
    await db.pool.query("UPDATE registrations SET checked_in_at = now() WHERE id = $1", [checkedIn.id]);
    for (const s of [registered, waiting, cancelled, checkedIn]) {
      await email(s, { kind: "ticket" });
      await email(s, { kind: s === cancelled ? "event_cancelled" : "promotion" });
    }
    for (const s of [registered, waiting, cancelled, checkedIn]) {
      const { emails } = await list(eventId, `?registration_id=${s.id}`);
      expect(emails, s.person.name).toHaveLength(2);
      expect(emails.every((e) => e.registration_id === s.id && e.attendee_name === s.person.name)).toBe(true);
    }
  });
});

