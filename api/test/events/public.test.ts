import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Running } from "../auth/helpers.js";
import { createTestDb, insertEvent, insertRegistration, insertUser, uniqueEmail, type TestDb } from "../db/helpers.js";
import {
  attendee,
  call,
  DAY,
  HOUR,
  MALFORMED_IDS,
  MINUTE,
  organizer,
  PUBLIC_KEYS,
  startApi,
  UNKNOWN_ID,
  type Account,
} from "./helpers.js";

// GET /public/events/:id (events.md E11-E16, E19, E20). Rows are made with SQL.

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

type PublicEvent = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  duration_minutes: number;
  capacity: number;
  status: string;
  has_started: boolean;
  seats_left: number;
  full: boolean;
};

async function getPublic(id: string, cookie?: string): Promise<PublicEvent> {
  const reply = await call(api, "GET", `/public/events/${id}`, { cookie });
  expect(reply.status, reply.text).toBe(200);
  return reply.body as PublicEvent;
}

async function storedStatus(id: string): Promise<string> {
  const { rows } = await db.pool.query<{ status: string }>("SELECT status FROM events WHERE id = $1", [id]);
  return rows[0].status;
}

async function cancelInDb(id: string): Promise<void> {
  await db.pool.query("UPDATE events SET status = 'cancelled', cancelled_at = now() WHERE id = $1", [id]);
}

// Moves the clock of this process (the app runs in it) to `at`. Only Date is faked.
function setNow(at: Date): void {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(at);
}

describe("E13: the public answer has exactly the public keys (tests first)", () => {
  it("answers only id, title, starts_at, ends_at, duration_minutes, capacity, status, has_started, seats_left, full", async () => {
    const email = uniqueEmail("secret-attendee");
    const userId = await insertUser(db.pool, email);
    const eventId = await insertEvent(db.pool, owner.id, { capacity: 5, startsAt: new Date(Date.now() + DAY) });
    const { ticketCode } = await insertRegistration(db.pool, eventId, userId, "registered");

    const reply = await call(api, "GET", `/public/events/${eventId}`);
    expect(reply.status).toBe(200);
    expect(Object.keys(reply.body as object)).toEqual(PUBLIC_KEYS);

    for (const hidden of [
      "organizer_id",
      "registered",
      "schedule_version",
      "created_at",
      "cancelled_at",
      "ticket_code",
      "user_id",
      "email",
      "name",
      owner.id,
      userId,
      email,
      ticketCode,
      "Attendee",
      "Organizer",
    ]) {
      expect(reply.text, hidden).not.toContain(hidden);
    }
  });

  it("keeps the same key list for cancelled, passed and full events", async () => {
    const cancelled = await insertEvent(db.pool, owner.id);
    await cancelInDb(cancelled);
    const passed = await insertEvent(db.pool, owner.id, { startsAt: new Date(Date.now() - 2 * DAY) });
    const full = await insertEvent(db.pool, owner.id, { capacity: 1 });
    await insertRegistration(db.pool, full, await insertUser(db.pool));

    for (const id of [cancelled, passed, full]) {
      expect(Object.keys(await getPublic(id))).toEqual(PUBLIC_KEYS);
    }
  });
});

