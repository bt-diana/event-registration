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

// GET /events/:id/registrations/:registrationId/emails, the emails of one
// attendee of an own event (email-reminders.md ER48-ER60, D74). Written before
// the route: ER48-ER54 and ER56 are the tests first.

const OBJECT_KEYS = ["attendee_name", "emails"];
const ITEM_KEYS = ["id", "kind", "status", "to_email", "subject", "created_at", "sent_at", "send_attempts", "send_error"];
const KINDS: OutboxKind[] = ["ticket", "promotion", "reminder", "reschedule", "event_cancelled"];
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

type Item = {
  id: string;
  kind: string;
  status: string;
  to_email: string;
  subject: string;
  created_at: string;
  sent_at: string | null;
  send_attempts: number;
  send_error: string | null;
};
type Answer = { attendee_name: string; emails: Item[] };

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

function path(eventId: string, registrationId: string, query = ""): string {
  return `/events/${eventId}/registrations/${registrationId}/emails${query}`;
}

// `null` sends no cookie at all.
function read(eventId: string, registrationId: string, query = "", cookie: string | null = owner.cookie): Promise<Reply> {
  return call(api, "GET", path(eventId, registrationId, query), { cookie: cookie ?? undefined });
}

// 200 with exactly the two keys and exactly the item keys in each item (ER50).
async function emailsOf(eventId: string, registrationId: string, query = "", cookie: string = owner.cookie): Promise<Answer> {
  const reply = await read(eventId, registrationId, query, cookie);
  expect(reply.status, reply.text).toBe(200);
  expect(Object.keys(reply.body as object), reply.text).toEqual(OBJECT_KEYS);
  const body = reply.body as Answer;
  expect(Array.isArray(body.emails), reply.text).toBe(true);
  for (const item of body.emails) expect(Object.keys(item), reply.text).toEqual(ITEM_KEYS);
  return body;
}

function expectError(reply: Reply, status: number, error: string): void {
  expect(reply.status, reply.text).toBe(status);
  expect(reply.body, reply.text).toEqual({ error });
}

// Status, text and headers apart from `date`, to compare 404 answers (ER49).
async function raw(urlPath: string, cookie: string = owner.cookie) {
  const res = await fetch(`${api.url}${urlPath}`, { headers: { cookie } });
  const headers = [...res.headers.entries()].filter(([name]) => name !== "date");
  return { status: res.status, text: await res.text(), headers };
}

async function person(name = "Ana Lopez"): Promise<Person> {
  const email = uniqueEmail(name.toLowerCase().replace(/\s+/g, "-"));
  const { rows } = await db.pool.query<{ id: string }>(
    `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, 'hash') RETURNING id`,
    [email, name],
  );
  return { id: rows[0].id, email, name };
}

