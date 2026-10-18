import * as crypto from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from "vitest";
import { mintSessionCookie, type Running } from "../auth/helpers.js";
import {
  createTestDb,
  insertEvent,
  insertRegistration,
  insertUser,
  uniqueEmail,
  type TestDb,
} from "../db/helpers.js";
import {
  attendee,
  DAY,
  HOUR,
  MALFORMED_IDS,
  MINUTE,
  organizer,
  startApi,
  UNKNOWN_ID,
  type Account,
} from "../events/helpers.js";
import {
  asRegistration,
  cancelEventInDb,
  cancelRegistrationInDb,
  counts,
  outboxRows,
  REGISTRATION_KEYS,
  register,
  registrationRows,
  TICKET_CODE,
} from "./helpers.js";

// POST /events/:id/registrations (registration.md R1-R3, R10-R16, R21).

// The ticket code is made with crypto.randomInt (registration.md section 3).
// The real function is used, unless a test says otherwise (R2 retry).
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, randomInt: vi.fn(actual.randomInt) };
});
const randomInt = vi.mocked(crypto.randomInt) as unknown as MockInstance<(max: number) => number>;
const actualCrypto = await vi.importActual<typeof import("node:crypto")>("node:crypto");
const actualRandomInt = (max: number) => actualCrypto.randomInt(max);

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

afterEach(() => {
  vi.useRealTimers();
});

// Moves the clock of this process (the app runs in it) to `at`. Only Date is faked.
function setNow(at: Date): void {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(at);
}

describe("R1: register for an open event with a free seat", () => {
  it("creates one registered row for the cookie's user and answers 201 with the shape", async () => {
    const person = await attendee(db.pool);
    const eventId = await insertEvent(db.pool, owner.id, { capacity: 3 });

    const reply = await register(api, eventId, person.cookie);
    expect(reply.status, reply.text).toBe(201);
    const answer = asRegistration(reply);
    expect(answer).toMatchObject({
      event_id: eventId,
      status: "registered",
      waitlist_position: null,
      checked_in_at: null,
    });
    expect(new Date(answer.created_at).toISOString()).toBe(answer.created_at);

    const rows = await registrationRows(db.pool, eventId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: answer.id,
      user_id: person.id,
      status: "registered",
      ticket_code: answer.ticket_code,
      cancelled_at: null,
      checked_in_at: null,
    });
  });

  it("ignores the body: user_id, status and ticket_code fields change nothing", async () => {
    const person = await attendee(db.pool);
    const other = await insertUser(db.pool);
    const eventId = await insertEvent(db.pool, owner.id, { capacity: 1 });
    await insertRegistration(db.pool, eventId, await insertUser(db.pool), "registered");

    const reply = await register(api, eventId, person.cookie, {
      user_id: other,
      status: "registered",
      ticket_code: "AAAAAAAAAA",
      event_id: UNKNOWN_ID,
    });
    expect(reply.status, reply.text).toBe(201);
    const answer = asRegistration(reply);
    expect(answer.status).toBe("waitlisted");
    expect(answer.event_id).toBe(eventId);
    expect(answer.ticket_code).not.toBe("AAAAAAAAAA");
    const rows = await registrationRows(db.pool, eventId);
    expect(rows.find((r) => r.id === answer.id)!.user_id).toBe(person.id);
    expect(rows.some((r) => r.user_id === other)).toBe(false);
  });
});