describe("E19: status is derived at read time (tests first)", () => {
  it("is active before the end, passed from exactly ends_at, cancelled whenever stored cancelled", async () => {
    const startsAt = new Date(Date.now() + 2 * DAY);
    const endsAt = new Date(startsAt.getTime() + 90 * MINUTE);
    const open = await insertEvent(db.pool, owner.id, { startsAt, durationMinutes: 90 });
    const cancelled = await insertEvent(db.pool, owner.id, { startsAt, durationMinutes: 90 });
    await cancelInDb(cancelled);

    const at = async (now: Date) => {
      setNow(now);
      try {
        return { open: await getPublic(open), cancelled: await getPublic(cancelled) };
      } finally {
        vi.useRealTimers();
      }
    };

    const beforeStart = await at(new Date(startsAt.getTime() - 1));
    expect(beforeStart.open).toMatchObject({ status: "active", has_started: false });
    expect(beforeStart.cancelled).toMatchObject({ status: "cancelled", has_started: false });

    const atStart = await at(startsAt);
    expect(atStart.open).toMatchObject({ status: "active", has_started: true });

    const lastMs = await at(new Date(endsAt.getTime() - 1));
    expect(lastMs.open).toMatchObject({ status: "active", has_started: true });
    expect(lastMs.cancelled).toMatchObject({ status: "cancelled" });

    const atEnd = await at(endsAt);
    expect(atEnd.open).toMatchObject({ status: "passed", has_started: true });
    // Cancelled wins over passed.
    expect(atEnd.cancelled).toMatchObject({ status: "cancelled" });

    const later = await at(new Date(endsAt.getTime() + DAY));
    expect(later.open).toMatchObject({ status: "passed" });
    expect(later.cancelled).toMatchObject({ status: "cancelled" });

    // Nothing is written to the table.
    expect(await storedStatus(open)).toBe("active");
    expect(await storedStatus(cancelled)).toBe("cancelled");
  });

  it("derives the same status on the organizer route", async () => {
    const startsAt = new Date(Date.now() + 2 * DAY);
    const endsAt = new Date(startsAt.getTime() + 30 * MINUTE);
    const open = await insertEvent(db.pool, owner.id, { startsAt, durationMinutes: 30 });
    const cancelled = await insertEvent(db.pool, owner.id, { startsAt, durationMinutes: 30 });
    await cancelInDb(cancelled);

    const statusAt = async (now: Date, id: string) => {
      setNow(now);
      try {
        const reply = await call(api, "GET", `/events/${id}`, { cookie: owner.cookie });
        expect(reply.status, reply.text).toBe(200);
        return (reply.body as { status: string }).status;
      } finally {
        vi.useRealTimers();
      }
    };

    expect(await statusAt(new Date(endsAt.getTime() - 1), open)).toBe("active");
    expect(await statusAt(endsAt, open)).toBe("passed");
    expect(await statusAt(new Date(endsAt.getTime() - 1), cancelled)).toBe("cancelled");
    expect(await statusAt(endsAt, cancelled)).toBe("cancelled");
    expect(await storedStatus(open)).toBe("active");
  });

  it("uses the stored start and duration with the real clock: future, running, ended, cancelled", async () => {
    const future = await insertEvent(db.pool, owner.id, { startsAt: new Date(Date.now() + DAY) });
    const running = await insertEvent(db.pool, owner.id, {
      startsAt: new Date(Date.now() - 30 * MINUTE),
      durationMinutes: 60,
    });
    const ended = await insertEvent(db.pool, owner.id, {
      startsAt: new Date(Date.now() - 2 * HOUR),
      durationMinutes: 60,
    });
    const cancelledPast = await insertEvent(db.pool, owner.id, { startsAt: new Date(Date.now() - 2 * DAY) });
    await cancelInDb(cancelledPast);

    expect(await getPublic(future)).toMatchObject({ status: "active", has_started: false });
    expect(await getPublic(running)).toMatchObject({ status: "active", has_started: true });
    expect(await getPublic(ended)).toMatchObject({ status: "passed", has_started: true });
    expect(await getPublic(cancelledPast)).toMatchObject({ status: "cancelled", has_started: true });
  });
});

describe("E11: no login needed", () => {
  it("answers the same 200 with no cookie, an attendee cookie and organizer cookies", async () => {
    const startsAt = new Date("2030-01-01T10:00:00Z");
    const eventId = await insertEvent(db.pool, owner.id, {
      title: "Open day",
      capacity: 7,
      startsAt,
      durationMinutes: 90,
    });
    const other = await organizer(db.pool);
    const person = await attendee(db.pool);

    const anonymous = await call(api, "GET", `/public/events/${eventId}`);
    expect(anonymous.status).toBe(200);
    expect(anonymous.body).toEqual({
      id: eventId,
      title: "Open day",
      starts_at: "2030-01-01T10:00:00.000Z",
      ends_at: "2030-01-01T11:30:00.000Z",
      duration_minutes: 90,
      capacity: 7,
      status: "active",
      has_started: false,
      seats_left: 7,
      full: false,
    });

    for (const cookie of [person.cookie, owner.cookie, other.cookie, "session=garbage"]) {
      const reply = await call(api, "GET", `/public/events/${eventId}`, { cookie });
      expect(reply.status).toBe(200);
      expect(reply.text).toBe(anonymous.text);
    }
  });
});