async function seat(
  eventId: string,
  status: "registered" | "waitlisted" | "cancelled" = "registered",
  name?: string,
  who?: Person,
): Promise<Seat> {
  const p = who ?? (await person(name));
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

async function snapshot(): Promise<Record<string, unknown[]>> {
  const result: Record<string, unknown[]> = {};
  for (const table of ["outbox", "registrations", "events", "users", "organizers"]) {
    result[table] = (await db.pool.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
  }
  return result;
}

describe("ER48: guards (tests first)", () => {
  it("answers 401 without a valid login and 403 to an attendee, also for malformed ids, without a query", async () => {
    const eventId = await insertEvent(db.pool, owner.id);
    const s = await seat(eventId);
    await email(s);
    const guest = await attendee(db.pool);
    await insertRegistration(db.pool, eventId, guest.id);
    const expired = await mintSessionCookie("organizer", owner.id, Date.now() - 8 * DAY);
    const eventIds = [eventId, UNKNOWN_ID, ...MALFORMED_IDS.map(encodeURIComponent)];
    const registrationIds = [s.id, UNKNOWN_ID, ...MALFORMED_IDS.map(encodeURIComponent)];
    await withoutQueries(async () => {
      for (const id of eventIds) {
        for (const registrationId of registrationIds) {
          for (const cookie of [null, "session=garbage", expired]) {
            expectError(await read(id, registrationId, "", cookie), 401, "not_logged_in");
          }
          expectError(await read(id, registrationId, "", guest.cookie), 403, "wrong_role");
        }
      }
    });
  });
});

describe("ER49: one 404 body for every not-found case (tests first)", () => {
  it("answers the same 404 for unknown, malformed, foreign and other-event ids and leaks nothing", async () => {
    const eventId = await insertEvent(db.pool, owner.id);
    const mine = await seat(eventId, "registered", "Own Guest");
    await email(mine);
    const sibling = await insertEvent(db.pool, owner.id, { title: "Sibling Secret Night" });
    const siblingSeat = await seat(sibling, "registered", "Sibling Guest");
    await email(siblingSeat, { kind: "reminder", subject: "Reminder: Sibling Secret Night starts soon" });
    const foreign = await insertEvent(db.pool, other.id, { title: "Foreign Secret Gala" });
    const foreignSeat = await seat(foreign, "registered", "Foreign Guest");
    await email(foreignSeat, { kind: "reminder", subject: "Reminder: Foreign Secret Gala starts soon" });

    const reference = await raw(path(UNKNOWN_ID, mine.id));
    expect(reference.status).toBe(404);
    expect(reference.text).toBe('{"error":"not_found"}');
    expect(reference.headers).toContainEqual(["cache-control", "no-store"]);

    const cases = [
      path(UNKNOWN_ID, UNKNOWN_ID),
      path(foreign, foreignSeat.id),
      path(foreign, mine.id),
      path(eventId, UNKNOWN_ID),
      path(eventId, siblingSeat.id),
      path(sibling, mine.id),
      path(eventId, foreignSeat.id),
      path(eventId, "me"),
      ...MALFORMED_IDS.map((bad) => path(encodeURIComponent(bad), mine.id)),
      ...MALFORMED_IDS.map((bad) => path(eventId, encodeURIComponent(bad))),
    ];
    for (const urlPath of cases) {
      const reply = await raw(urlPath);
      expect(reply, urlPath).toEqual(reference);
      for (const hidden of [
        "Foreign Secret Gala",
        "Sibling Secret Night",
        "Foreign Guest",
        "Sibling Guest",
        foreignSeat.person.email,
        siblingSeat.person.email,
        foreignSeat.ticketCode,
        siblingSeat.ticketCode,
      ]) {
        expect(reply.text, urlPath).not.toContain(hidden);
      }
    }
    // The owners still read them.
    expect((await emailsOf(foreign, foreignSeat.id, "", other.cookie)).emails).toHaveLength(1);
    expect((await emailsOf(sibling, siblingSeat.id)).emails).toHaveLength(1);
  });

  it("answers 404 for a malformed event or registration id before any query", async () => {
    const eventId = await insertEvent(db.pool, owner.id);
    const s = await seat(eventId);
    await withoutQueries(async () => {
      for (const bad of MALFORMED_IDS.map(encodeURIComponent)) {
        expectError(await read(bad, s.id), 404, "not_found");
        expectError(await read(eventId, bad), 404, "not_found");
        expectError(await read(bad, bad), 404, "not_found");
      }
      expectError(await read(eventId, "me"), 404, "not_found");
    });
  });
});

describe("ER50 and ER51: the shape, never the body or the ticket code (tests first)", () => {
  it("answers exactly the two keys and the nine item keys with the right types", async () => {
    const eventId = await insertEvent(db.pool, owner.id);
    const s = await seat(eventId, "registered", "Ana Lopez");
    const sentId = await email(s, {
      kind: "ticket",
      status: "sent",
      subject: "Your ticket for Spring Meetup",
      createdAt: new Date("2030-01-01T09:00:00.000Z"),
    });
    const pendingId = await email(s, { kind: "reminder", createdAt: new Date("2030-01-02T09:00:00.000Z") });

    const body = await emailsOf(eventId, s.id);
    expect(body.attendee_name).toBe("Ana Lopez");
    expect(body.emails.map((e) => e.id)).toEqual([pendingId, sentId]);
    const [pending, sent] = body.emails;
    expect(sent).toEqual({
      id: sentId,
      kind: "ticket",
      status: "sent",
      to_email: s.person.email,
      subject: "Your ticket for Spring Meetup",
      created_at: "2030-01-01T09:00:00.000Z",
      sent_at: "2030-01-01T09:00:10.000Z",
      send_attempts: 0,
      send_error: null,
    });
    expect(pending).toMatchObject({ kind: "reminder", status: "pending", sent_at: null, send_attempts: 0, send_error: null });
    for (const item of body.emails) {
      for (const key of ["id", "kind", "status", "to_email", "subject"] as const) expect(typeof item[key]).toBe("string");
      expect(item.created_at).toMatch(ISO_UTC);
      expect(typeof item.send_attempts).toBe("number");
    }
  });

  it("shows the current users.name and the stored to_email", async () => {
    const eventId = await insertEvent(db.pool, owner.id);
    const s = await seat(eventId, "registered", "Old Name");
    await email(s);
    await db.pool.query("UPDATE users SET email = $2, name = 'New Name' WHERE id = $1", [s.person.id, uniqueEmail("new")]);
    const body = await emailsOf(eventId, s.id);
    expect(body.attendee_name).toBe("New Name");
    expect(body.emails[0].to_email).toBe(s.person.email);
  });

  it("never holds the body, the ticket code or the hidden columns", async () => {
    const eventId = await insertEvent(db.pool, owner.id);
    const s = await seat(eventId);
    await email(s, { kind: "ticket", body: `Your seat\nTicket code: ${s.ticketCode}` });
    await email(s, { kind: "reminder", body: `Reminder\nTicket code: ${s.ticketCode}` });

    const reply = await read(eventId, s.id);
    expect(reply.status, reply.text).toBe(200);
    expect(reply.text).not.toContain(s.ticketCode);
    expect(reply.text).not.toContain("Ticket code");
    for (const key of [
      "body",
      "html",
      "attachments",
      "ticket_code",
      "registration_id",
      "schedule_version",
      "event_starts_at",
      "user_id",
      "organizer_id",
      "event_id",
    ]) {
      expect(reply.text).not.toContain(`"${key}"`);
    }
  });
});

describe("ER52: only that registration's emails (tests first)", () => {
  it("returns only the rows of the asked registration", async () => {
    const eventId = await insertEvent(db.pool, owner.id);
    const ana = await seat(eventId, "registered", "Ana");
    const ben = await seat(eventId, "registered", "Ben");
    const sibling = await insertEvent(db.pool, owner.id);
    const siblingSeat = await seat(sibling, "registered", "Sib");
    const foreign = await insertEvent(db.pool, other.id);
    const foreignSeat = await seat(foreign, "registered", "For");
    const anaIds: string[] = [];
    for (const kind of KINDS) anaIds.push(await email(ana, { kind }));
    for (const s of [ben, siblingSeat, foreignSeat]) for (const kind of KINDS) await email(s, { kind });

    const body = await emailsOf(eventId, ana.id);
    expect(body.attendee_name).toBe("Ana");
    expect(body.emails.map((e) => e.id).sort()).toEqual([...anaIds].sort());
    // Upper case is the same uuid.
    expect((await emailsOf(eventId.toUpperCase(), ana.id.toUpperCase())).emails.map((e) => e.id).sort()).toEqual(
      [...anaIds].sort(),
    );
  });

  it("keeps the rows of an old registration apart from the new one after a cancel and a new registration", async () => {
    const eventId = await insertEvent(db.pool, owner.id);
    const who = await person("Again");
    const old = await seat(eventId, "cancelled", undefined, who);
    const fresh = await seat(eventId, "registered", undefined, who);
    const oldTicket = await email(old, { kind: "ticket", scheduleVersion: 1 });
    const freshTicket = await email(fresh, { kind: "ticket", scheduleVersion: 1 });

    expect((await emailsOf(eventId, fresh.id)).emails.map((e) => e.id)).toEqual([freshTicket]);
    expect((await emailsOf(eventId, old.id)).emails.map((e) => e.id)).toEqual([oldTicket]);
  });
});

describe("ER53: newest first, then id (tests first)", () => {
  it("orders by created_at descending and id ascending, the same on every read", async () => {
    const eventId = await insertEvent(db.pool, owner.id);
    const s = await seat(eventId);
    const same = new Date("2030-01-01T10:00:00.000Z");
    const made = [
      { id: await email(s, { createdAt: new Date("2030-01-01T09:00:00.000Z") }), at: "2030-01-01T09:00:00.000Z" },
      { id: await email(s, { createdAt: same }), at: same.toISOString() },
      { id: await email(s, { createdAt: new Date("2030-01-01T11:00:00.000Z") }), at: "2030-01-01T11:00:00.000Z" },
      { id: await email(s, { createdAt: same }), at: same.toISOString() },
      { id: await email(s, { createdAt: same }), at: same.toISOString() },
    ];
    const expected = [...made]
      .sort((a, b) => (a.at === b.at ? (a.id < b.id ? -1 : 1) : a.at < b.at ? 1 : -1))
      .map((m) => m.id);
    expect((await emailsOf(eventId, s.id)).emails.map((e) => e.id)).toEqual(expected);
    expect((await emailsOf(eventId, s.id)).emails.map((e) => e.id)).toEqual(expected);
  });
});

describe("ER54: statuses as stored (tests first)", () => {
  it("shows pending, retrying, sent and error_sending rows with their counters", async () => {
    const eventId = await insertEvent(db.pool, owner.id);
    const s = await seat(eventId);
    const fresh = await email(s);
    const once = await email(s, { sendAttempts: 1, sendError: "resend application_error: boom" });
    const twice = await email(s, { sendAttempts: 2, sendError: "resend rate_limit_exceeded: slow down" });
    const sent = await email(s, { status: "sent" });
    const failed = await email(s, { status: "error_sending", sendAttempts: 3, sendError: "resend validation_error: [address]" });

    const byId = new Map((await emailsOf(eventId, s.id)).emails.map((e) => [e.id, e]));
    expect(byId.size).toBe(5);
    expect(byId.get(fresh)).toMatchObject({ status: "pending", send_attempts: 0, send_error: null, sent_at: null });
    expect(byId.get(once)).toMatchObject({
      status: "pending",
      send_attempts: 1,
      send_error: "resend application_error: boom",
      sent_at: null,
    });
    expect(byId.get(twice)).toMatchObject({
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

describe("ER55: any registration status, any event status, every kind", () => {
  it("returns the emails of waiting, cancelled and checked-in registrations", async () => {
    const eventId = await insertEvent(db.pool, owner.id);
    const waiting = await seat(eventId, "waitlisted", "Wait");
    const cancelled = await seat(eventId, "cancelled", "Gone");
    const here = await seat(eventId, "registered", "Here");
    await db.pool.query("UPDATE registrations SET checked_in_at = now() WHERE id = $1", [here.id]);
    for (const s of [waiting, cancelled, here]) {
      await email(s, { kind: "ticket" });
      await email(s, { kind: s === cancelled ? "event_cancelled" : "promotion" });
    }
    for (const s of [waiting, cancelled, here]) {
      const body = await emailsOf(eventId, s.id);
      expect(body.attendee_name, s.person.name).toBe(s.person.name);
      expect(body.emails, s.person.name).toHaveLength(2);
    }
  });

  it("answers 200 for a cancelled and a passed event, with all five kinds", async () => {
    const cancelled = await insertEvent(db.pool, owner.id, { status: "cancelled" });
    const s = await seat(cancelled, "cancelled");
    for (const kind of KINDS) await email(s, { kind });
    const body = await emailsOf(cancelled, s.id);
    expect(new Set(body.emails.map((e) => e.kind))).toEqual(new Set(KINDS));

    const passed = await insertEvent(db.pool, owner.id, { startsAt: new Date(Date.now() - 3 * DAY), durationMinutes: 60 });
    const p = await seat(passed);
    await email(p, { kind: "reminder", status: "sent" });
    expect((await emailsOf(passed, p.id)).emails).toHaveLength(1);
  });
});

describe("ER56: no emails (tests first)", () => {
  it("answers 200 with the name and an empty array", async () => {
    const eventId = await insertEvent(db.pool, owner.id);
    const s = await seat(eventId, "registered", "Quiet One");
    const reply = await read(eventId, s.id);
    expect(reply.status, reply.text).toBe(200);
    expect(reply.text).toBe('{"attendee_name":"Quiet One","emails":[]}');
  });
});

describe("ER57: no paging, no cap, no query parameters", () => {
  it("returns all 25 rows and ignores any query string", async () => {
    const eventId = await insertEvent(db.pool, owner.id);
    const s = await seat(eventId);
    await db.pool.query(
      `INSERT INTO outbox (registration_id, kind, schedule_version, event_starts_at, to_email, subject, body, created_at)
       SELECT $1, 'reminder', v, now(), $2, 'Reminder ' || v, 'Body', timestamptz '2030-01-01 00:00:00+00' + v * interval '1 second'
         FROM generate_series(1, 25) AS v`,
      [s.id, s.person.email],
    );
    const plain = await read(eventId, s.id);
    expect(plain.status, plain.text).toBe(200);
    expect((plain.body as Answer).emails).toHaveLength(25);
    for (const query of ["?limit=1", "?kind=x", "?status=sent&page=2", "?registration_id=abc", "?limit=1&limit=2"]) {
      expect((await read(eventId, s.id, query)).text, query).toBe(plain.text);
    }
  });
});

describe("ER58: read only, one statement", () => {
  it("runs one statement without a lock or a transaction and changes no row", async () => {
    const eventId = await insertEvent(db.pool, owner.id);
    const s = await seat(eventId);
    await email(s);
    await email(s, { kind: "reminder", status: "error_sending", sendAttempts: 3, sendError: "x" });
    const before = await snapshot();
    const query = vi.spyOn(db.pool, "query");
    const connect = vi.spyOn(db.pool, "connect");
    try {
      await emailsOf(eventId, s.id);
      const sql = statements(query);
      expect(sql).toHaveLength(1);
      expect(sql[0]).not.toMatch(/\b(INSERT|UPDATE|DELETE|FOR UPDATE|FOR SHARE|BEGIN)\b/i);
      expect(connect).not.toHaveBeenCalled();
    } finally {
      query.mockRestore();
      connect.mockRestore();
    }
    expect(await snapshot()).toEqual(before);
  });
});

describe("ER59: no-store, and fresh on every read", () => {
  it("sends Cache-Control: no-store on 200 and on every 404", async () => {
    const eventId = await insertEvent(db.pool, owner.id);
    const s = await seat(eventId);
    for (const urlPath of [path(eventId, s.id), path(UNKNOWN_ID, s.id), path(eventId, UNKNOWN_ID), path("abc", s.id), path(eventId, "abc")]) {
      const res = await fetch(`${api.url}${urlPath}`, { headers: { cookie: owner.cookie } });
      await res.text();
      expect(res.headers.get("cache-control"), urlPath).toBe("no-store");
    }
  });

  it("shows a status change made between two reads", async () => {
    const eventId = await insertEvent(db.pool, owner.id);
    const s = await seat(eventId);
    const id = await email(s);
    expect((await emailsOf(eventId, s.id)).emails[0]).toMatchObject({ id, status: "pending", sent_at: null });
    await db.pool.query("UPDATE outbox SET status = 'sent', sent_at = now() WHERE id = $1", [id]);
    const [item] = (await emailsOf(eventId, s.id)).emails;
    expect(item.status).toBe("sent");
    expect(item.sent_at).toMatch(ISO_UTC);
  });
});

describe("ER60: errors are { error } only", () => {
  it("answers each error with exactly one key and never a 400", async () => {
    const eventId = await insertEvent(db.pool, owner.id);
    const s = await seat(eventId);
    const guest = await attendee(db.pool);
    for (const [reply, status, code] of [
      [await read(eventId, s.id, "", null), 401, "not_logged_in"],
      [await read(eventId, s.id, "", guest.cookie), 403, "wrong_role"],
      [await read(eventId, "abc", "?kind=bad"), 404, "not_found"],
    ] as const) {
      expectError(reply, status, code);
      expect(Object.keys(reply.body as object)).toEqual(["error"]);
    }
    expect((await read(eventId, s.id, "?kind=bad&status=bad")).status).toBe(200);
  });
});