describe("R2: ticket codes", () => {
  it("are 10 characters from A-Z without I and O, and 2-9", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { capacity: 10 });
    for (let i = 0; i < 12; i++) {
      const reply = await register(api, eventId, (await attendee(db.pool)).cookie);
      expect(reply.status, reply.text).toBe(201);
      expect(asRegistration(reply).ticket_code).toMatch(TICKET_CODE);
    }
    const rows = await registrationRows(db.pool, eventId);
    expect(new Set(rows.map((r) => r.ticket_code)).size).toBe(12);
  });

  it("makes another code when the first one is already taken", async () => {
    const taken = "AAAAAAAAAA";
    const eventId = await insertEvent(db.pool, owner.id, { capacity: 5 });
    const holder = await insertRegistration(db.pool, eventId, await insertUser(db.pool), "registered", taken);
    const person = await attendee(db.pool);

    // The first ten draws give "AAAAAAAAAA" (index 0 of the alphabet); then real ones.
    for (let i = 0; i < 10; i++) randomInt.mockReturnValueOnce(0);
    const reply = await register(api, eventId, person.cookie);
    expect(reply.status, reply.text).toBe(201);
    const answer = asRegistration(reply);
    expect(answer.ticket_code).toMatch(TICKET_CODE);
    expect(answer.ticket_code).not.toBe(taken);

    const rows = await registrationRows(db.pool, eventId);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === holder.id)!.ticket_code).toBe(taken);
    const outbox = await outboxRows(db.pool, eventId);
    expect(outbox).toHaveLength(1);
    expect(outbox[0].body).toContain(answer.ticket_code);
  });

  it("gives up with 500 after a few taken codes and writes nothing", async () => {
    const taken = "BBBBBBBBBB";
    const eventId = await insertEvent(db.pool, owner.id, { capacity: 5 });
    await insertRegistration(db.pool, eventId, await insertUser(db.pool), "registered", taken);
    const person = await attendee(db.pool);
    const before = await counts(db.pool);

    // Index 1 of the alphabet is "B": every code is the taken one.
    randomInt.mockReturnValue(1);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const reply = await register(api, eventId, person.cookie);
      expect(reply).toMatchObject({ status: 500, body: { error: "internal" } });
    } finally {
      randomInt.mockImplementation(actualRandomInt);
      errors.mockRestore();
    }
    expect(await counts(db.pool)).toEqual(before);
    expect((await registrationRows(db.pool, eventId)).some((r) => r.user_id === person.id)).toBe(false);
  });
});

describe("R3: the ticket outbox row", () => {
  it("writes one ticket row with the event and account data copied, unsent", async () => {
    const email = uniqueEmail("ticket");
    const userId = await insertUser(db.pool, email);
    const cookie = await mintSessionCookie("user", userId);
    const startsAt = new Date("2031-03-04T05:06:07.890Z");
    const eventId = await insertEvent(db.pool, owner.id, { title: "Spring meetup", startsAt, capacity: 4 });
    await db.pool.query("UPDATE events SET schedule_version = 3 WHERE id = $1", [eventId]);

    const reply = await register(api, eventId, cookie);
    expect(reply.status, reply.text).toBe(201);
    const answer = asRegistration(reply);

    const outbox = await outboxRows(db.pool, eventId);
    expect(outbox).toHaveLength(1);
    const row = outbox[0];
    expect(row).toMatchObject({
      registration_id: answer.id,
      kind: "ticket",
      schedule_version: 3,
      to_email: email,
      sent_at: null,
    });
    expect(row.event_starts_at.toISOString()).toBe(startsAt.toISOString());
    expect(row.subject).toContain("Spring meetup");
    expect(row.body).toContain("Spring meetup");
    expect(row.body).toContain(answer.ticket_code);
  });

  it("writes no outbox row for a waiting registration", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { capacity: 0 });
    const before = await counts(db.pool);
    const reply = await register(api, eventId, (await attendee(db.pool)).cookie);
    expect(reply.status, reply.text).toBe(201);
    expect(asRegistration(reply).status).toBe("waitlisted");
    const after = await counts(db.pool);
    expect(after).toEqual({ registrations: before.registrations + 1, outbox: before.outbox });
  });
});