describe("E12: seats left and full", () => {
  it("capacity 1 with one registered row is full with 0 seats left", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { capacity: 1 });
    await insertRegistration(db.pool, eventId, await insertUser(db.pool), "registered");
    expect(await getPublic(eventId)).toMatchObject({ capacity: 1, seats_left: 0, full: true, status: "active" });
  });

  it("does not count waitlisted and cancelled registrations as taken seats", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { capacity: 3 });
    await insertRegistration(db.pool, eventId, await insertUser(db.pool), "registered");
    await insertRegistration(db.pool, eventId, await insertUser(db.pool), "waitlisted");
    await insertRegistration(db.pool, eventId, await insertUser(db.pool), "waitlisted");
    await insertRegistration(db.pool, eventId, await insertUser(db.pool), "cancelled");
    expect(await getPublic(eventId)).toMatchObject({ capacity: 3, seats_left: 2, full: false });
  });

  it("is not full while a seat is left, and full when the last one is taken", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { capacity: 2 });
    await insertRegistration(db.pool, eventId, await insertUser(db.pool), "registered");
    expect(await getPublic(eventId)).toMatchObject({ seats_left: 1, full: false });
    await insertRegistration(db.pool, eventId, await insertUser(db.pool), "registered");
    expect(await getPublic(eventId)).toMatchObject({ seats_left: 0, full: true });
  });

  it("never answers below 0 seats left", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { capacity: 1 });
    await insertRegistration(db.pool, eventId, await insertUser(db.pool), "registered");
    await insertRegistration(db.pool, eventId, await insertUser(db.pool), "registered");
    expect(await getPublic(eventId)).toMatchObject({ capacity: 1, seats_left: 0, full: true });
  });

  it("shows seats_left equal to capacity with no registrations", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { capacity: 4 });
    expect(await getPublic(eventId)).toMatchObject({ capacity: 4, seats_left: 4, full: false });
  });
});

describe("E14: a cancelled event", () => {
  it("answers 200 with status cancelled, seats_left 0, full false and the capacity", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { capacity: 5 });
    await insertRegistration(db.pool, eventId, await insertUser(db.pool), "registered");
    await cancelInDb(eventId);
    expect(await getPublic(eventId)).toMatchObject({
      status: "cancelled",
      capacity: 5,
      seats_left: 0,
      full: false,
      has_started: false,
    });
  });

  it("is not full even when every seat was taken", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { capacity: 1 });
    await insertRegistration(db.pool, eventId, await insertUser(db.pool), "registered");
    await cancelInDb(eventId);
    expect(await getPublic(eventId)).toMatchObject({ status: "cancelled", seats_left: 0, full: false });
  });
});

describe("E15: a started event", () => {
  it("answers has_started true while it runs, with status active and the usual counts", async () => {
    const eventId = await insertEvent(db.pool, owner.id, {
      capacity: 2,
      startsAt: new Date(Date.now() - 10 * MINUTE),
      durationMinutes: 60,
    });
    await insertRegistration(db.pool, eventId, await insertUser(db.pool), "registered");
    expect(await getPublic(eventId)).toMatchObject({
      status: "active",
      has_started: true,
      capacity: 2,
      seats_left: 1,
      full: false,
    });
  });

  it("answers full true for a running event with no seats left", async () => {
    const eventId = await insertEvent(db.pool, owner.id, {
      capacity: 1,
      startsAt: new Date(Date.now() - 10 * MINUTE),
      durationMinutes: 60,
    });
    await insertRegistration(db.pool, eventId, await insertUser(db.pool), "registered");
    expect(await getPublic(eventId)).toMatchObject({ status: "active", has_started: true, seats_left: 0, full: true });
  });
});

describe("E16: unknown and malformed ids", () => {
  it("answers 404 not_found for an unknown uuid", async () => {
    const reply = await call(api, "GET", `/public/events/${UNKNOWN_ID}`);
    expect(reply).toMatchObject({ status: 404, body: { error: "not_found" } });
  });

  it("answers 404 not_found, never 400 or 500, for an id that is not a uuid", async () => {
    for (const id of MALFORMED_IDS) {
      const reply = await call(api, "GET", `/public/events/${encodeURIComponent(id)}`);
      expect(reply, id).toMatchObject({ status: 404, body: { error: "not_found" } });
    }
  });
});

describe("E20: a passed event", () => {
  it("answers 200 on the public route with status passed, has_started true, seats_left 0, full false", async () => {
    const eventId = await insertEvent(db.pool, owner.id, {
      capacity: 3,
      startsAt: new Date(Date.now() - 3 * HOUR),
      durationMinutes: 60,
    });
    await insertRegistration(db.pool, eventId, await insertUser(db.pool), "registered");
    expect(await getPublic(eventId)).toMatchObject({
      status: "passed",
      has_started: true,
      capacity: 3,
      seats_left: 0,
      full: false,
    });
  });

  it("answers the organizer 200 with status passed and the real registered and seats_left", async () => {
    const eventId = await insertEvent(db.pool, owner.id, {
      capacity: 3,
      startsAt: new Date(Date.now() - 3 * HOUR),
      durationMinutes: 60,
    });
    await insertRegistration(db.pool, eventId, await insertUser(db.pool), "registered");
    const reply = await call(api, "GET", `/events/${eventId}`, { cookie: owner.cookie });
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({ status: "passed", capacity: 3, registered: 1, seats_left: 2 });
  });
});