describe("R10: cancelled and passed events refuse registering", () => {
  it("answers 409 event_cancelled for a cancelled event and writes nothing", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { capacity: 5 });
    await cancelEventInDb(db.pool, eventId);
    const before = await counts(db.pool);
    const reply = await register(api, eventId, (await attendee(db.pool)).cookie);
    expect(reply).toMatchObject({ status: 409, body: { error: "event_cancelled" } });
    expect(await counts(db.pool)).toEqual(before);
  });

  it("answers 409 event_passed once starts_at + duration is reached and writes nothing", async () => {
    const eventId = await insertEvent(db.pool, owner.id, {
      capacity: 5,
      startsAt: new Date(Date.now() - 2 * HOUR),
      durationMinutes: 60,
    });
    const before = await counts(db.pool);
    const reply = await register(api, eventId, (await attendee(db.pool)).cookie);
    expect(reply).toMatchObject({ status: 409, body: { error: "event_passed" } });
    expect(await counts(db.pool)).toEqual(before);
  });

  it("is passed at exactly the end and open one millisecond before", async () => {
    const startsAt = new Date(Date.now() + 2 * DAY);
    const endsAt = new Date(startsAt.getTime() + 30 * MINUTE);
    const eventId = await insertEvent(db.pool, owner.id, { capacity: 5, startsAt, durationMinutes: 30 });
    const late = await attendee(db.pool);
    const justInTime = await attendee(db.pool);

    setNow(endsAt);
    const atEnd = await register(api, eventId, late.cookie);
    vi.useRealTimers();
    expect(atEnd).toMatchObject({ status: 409, body: { error: "event_passed" } });

    setNow(new Date(endsAt.getTime() - 1));
    const before = await register(api, eventId, justInTime.cookie);
    vi.useRealTimers();
    expect(before.status, before.text).toBe(201);
    expect(await registrationRows(db.pool, eventId)).toHaveLength(1);
  });

  it("answers event_cancelled for an event that is both cancelled and passed", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { startsAt: new Date(Date.now() - 2 * DAY) });
    await cancelEventInDb(db.pool, eventId);
    const reply = await register(api, eventId, (await attendee(db.pool)).cookie);
    expect(reply).toMatchObject({ status: 409, body: { error: "event_cancelled" } });
  });

  it("answers 409, not the old ticket, to a repeat request on a closed event", async () => {
    const person = await attendee(db.pool);
    const cancelled = await insertEvent(db.pool, owner.id, { capacity: 5 });
    expect((await register(api, cancelled, person.cookie)).status).toBe(201);
    await cancelEventInDb(db.pool, cancelled);
    const before = await counts(db.pool);
    const reply = await register(api, cancelled, person.cookie);
    expect(reply).toMatchObject({ status: 409, body: { error: "event_cancelled" } });
    expect(reply.text).not.toContain("ticket_code");

    const startsAt = new Date(Date.now() + DAY);
    const passed = await insertEvent(db.pool, owner.id, { capacity: 5, startsAt, durationMinutes: 60 });
    expect((await register(api, passed, person.cookie)).status).toBe(201);
    setNow(new Date(startsAt.getTime() + 2 * HOUR));
    const repeat = await register(api, passed, person.cookie);
    vi.useRealTimers();
    expect(repeat).toMatchObject({ status: 409, body: { error: "event_passed" } });
    expect((await counts(db.pool)).registrations).toBe(before.registrations + 1);
  });
});

describe("R11: a running event still accepts registrations", () => {
  it("answers 201 for an event that started but has not ended", async () => {
    const eventId = await insertEvent(db.pool, owner.id, {
      capacity: 5,
      startsAt: new Date(Date.now() - 10 * MINUTE),
      durationMinutes: 60,
    });
    const reply = await register(api, eventId, (await attendee(db.pool)).cookie);
    expect(reply.status, reply.text).toBe(201);
    expect(asRegistration(reply).status).toBe("registered");
  });
});

describe("R12: a cancelled registration does not block", () => {
  it("creates a new row with a new code and leaves the old row unchanged", async () => {
    const person = await attendee(db.pool);
    const eventId = await insertEvent(db.pool, owner.id, { capacity: 5 });
    const old = await insertRegistration(db.pool, eventId, person.id, "cancelled");
    const [oldBefore] = await registrationRows(db.pool, eventId);

    const reply = await register(api, eventId, person.cookie);
    expect(reply.status, reply.text).toBe(201);
    const answer = asRegistration(reply);
    expect(answer.id).not.toBe(old.id);
    expect(answer.ticket_code).not.toBe(old.ticketCode);
    expect(answer.status).toBe("registered");

    const rows = await registrationRows(db.pool, eventId);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === old.id)).toEqual(oldBefore);
    expect(await outboxRows(db.pool, eventId)).toHaveLength(1);
  });

  it("uses the normal waiting rule for the new row", async () => {
    const person = await attendee(db.pool);
    const eventId = await insertEvent(db.pool, owner.id, { capacity: 1 });
    const old = await insertRegistration(db.pool, eventId, person.id, "registered");
    await insertRegistration(db.pool, eventId, await insertUser(db.pool), "waitlisted");
    await cancelRegistrationInDb(db.pool, old.id);
    // Someone else takes the freed seat (by SQL) before the person comes back.
    await insertRegistration(db.pool, eventId, await insertUser(db.pool), "registered");

    const reply = await register(api, eventId, person.cookie);
    expect(reply.status, reply.text).toBe(201);
    expect(asRegistration(reply)).toMatchObject({ status: "waitlisted", waitlist_position: 2 });
  });
});

describe("R13: one account on two events", () => {
  it("gets two registrations, one per event", async () => {
    const person = await attendee(db.pool);
    const first = await insertEvent(db.pool, owner.id, { capacity: 5 });
    const second = await insertEvent(db.pool, owner.id, { capacity: 5 });
    const a = await register(api, first, person.cookie);
    const b = await register(api, second, person.cookie);
    expect(a.status, a.text).toBe(201);
    expect(b.status, b.text).toBe(201);
    const ra = asRegistration(a);
    const rb = asRegistration(b);
    expect(ra.event_id).toBe(first);
    expect(rb.event_id).toBe(second);
    expect(ra.id).not.toBe(rb.id);
    expect(ra.ticket_code).not.toBe(rb.ticket_code);
    expect(await registrationRows(db.pool, first)).toHaveLength(1);
    expect(await registrationRows(db.pool, second)).toHaveLength(1);
  });
});

describe("R14: unknown and malformed event ids", () => {
  it("answers 404 not_found for an unknown uuid and writes nothing", async () => {
    const before = await counts(db.pool);
    const reply = await register(api, UNKNOWN_ID, (await attendee(db.pool)).cookie);
    expect(reply).toMatchObject({ status: 404, body: { error: "not_found" } });
    expect(await counts(db.pool)).toEqual(before);
  });

  it("answers 404 for an id that is not a uuid without touching the database", async () => {
    const person = await attendee(db.pool);
    const query = vi.spyOn(db.pool, "query");
    const connect = vi.spyOn(db.pool, "connect");
    try {
      for (const id of MALFORMED_IDS) {
        const reply = await register(api, encodeURIComponent(id), person.cookie);
        expect(reply, id).toMatchObject({ status: 404, body: { error: "not_found" } });
      }
      expect(query).not.toHaveBeenCalled();
      expect(connect).not.toHaveBeenCalled();
    } finally {
      query.mockRestore();
      connect.mockRestore();
    }
  });

  it("lets any attendee register for any organizer's event", async () => {
    const otherOwner = await organizer(db.pool);
    const eventId = await insertEvent(db.pool, otherOwner.id, { capacity: 5 });
    const reply = await register(api, eventId, (await attendee(db.pool)).cookie);
    expect(reply.status, reply.text).toBe(201);
  });
});

describe("R15: guards on POST /events/:id/registrations (tests first)", () => {
  it("answers 401 not_logged_in without a valid login, runs nothing and writes nothing", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { capacity: 5 });
    const person = await attendee(db.pool);
    const cookies = [
      undefined,
      "session=garbage",
      person.cookie.slice(0, -1) + (person.cookie.endsWith("A") ? "B" : "A"),
      await mintSessionCookie("user", person.id, Date.now() - 8 * DAY),
    ];
    const before = await counts(db.pool);
    const query = vi.spyOn(db.pool, "query");
    const connect = vi.spyOn(db.pool, "connect");
    try {
      for (const cookie of cookies) {
        for (const id of [eventId, UNKNOWN_ID, MALFORMED_IDS[0]]) {
          const reply = await register(api, id, cookie);
          expect(reply, `${cookie} ${id}`).toMatchObject({ status: 401, body: { error: "not_logged_in" } });
        }
      }
      expect(query).not.toHaveBeenCalled();
      expect(connect).not.toHaveBeenCalled();
    } finally {
      query.mockRestore();
      connect.mockRestore();
    }
    expect(await counts(db.pool)).toEqual(before);
  });

  it("answers 403 wrong_role to an organizer, also for the event owner, and writes nothing", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { capacity: 5 });
    const before = await counts(db.pool);
    const query = vi.spyOn(db.pool, "query");
    const connect = vi.spyOn(db.pool, "connect");
    try {
      for (const id of [eventId, UNKNOWN_ID, MALFORMED_IDS[0]]) {
        const reply = await register(api, id, owner.cookie);
        expect(reply, id).toMatchObject({ status: 403, body: { error: "wrong_role" } });
      }
      expect(query).not.toHaveBeenCalled();
      expect(connect).not.toHaveBeenCalled();
    } finally {
      query.mockRestore();
      connect.mockRestore();
    }
    expect(await counts(db.pool)).toEqual(before);
  });
});

describe("R16: one transaction", () => {
  it("stores neither the registration nor the outbox row when the outbox insert fails", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { capacity: 5 });
    const person = await attendee(db.pool);
    await db.pool.query(`
      CREATE FUNCTION fail_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'outbox is down'; END $$;
      CREATE TRIGGER fail_outbox BEFORE INSERT ON outbox FOR EACH ROW EXECUTE FUNCTION fail_outbox();
    `);
    const before = await counts(db.pool);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const reply = await register(api, eventId, person.cookie);
      expect(reply).toMatchObject({ status: 500, body: { error: "internal" } });
    } finally {
      errors.mockRestore();
      await db.pool.query("DROP TRIGGER fail_outbox ON outbox; DROP FUNCTION fail_outbox();");
    }
    expect(await counts(db.pool)).toEqual(before);
    expect(await registrationRows(db.pool, eventId)).toHaveLength(0);

    // The event is not left locked: the next try works.
    const retry = await register(api, eventId, person.cookie);
    expect(retry.status, retry.text).toBe(201);
    expect(await outboxRows(db.pool, eventId)).toHaveLength(1);
  });
});

describe("R21: the registration shape", () => {
  it("has exactly the registration keys and no personal data", async () => {
    const email = uniqueEmail("shape");
    const userId = await insertUser(db.pool, email);
    const cookie = await mintSessionCookie("user", userId);
    const eventId = await insertEvent(db.pool, owner.id, { capacity: 1 });
    const otherEmail = uniqueEmail("other");
    const otherId = await insertUser(db.pool, otherEmail);
    await insertRegistration(db.pool, eventId, otherId, "registered");

    for (const expected of ["waitlisted", "waitlisted"]) {
      const reply = await register(api, eventId, cookie);
      expect(Object.keys(reply.body as object)).toEqual(REGISTRATION_KEYS);
      expect((reply.body as { status: string }).status).toBe(expected);
      for (const hidden of [
        "user_id",
        "queue_no",
        "cancelled_at",
        "email",
        "name",
        "password_hash",
        userId,
        email,
        otherId,
        otherEmail,
        "Attendee",
      ]) {
        expect(reply.text, hidden).not.toContain(hidden);
      }
    }
  });

  it("uses { error } bodies with only the error key", async () => {
    const cancelled = await insertEvent(db.pool, owner.id);
    await cancelEventInDb(db.pool, cancelled);
    const person = await attendee(db.pool);
    for (const reply of [
      await register(api, cancelled, person.cookie),
      await register(api, UNKNOWN_ID, person.cookie),
      await register(api, UNKNOWN_ID),
      await register(api, UNKNOWN_ID, owner.cookie),
    ]) {
      expect(Object.keys(reply.body as object)).toEqual(["error"]);
    }
  });
});
