import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Running } from "../auth/helpers.js";
import { enqueueReminders } from "../../src/email/reminders.js";
import {
  backendPid,
  createTestDb,
  insertEvent,
  insertOutbox,
  insertRegistration,
  waitUntilBlockedBy,
  type TestDb,
} from "../db/helpers.js";
import {
  attendee,
  call,
  fromNow,
  HOUR,
  MALFORMED_IDS,
  MINUTE,
  organizer,
  PUBLIC_KEYS,
  startApi,
  UNKNOWN_ID,
  type Account,
  type Reply,
} from "../events/helpers.js";
import {
  allTables,
  cancelEvent,
  databaseCalls,
  eventState,
  expectError,
  failStatement,
  outboxOf,
  person,
  sorted,
} from "../events/manageHelpers.js";
import {
  asRegistration,
  attendees,
  myRegistration,
  register,
  registrationRows,
  REGISTRATION_KEYS,
  type Registration,
} from "./helpers.js";

// POST /events/:id/registrations/me/cancel (docs/specs/cancel-registration.md
// CR1-CR27; B3, DATABASE.md 3.5; roadmap step 20). Tests first: CR3, CR5-CR7,
// CR12-CR14, CR17 and the races CR20-CR23; the other CR tests are in the same
// red commit.

let db: TestDb;
let api: Running;
let owner: Account;
// 20 attendees for the crowd race (CR23 c), reused on fresh events.
let crowd: Account[];

beforeAll(async () => {
  db = await createTestDb();
  api = startApi(db.pool);
  owner = await organizer(db.pool);
  crowd = await attendees(db.pool, 20);
}, 30000);

afterAll(async () => {
  await api?.close();
  await db?.drop();
});

afterEach(() => {
  vi.useRealTimers();
});

function setNow(at: Date): void {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(at);
}

// A start far in the future, so the real clock never reaches it.
const S = new Date("2030-06-01T10:00:00.000Z");

function cancelMine(eventId: string, cookie?: string, body?: unknown): Promise<Reply> {
  return call(api, "POST", `/events/${eventId}/registrations/me/cancel`, { cookie, body });
}

function asCancelled(reply: Reply): Registration {
  expect(reply.status, reply.text).toBe(200);
  const registration = asRegistration(reply);
  expect(registration.status).toBe("cancelled");
  expect(registration.waitlist_position).toBeNull();
  expect(registration.checked_in_at).toBeNull();
  return registration;
}

async function newEvent(capacity: number, options: { startsAt?: Date; title?: string } = {}): Promise<string> {
  return insertEvent(db.pool, owner.id, {
    capacity,
    startsAt: options.startsAt ?? S,
    title: options.title ?? "Summer Meetup",
    durationMinutes: 60,
  });
}

type RowState = {
  id: string;
  status: string;
  queue_no: string;
  ticket_code: string;
  user_id: string;
  created_at: Date;
  cancelled_at: Date | null;
  checked_in_at: Date | null;
};

async function rowState(id: string): Promise<RowState> {
  const { rows } = await db.pool.query<RowState>(
    `SELECT id, status, queue_no, ticket_code, user_id, created_at, cancelled_at, checked_in_at
       FROM registrations WHERE id = $1`,
    [id],
  );
  return rows[0];
}

async function statusOf(id: string): Promise<string> {
  return (await rowState(id)).status;
}

async function registeredCount(eventId: string): Promise<number> {
  const { rows } = await db.pool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM registrations WHERE event_id = $1 AND status = 'registered'",
    [eventId],
  );
  return rows[0].n;
}

// The caller's place on the waiting list, read through GET .../me.
async function placeOf(eventId: string, who: { cookie: string }): Promise<number | null> {
  const reply = await myRegistration(api, eventId, who.cookie);
  return asRegistration(reply).waitlist_position;
}

function checkIn(code: string): Promise<Reply> {
  return call(api, "POST", "/checkin", { cookie: owner.cookie, body: { ticket_code: code } });
}

async function publicSeats(eventId: string): Promise<{ seats_left: number; full: boolean }> {
  const reply = await call(api, "GET", `/public/events/${eventId}`);
  expect(reply.status, reply.text).toBe(200);
  const { seats_left, full } = reply.body as { seats_left: number; full: boolean };
  return { seats_left, full };
}

describe("CR1: the caller's own registration is cancelled", () => {
  it("answers 200 with the cancelled row; body and query naming another person are ignored", async () => {
    const eventId = await newEvent(5);
    const me = await person(db.pool, eventId);
    const other = await person(db.pool, eventId);
    const reply = await call(
      api,
      "POST",
      `/events/${eventId}/registrations/me/cancel?user_id=${other.userId}&registration_id=${other.registrationId}`,
      {
        cookie: me.cookie,
        body: { user_id: other.userId, registration_id: other.registrationId, ticket_code: other.ticketCode },
      },
    );
    const answer = asCancelled(reply);
    expect(answer.id).toBe(me.registrationId);
    expect(answer.event_id).toBe(eventId);
    expect(answer.ticket_code).toBe(me.ticketCode);
    expect(await statusOf(me.registrationId)).toBe("cancelled");
    expect(await statusOf(other.registrationId)).toBe("registered");
  });

  it("accepts a request with no body and one with a non-JSON body", async () => {
    const eventId = await newEvent(5);
    const me = await person(db.pool, eventId);
    const res = await fetch(`${api.url}/events/${eventId}/registrations/me/cancel`, {
      method: "POST",
      headers: { cookie: me.cookie, "content-type": "text/plain" },
      body: "hello",
    });
    expect(res.status).toBe(200);
    expect(await statusOf(me.registrationId)).toBe("cancelled");
  });
});

describe("CR2: guards", () => {
  it("answers 401 without a login and 403 for an organizer, before the id check, and writes nothing", async () => {
    const eventId = await newEvent(5);
    const me = await person(db.pool, eventId);
    const before = await allTables(db.pool);
    const calls = await databaseCalls(db.pool, async () => {
      for (const id of [eventId, UNKNOWN_ID, encodeURIComponent(MALFORMED_IDS[0])]) {
        for (const cookie of [undefined, "session=garbage"]) {
          expectError(await cancelMine(id, cookie), 401, "not_logged_in");
        }
        expectError(await cancelMine(id, owner.cookie), 403, "wrong_role");
      }
    });
    expect(calls).toBe(0);
    expect(await allTables(db.pool)).toEqual(before);
    expect(await statusOf(me.registrationId)).toBe("registered");
  });
});

describe("CR3: one 404 for every missing case (tests first)", () => {
  const NOT_FOUND = '{"error":"not_found"}';

  it("a malformed id answers 404 without a database call", async () => {
    const me = await attendee(db.pool);
    const calls = await databaseCalls(db.pool, async () => {
      for (const id of MALFORMED_IDS) {
        const reply = await cancelMine(encodeURIComponent(id), me.cookie);
        expect(reply.status, id).toBe(404);
        expect(reply.text, id).toBe(NOT_FOUND);
      }
    });
    expect(calls).toBe(0);
  });

  it("an unknown event and an event the caller never registered for answer the same 404", async () => {
    const eventId = await newEvent(5);
    const me = await attendee(db.pool);
    for (const id of [UNKNOWN_ID, eventId]) {
      const reply = await cancelMine(id, me.cookie);
      expect(reply.status).toBe(404);
      expect(reply.text).toBe(NOT_FOUND);
    }
  });

  it("another attendee's registration is never touched: 404 and every row equal", async () => {
    const eventId = await newEvent(1);
    const other = await person(db.pool, eventId);
    const waiting = await person(db.pool, eventId, "waitlisted");
    await insertOutbox(db.pool, other.registrationId, { kind: "reminder" });
    const me = await attendee(db.pool);
    const before = await eventState(db.pool, eventId);
    const reply = await cancelMine(eventId, me.cookie);
    expect(reply.status).toBe(404);
    expect(reply.text).toBe(NOT_FOUND);
    expect(await eventState(db.pool, eventId)).toEqual(before);
    expect(await statusOf(other.registrationId)).toBe("registered");
    expect(await placeOf(eventId, waiting)).toBe(1);
  });
});

describe("CR4: the cancelled row is kept", () => {
  it("sets status cancelled and cancelled_at; id, queue_no, ticket_code, user_id and created_at stay", async () => {
    const eventId = await newEvent(5);
    const me = await person(db.pool, eventId);
    const before = await rowState(me.registrationId);
    const lower = (await db.pool.query<{ now: Date }>("SELECT now() AS now")).rows[0].now;
    asCancelled(await cancelMine(eventId, me.cookie));
    const upper = (await db.pool.query<{ now: Date }>("SELECT now() AS now")).rows[0].now;
    const after = await rowState(me.registrationId);
    expect(after).toMatchObject({
      id: before.id,
      queue_no: before.queue_no,
      ticket_code: before.ticket_code,
      user_id: before.user_id,
      created_at: before.created_at,
      status: "cancelled",
      checked_in_at: null,
    });
    expect(after.cancelled_at).not.toBeNull();
    expect(after.cancelled_at!.getTime()).toBeGreaterThanOrEqual(lower.getTime());
    expect(after.cancelled_at!.getTime()).toBeLessThanOrEqual(upper.getTime());
    const me2 = asRegistration(await myRegistration(api, eventId, me.cookie));
    expect(me2).toMatchObject({ id: me.registrationId, status: "cancelled", ticket_code: me.ticketCode });
  });
});

describe("CR5: the first waiting person gets the seat (tests first)", () => {
  it("promotes exactly the lowest queue_no of three waiting people and changes nothing else in it", async () => {
    const eventId = await newEvent(1);
    const seated = await person(db.pool, eventId);
    const w1 = await person(db.pool, eventId, "waitlisted");
    const w2 = await person(db.pool, eventId, "waitlisted");
    const w3 = await person(db.pool, eventId, "waitlisted");
    const w1Before = await rowState(w1.registrationId);

    asCancelled(await cancelMine(eventId, seated.cookie));

    const w1After = await rowState(w1.registrationId);
    expect(w1After).toEqual({ ...w1Before, status: "registered" });
    expect(await statusOf(w2.registrationId)).toBe("waitlisted");
    expect(await statusOf(w3.registrationId)).toBe("waitlisted");
    expect(await registeredCount(eventId)).toBe(1);
    expect(await placeOf(eventId, w2)).toBe(1);
    expect(await placeOf(eventId, w3)).toBe(2);
  });
});

describe("CR6: promotion order is queue_no; cancelled rows are skipped (tests first)", () => {
  it("a waiting person who cancelled first is skipped; the seat goes to the next by queue_no", async () => {
    const eventId = await newEvent(1);
    const seated = await person(db.pool, eventId);
    const a = await person(db.pool, eventId, "waitlisted");
    const b = await person(db.pool, eventId, "waitlisted");
    const c = await person(db.pool, eventId, "waitlisted");

    asCancelled(await cancelMine(eventId, a.cookie));
    asCancelled(await cancelMine(eventId, seated.cookie));

    expect(await statusOf(a.registrationId)).toBe("cancelled");
    expect(await statusOf(b.registrationId)).toBe("registered");
    expect(await statusOf(c.registrationId)).toBe("waitlisted");
    const promotions = await outboxOf(db.pool, eventId, "promotion");
    expect(promotions.map((o) => o.registration_id)).toEqual([b.registrationId]);
  });

  it("does not follow created_at or id: the lowest queue_no wins against both", async () => {
    const eventId = await newEvent(1);
    const seated = await person(db.pool, eventId);
    const first = await person(db.pool, eventId, "waitlisted");
    const second = await person(db.pool, eventId, "waitlisted");
    const third = await person(db.pool, eventId, "waitlisted");
    // The first in the queue gets the newest created_at and the largest id;
    // the last gets the oldest created_at and the smallest id.
    await db.pool.query(
      `UPDATE registrations SET created_at = now() + interval '1 day',
              id = 'ffffffff-ffff-7fff-bfff-ffffffffffff' WHERE id = $1`,
      [first.registrationId],
    );
    await db.pool.query(
      `UPDATE registrations SET created_at = now() - interval '1 day',
              id = '00000000-0000-7000-8000-000000000001' WHERE id = $1`,
      [third.registrationId],
    );

    asCancelled(await cancelMine(eventId, seated.cookie));

    expect(await statusOf("ffffffff-ffff-7fff-bfff-ffffffffffff")).toBe("registered");
    expect(await statusOf(second.registrationId)).toBe("waitlisted");
    expect(await statusOf("00000000-0000-7000-8000-000000000001")).toBe("waitlisted");
  });
});

describe("CR7: one promotion email row (tests first)", () => {
  it("writes one pending promotion row with the locked event's version and start and the person's email", async () => {
    const start = new Date("2031-02-03T04:05:00.000Z");
    const eventId = await newEvent(1, { startsAt: start, title: "Rust Night" });
    await db.pool.query("UPDATE events SET schedule_version = 4 WHERE id = $1", [eventId]);
    const seated = await person(db.pool, eventId);
    const w1 = await person(db.pool, eventId, "waitlisted");
    await person(db.pool, eventId, "waitlisted");
    const before = await outboxOf(db.pool, eventId);

    asCancelled(await cancelMine(eventId, seated.cookie));

    const after = await outboxOf(db.pool, eventId);
    const added = after.filter((o) => !before.some((b) => b.id === o.id));
    expect(added).toHaveLength(1);
    const row = added[0];
    expect(row).toMatchObject({
      registration_id: w1.registrationId,
      kind: "promotion",
      schedule_version: 4,
      to_email: w1.email,
      status: "pending",
      sent_at: null,
    });
    expect(row.event_starts_at.getTime()).toBe(start.getTime());
    expect(row.subject).toContain("Rust Night");
    expect(row.body).toContain("Rust Night");
    expect(row.body).toContain(w1.ticketCode);
    const iso = start.toISOString();
    expect(row.body.includes(iso) || row.body.includes(iso.slice(0, 16).replace("T", " "))).toBe(true);
    // The cancelling person gets no email.
    expect(after.filter((o) => o.registration_id === seated.registrationId)).toEqual([]);
  });

  it("an existing promotion row of the same version is a second guard: no error, still one row", async () => {
    const eventId = await newEvent(1);
    const seated = await person(db.pool, eventId);
    const w1 = await person(db.pool, eventId, "waitlisted");
    const existing = await insertOutbox(db.pool, w1.registrationId, { kind: "promotion", scheduleVersion: 1 });

    asCancelled(await cancelMine(eventId, seated.cookie));

    expect(await statusOf(w1.registrationId)).toBe("registered");
    const promotions = await outboxOf(db.pool, eventId, "promotion");
    expect(promotions.map((o) => o.id)).toEqual([existing]);
  });
});

describe("CR8: nobody waiting", () => {
  it("a full event: the seat is freed, no outbox row, seats_left goes up and full turns false", async () => {
    const eventId = await newEvent(2);
    const a = await person(db.pool, eventId);
    await person(db.pool, eventId);
    expect(await publicSeats(eventId)).toEqual({ seats_left: 0, full: true });
    const before = await outboxOf(db.pool, eventId);

    asCancelled(await cancelMine(eventId, a.cookie));

    expect(await outboxOf(db.pool, eventId)).toEqual(before);
    expect(await publicSeats(eventId)).toEqual({ seats_left: 1, full: false });
    expect(await registeredCount(eventId)).toBe(1);
  });

  it("a non-full event: seats_left goes up by one", async () => {
    const eventId = await newEvent(5);
    const a = await person(db.pool, eventId);
    expect(await publicSeats(eventId)).toEqual({ seats_left: 4, full: false });
    asCancelled(await cancelMine(eventId, a.cookie));
    expect(await publicSeats(eventId)).toEqual({ seats_left: 5, full: false });
    expect(await outboxOf(db.pool, eventId)).toEqual([]);
  });
});

describe("CR9: capacity is respected", () => {
  it("with more registered than capacity (made by SQL), a cancel promotes nobody", async () => {
    const eventId = await newEvent(1);
    const a = await person(db.pool, eventId);
    await person(db.pool, eventId);
    const w = await person(db.pool, eventId, "waitlisted");

    asCancelled(await cancelMine(eventId, a.cookie));

    expect(await statusOf(w.registrationId)).toBe("waitlisted");
    expect(await outboxOf(db.pool, eventId)).toEqual([]);
    expect(await registeredCount(eventId)).toBe(1);
  });

  it("promotes at most one person per cancel, even with free seats left over", async () => {
    // Capacity 3 with one registered and two waiting (made by SQL).
    const eventId = await newEvent(3);
    const a = await person(db.pool, eventId);
    const w1 = await person(db.pool, eventId, "waitlisted");
    const w2 = await person(db.pool, eventId, "waitlisted");

    asCancelled(await cancelMine(eventId, a.cookie));

    expect(await statusOf(w1.registrationId)).toBe("registered");
    expect(await statusOf(w2.registrationId)).toBe("waitlisted");
    expect(await outboxOf(db.pool, eventId, "promotion")).toHaveLength(1);
  });
});

describe("CR10, CR11: cancel a place on the waiting list", () => {
  it("frees no seat, promotes nobody and writes no outbox row", async () => {
    const eventId = await newEvent(1);
    const seated = await person(db.pool, eventId);
    const w1 = await person(db.pool, eventId, "waitlisted");
    const w2 = await person(db.pool, eventId, "waitlisted");
    const seatsBefore = await publicSeats(eventId);
    const outboxBefore = await outboxOf(db.pool, eventId);

    const answer = asCancelled(await cancelMine(eventId, w1.cookie));
    expect(answer.id).toBe(w1.registrationId);

    const row = await rowState(w1.registrationId);
    expect(row.status).toBe("cancelled");
    expect(row.cancelled_at).not.toBeNull();
    expect(await statusOf(seated.registrationId)).toBe("registered");
    expect(await statusOf(w2.registrationId)).toBe("waitlisted");
    expect(await registeredCount(eventId)).toBe(1);
    expect(await publicSeats(eventId)).toEqual(seatsBefore);
    expect(await outboxOf(db.pool, eventId)).toEqual(outboxBefore);
  });

  it("the other places renumber: A = 1, C = 2 after B cancels", async () => {
    const eventId = await newEvent(1);
    await person(db.pool, eventId);
    const a = await person(db.pool, eventId, "waitlisted");
    const b = await person(db.pool, eventId, "waitlisted");
    const c = await person(db.pool, eventId, "waitlisted");
    expect([await placeOf(eventId, a), await placeOf(eventId, b), await placeOf(eventId, c)]).toEqual([1, 2, 3]);

    asCancelled(await cancelMine(eventId, b.cookie));

    expect(await placeOf(eventId, a)).toBe(1);
    expect(await placeOf(eventId, c)).toBe(2);
    expect(await placeOf(eventId, b)).toBeNull();
  });
});

describe("CR12: a second cancel is a 200 no-op (tests first)", () => {
  it("answers the same row, keeps cancelled_at and writes nothing", async () => {
    const eventId = await newEvent(1);
    const me = await person(db.pool, eventId);
    const w1 = await person(db.pool, eventId, "waitlisted");
    await person(db.pool, eventId, "waitlisted");
    const first = asCancelled(await cancelMine(eventId, me.cookie));
    const before = await allTables(db.pool);

    const second = asCancelled(await cancelMine(eventId, me.cookie));

    expect(second).toEqual(first);
    expect(await allTables(db.pool)).toEqual(before);
    expect(await outboxOf(db.pool, eventId, "promotion")).toHaveLength(1);
    expect((await outboxOf(db.pool, eventId, "promotion"))[0].registration_id).toBe(w1.registrationId);
  });

  for (const [label, startsAt, stored] of [
    ["a cancelled event", S, "cancelled"],
    ["a started event", fromNow(-10 * MINUTE), "active"],
    ["a passed event", fromNow(-5 * HOUR), "active"],
  ] as const) {
    it(`is also 200 for ${label}, decided before the event state`, async () => {
      const eventId = await newEvent(1, { startsAt });
      const me = await person(db.pool, eventId, "cancelled");
      await person(db.pool, eventId, "waitlisted");
      if (stored === "cancelled") {
        await db.pool.query("UPDATE events SET status = 'cancelled', cancelled_at = now() WHERE id = $1", [eventId]);
      }
      const before = await allTables(db.pool);
      const answer = asCancelled(await cancelMine(eventId, me.cookie));
      expect(answer).toMatchObject({ id: me.registrationId, ticket_code: me.ticketCode });
      expect(await allTables(db.pool)).toEqual(before);
    });
  }

  it("with a newer active row (registered again), the active row is the one cancelled", async () => {
    const eventId = await newEvent(5);
    const me = await person(db.pool, eventId, "cancelled");
    const again = await insertRegistration(db.pool, eventId, me.userId, "registered");
    const answer = asCancelled(await cancelMine(eventId, me.cookie));
    expect(answer.id).toBe(again.id);
    expect(await statusOf(again.id)).toBe("cancelled");
  });
});

describe("CR13: a checked-in ticket cannot be cancelled (tests first)", () => {
  it("answers 409 already_checked_in with only the error key and changes nothing", async () => {
    const eventId = await newEvent(1);
    const me = await person(db.pool, eventId, "checked_in");
    await person(db.pool, eventId, "waitlisted");
    const before = await allTables(db.pool);
    const reply = await cancelMine(eventId, me.cookie);
    expect(reply.status).toBe(409);
    expect(reply.text).toBe('{"error":"already_checked_in"}');
    expect(await allTables(db.pool)).toEqual(before);
  });

  for (const [label, startsAt, stored] of [
    ["a started event", fromNow(-10 * MINUTE), "active"],
    ["a passed event", fromNow(-5 * HOUR), "active"],
    ["a cancelled event", S, "cancelled"],
  ] as const) {
    it(`comes before the event state: also for ${label}`, async () => {
      const eventId = await newEvent(1, { startsAt });
      const me = await person(db.pool, eventId, "checked_in");
      if (stored === "cancelled") {
        await db.pool.query("UPDATE events SET status = 'cancelled', cancelled_at = now() WHERE id = $1", [eventId]);
      }
      const before = await allTables(db.pool);
      expectError(await cancelMine(eventId, me.cookie), 409, "already_checked_in");
      expect(await allTables(db.pool)).toEqual(before);
    });
  }
});

describe("CR14: event state under the lock (tests first)", () => {
  for (const status of ["registered", "waitlisted"] as const) {
    it(`a stored cancelled event answers 409 event_cancelled for a ${status} row (wins over passed)`, async () => {
      const eventId = await newEvent(1, { startsAt: fromNow(-5 * HOUR) });
      if (status === "waitlisted") await person(db.pool, eventId);
      const me = await person(db.pool, eventId, status);
      await db.pool.query("UPDATE events SET status = 'cancelled', cancelled_at = now() WHERE id = $1", [eventId]);
      const before = await allTables(db.pool);
      expectError(await cancelMine(eventId, me.cookie), 409, "event_cancelled");
      expect(await allTables(db.pool)).toEqual(before);
    });

    it(`a passed event answers 409 event_passed for a ${status} row`, async () => {
      const eventId = await newEvent(1, { startsAt: fromNow(-5 * HOUR) });
      if (status === "waitlisted") await person(db.pool, eventId);
      const me = await person(db.pool, eventId, status);
      await person(db.pool, eventId, "waitlisted");
      const before = await allTables(db.pool);
      expectError(await cancelMine(eventId, me.cookie), 409, "event_passed");
      expect(await allTables(db.pool)).toEqual(before);
    });

    it(`a running event answers 409 event_started for a ${status} row`, async () => {
      const eventId = await newEvent(1, { startsAt: fromNow(-10 * MINUTE) });
      if (status === "waitlisted") await person(db.pool, eventId);
      const me = await person(db.pool, eventId, status);
      await person(db.pool, eventId, "waitlisted");
      const before = await allTables(db.pool);
      expectError(await cancelMine(eventId, me.cookie), 409, "event_started");
      expect(await allTables(db.pool)).toEqual(before);
    });
  }

  it("now = starts_at is event_started", async () => {
    const start = fromNow(2 * HOUR);
    const eventId = await newEvent(1, { startsAt: start });
    const me = await person(db.pool, eventId);
    setNow(start);
    expectError(await cancelMine(eventId, me.cookie), 409, "event_started");
    expect(await statusOf(me.registrationId)).toBe("registered");
  });

  it("now = ends_at is event_passed", async () => {
    const start = fromNow(2 * HOUR);
    const eventId = await newEvent(1, { startsAt: start });
    const me = await person(db.pool, eventId);
    setNow(new Date(start.getTime() + 60 * MINUTE));
    expectError(await cancelMine(eventId, me.cookie), 409, "event_passed");
    expect(await statusOf(me.registrationId)).toBe("registered");
  });

  it("one ms before starts_at is allowed", async () => {
    const start = fromNow(2 * HOUR);
    const eventId = await newEvent(1, { startsAt: start });
    const me = await person(db.pool, eventId);
    const w = await person(db.pool, eventId, "waitlisted");
    setNow(new Date(start.getTime() - 1));
    asCancelled(await cancelMine(eventId, me.cookie));
    expect(await statusOf(w.registrationId)).toBe("registered");
  });
});

describe("CR15: a cancelled event (ER83)", () => {
  it("after POST /events/:id/cancel the attendee's cancel is the 200 no-op; a checked-in person gets 409", async () => {
    const eventId = await newEvent(1);
    const me = await person(db.pool, eventId);
    const w = await person(db.pool, eventId, "waitlisted");
    const arrived = await person(db.pool, eventId, "checked_in");
    expect((await cancelEvent(api, eventId, owner.cookie)).status).toBe(200);
    const before = await allTables(db.pool);

    const answer = asCancelled(await cancelMine(eventId, me.cookie));
    expect(answer.id).toBe(me.registrationId);
    asCancelled(await cancelMine(eventId, w.cookie));
    expectError(await cancelMine(eventId, arrived.cookie), 409, "already_checked_in");

    expect(await allTables(db.pool)).toEqual(before);
    expect(await outboxOf(db.pool, eventId, "promotion")).toEqual([]);
    expect(await statusOf(arrived.registrationId)).toBe("registered");
  });
});

describe("CR16: one transaction", () => {
  it("waits for the event lock held by another transaction", async () => {
    const eventId = await newEvent(1);
    const me = await person(db.pool, eventId);
    const holder = await db.pool.connect();
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT id FROM events WHERE id = $1 FOR UPDATE", [eventId]);
      const pid = await backendPid(holder);
      let done = false;
      const pending = cancelMine(eventId, me.cookie).finally(() => {
        done = true;
      });
      const waiter = await waitUntilBlockedBy(db.pool, pid, () => done);
      expect(waiter).not.toBeNull();
      expect(await statusOf(me.registrationId)).toBe("registered");
      await holder.query("COMMIT");
      asCancelled(await pending);
    } finally {
      holder.release();
    }
  });

  it("rolls back and answers 500 internal when a statement fails; nothing is written", async () => {
    const eventId = await newEvent(1);
    const me = await person(db.pool, eventId);
    const w = await person(db.pool, eventId, "waitlisted");
    await insertOutbox(db.pool, me.registrationId, { kind: "reminder" });
    const before = await eventState(db.pool, eventId);
    const undo = failStatement(db.pool, "DELETE FROM outbox");
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expectError(await cancelMine(eventId, me.cookie), 500, "internal");
    } finally {
      undo();
      error.mockRestore();
    }
    expect(await eventState(db.pool, eventId)).toEqual(before);
    // The pool is still usable and a retry works.
    asCancelled(await cancelMine(eventId, me.cookie));
    expect(await statusOf(w.registrationId)).toBe("registered");
  });
});

describe("CR17: the cancelled person's pending reminders are deleted (tests first)", () => {
  it("deletes only pending reminder rows of the cancelled registration", async () => {
    const eventId = await newEvent(1);
    const me = await person(db.pool, eventId);
    const w = await person(db.pool, eventId, "waitlisted");
    const pending = await insertOutbox(db.pool, me.registrationId, { kind: "reminder", scheduleVersion: 1 });
    const pendingOld = await insertOutbox(db.pool, me.registrationId, { kind: "reminder", scheduleVersion: 0 });
    const sent = await insertOutbox(db.pool, me.registrationId, {
      kind: "reminder",
      scheduleVersion: 2,
      status: "sent",
      sentAt: new Date(),
    });
    const failed = await insertOutbox(db.pool, me.registrationId, {
      kind: "reminder",
      scheduleVersion: 3,
      status: "error_sending",
      sendAttempts: 3,
      sendError: "boom",
    });
    const ticket = await insertOutbox(db.pool, me.registrationId, { kind: "ticket" });
    const moved = await insertOutbox(db.pool, me.registrationId, { kind: "reschedule", scheduleVersion: 2 });
    const othersReminder = await insertOutbox(db.pool, w.registrationId, { kind: "reminder", scheduleVersion: 0 });
    const otherEventId = await newEvent(5);
    const elsewhere = await person(db.pool, otherEventId);
    const otherEvent = await insertOutbox(db.pool, elsewhere.registrationId, { kind: "reminder" });

    asCancelled(await cancelMine(eventId, me.cookie));

    const left = (await outboxOf(db.pool, eventId)).map((o) => o.id);
    expect(left).not.toContain(pending);
    expect(left).not.toContain(pendingOld);
    for (const id of [sent, failed, ticket, moved, othersReminder]) expect(left).toContain(id);
    expect((await outboxOf(db.pool, otherEventId)).map((o) => o.id)).toEqual([otherEvent]);
  });

  it("a waiting person's pending reminder (made by SQL) is deleted too", async () => {
    const eventId = await newEvent(1);
    await person(db.pool, eventId);
    const w = await person(db.pool, eventId, "waitlisted");
    const pending = await insertOutbox(db.pool, w.registrationId, { kind: "reminder" });
    asCancelled(await cancelMine(eventId, w.cookie));
    expect((await outboxOf(db.pool, eventId)).map((o) => o.id)).not.toContain(pending);
  });
});

describe("CR18: the promoted person gets a reminder only through the worker", () => {
  it("the cancel writes no reminder; the worker then writes one for the promoted person, once", async () => {
    // A start no other test uses, so the worker's window holds only this event.
    const start = new Date("2034-03-03T03:03:00.000Z");
    const eventId = await newEvent(1, { startsAt: start });
    const me = await person(db.pool, eventId);
    const w = await person(db.pool, eventId, "waitlisted");

    asCancelled(await cancelMine(eventId, me.cookie));
    expect(await outboxOf(db.pool, eventId, "reminder")).toEqual([]);

    await enqueueReminders(db.pool, new Date(start.getTime() - 25 * HOUR));
    expect(await outboxOf(db.pool, eventId, "reminder")).toEqual([]);

    await enqueueReminders(db.pool, new Date(start.getTime() - HOUR));
    const reminders = await outboxOf(db.pool, eventId, "reminder");
    expect(reminders.map((o) => o.registration_id)).toEqual([w.registrationId]);

    await enqueueReminders(db.pool, new Date(start.getTime() - 30 * MINUTE));
    expect(await outboxOf(db.pool, eventId, "reminder")).toHaveLength(1);
  });
});

describe("CR19: writes are limited", () => {
  it("changes only the cancelled row, the promoted row's status, one promotion row and the deleted reminder; logs nothing", async () => {
    const eventId = await newEvent(1);
    const me = await person(db.pool, eventId);
    const w1 = await person(db.pool, eventId, "waitlisted");
    await person(db.pool, eventId, "waitlisted");
    const reminder = await insertOutbox(db.pool, me.registrationId, { kind: "reminder" });
    const before = await allTables(db.pool);
    const spies = (["log", "info", "warn", "error"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    try {
      asCancelled(await cancelMine(eventId, me.cookie));
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
    const after = await allTables(db.pool);
    for (const table of ["organizers", "users", "events"]) expect(after[table], table).toEqual(before[table]);

    const cancelledRow = after.registrations.find((r) => r.id === me.registrationId)!;
    expect(after.registrations).toEqual(
      before.registrations.map((r) => {
        if (r.id === me.registrationId) {
          return { ...r, status: "cancelled", cancelled_at: cancelledRow.cancelled_at };
        }
        if (r.id === w1.registrationId) return { ...r, status: "registered" };
        return r;
      }),
    );
    const removed = before.outbox.filter((o) => !after.outbox.some((a) => a.id === o.id)).map((o) => o.id);
    expect(removed).toEqual([reminder]);
    const added = after.outbox.filter((o) => !before.outbox.some((b) => b.id === o.id));
    expect(added.map((o) => [o.kind, o.registration_id])).toEqual([["promotion", w1.registrationId]]);
    // The rows that stayed are unchanged.
    expect(after.outbox.filter((o) => before.outbox.some((b) => b.id === o.id))).toEqual(
      before.outbox.filter((o) => o.id !== reminder),
    );
  });
});

describe("CR20: cancel against check-in of the same ticket (tests first)", () => {
  it("the answers agree: check-in wins (409 already_checked_in) or cancel wins (409 registration_cancelled)", async () => {
    let checkInWon = 0;
    let cancelWon = 0;
    for (let round = 0; round < 10; round++) {
      const eventId = await newEvent(1);
      const guest = await person(db.pool, eventId);
      const w = await person(db.pool, eventId, "waitlisted");
      const [checked, cancelled] = await Promise.all([checkIn(guest.ticketCode), cancelMine(eventId, guest.cookie)]);
      const state = await rowState(guest.registrationId);
      const promotions = await outboxOf(db.pool, eventId, "promotion");
      if (checked.status === 200) {
        checkInWon++;
        expectError(cancelled, 409, "already_checked_in");
        expect(state.status).toBe("registered");
        expect(state.checked_in_at).not.toBeNull();
        expect(await statusOf(w.registrationId)).toBe("waitlisted");
        expect(promotions).toEqual([]);
      } else {
        cancelWon++;
        expectError(checked, 409, "registration_cancelled");
        asCancelled(cancelled);
        expect(state.status).toBe("cancelled");
        expect(state.checked_in_at).toBeNull();
        expect(await statusOf(w.registrationId)).toBe("registered");
        expect(promotions.map((o) => o.registration_id)).toEqual([w.registrationId]);
      }
    }
    expect(checkInWon + cancelWon).toBe(10);
  });
});

describe("CR21: five parallel cancels of one ticket promote once (tests first)", () => {
  for (let round = 1; round <= 5; round++) {
    it(`one promotion row, W1 seated, W2 still first in line (round ${round})`, async () => {
      const eventId = await newEvent(1);
      const a = await person(db.pool, eventId);
      const w1 = await person(db.pool, eventId, "waitlisted");
      const w2 = await person(db.pool, eventId, "waitlisted");

      const replies = await Promise.all(Array.from({ length: 5 }, () => cancelMine(eventId, a.cookie)));

      const answers = replies.map(asCancelled);
      for (const answer of answers) expect(answer).toEqual(answers[0]);
      expect(answers[0].id).toBe(a.registrationId);
      expect(await statusOf(w1.registrationId)).toBe("registered");
      expect(await statusOf(w2.registrationId)).toBe("waitlisted");
      expect(await placeOf(eventId, w2)).toBe(1);
      const promotions = await outboxOf(db.pool, eventId, "promotion");
      expect(promotions.map((o) => o.registration_id)).toEqual([w1.registrationId]);
      expect(await registeredCount(eventId)).toBe(1);
    });
  }
});

describe("CR22: two seats, two parallel cancels (tests first)", () => {
  for (let round = 1; round <= 3; round++) {
    it(`W1 and W2 get the seats, W3 waits at place 1 (round ${round})`, async () => {
      const eventId = await newEvent(2);
      const a = await person(db.pool, eventId);
      const b = await person(db.pool, eventId);
      const w1 = await person(db.pool, eventId, "waitlisted");
      const w2 = await person(db.pool, eventId, "waitlisted");
      const w3 = await person(db.pool, eventId, "waitlisted");

      const [ra, rb] = await Promise.all([cancelMine(eventId, a.cookie), cancelMine(eventId, b.cookie)]);

      expect(asCancelled(ra).id).toBe(a.registrationId);
      expect(asCancelled(rb).id).toBe(b.registrationId);
      expect(await statusOf(w1.registrationId)).toBe("registered");
      expect(await statusOf(w2.registrationId)).toBe("registered");
      expect(await statusOf(w3.registrationId)).toBe("waitlisted");
      expect(await placeOf(eventId, w3)).toBe(1);
      const promotions = await outboxOf(db.pool, eventId, "promotion");
      expect(sorted(promotions.map((o) => o.registration_id))).toEqual(sorted([w1.registrationId, w2.registrationId]));
      expect(await registeredCount(eventId)).toBe(2);
    });
  }
});

describe("CR23: cancel against register on the last seat (tests first)", () => {
  for (let round = 1; round <= 5; round++) {
    it(`(a) with a waiting person: W gets the seat, C waits at place 1 (round ${round})`, async () => {
      const eventId = await newEvent(1);
      const a = await person(db.pool, eventId);
      const w = await person(db.pool, eventId, "waitlisted");
      const c = await attendee(db.pool);

      const [cancelled, registered] = await Promise.all([cancelMine(eventId, a.cookie), register(api, eventId, c.cookie)]);

      asCancelled(cancelled);
      expect(registered.status, registered.text).toBe(201);
      expect(asRegistration(registered).status).toBe("waitlisted");
      expect(await statusOf(w.registrationId)).toBe("registered");
      expect(await placeOf(eventId, c)).toBe(1);
      expect(await registeredCount(eventId)).toBe(1);
    });

    it(`(b) nobody waiting: A cancelled and C seated, with exactly one email row (round ${round})`, async () => {
      const eventId = await newEvent(1);
      const a = await person(db.pool, eventId);
      const c = await attendee(db.pool);

      const [cancelled, registered] = await Promise.all([cancelMine(eventId, a.cookie), register(api, eventId, c.cookie)]);

      asCancelled(cancelled);
      expect(registered.status, registered.text).toBe(201);
      const first = asRegistration(registered);
      expect(await statusOf(a.registrationId)).toBe("cancelled");
      expect(await statusOf(first.id)).toBe("registered");
      expect(await registeredCount(eventId)).toBe(1);
      const rows = (await outboxOf(db.pool, eventId)).filter((o) => o.registration_id === first.id);
      expect(rows.map((o) => o.kind)).toEqual([first.status === "waitlisted" ? "promotion" : "ticket"]);
    });
  }

  for (let round = 1; round <= 3; round++) {
    it(`(c) 20 registrations against one cancel: never more than 3 seated, one of the 20 gets the seat (round ${round})`, async () => {
      const eventId = await newEvent(3);
      const a = await person(db.pool, eventId);
      await person(db.pool, eventId);
      await person(db.pool, eventId);

      let racing = true;
      let most = 0;
      const watcher = (async () => {
        while (racing) {
          most = Math.max(most, await registeredCount(eventId));
          await new Promise((resolve) => setTimeout(resolve, 2));
        }
      })();
      const [cancelled, ...replies] = await Promise.all([
        cancelMine(eventId, a.cookie),
        ...crowd.map((p) => register(api, eventId, p.cookie)),
      ]);
      racing = false;
      await watcher;

      asCancelled(cancelled);
      for (const reply of replies) expect(reply.status, reply.text).toBe(201);
      expect(most).toBeLessThanOrEqual(3);
      expect(await registeredCount(eventId)).toBe(3);

      const crowdIds = new Set(crowd.map((p) => p.id));
      const rows = (await registrationRows(db.pool, eventId)).filter((r) => crowdIds.has(r.user_id));
      expect(rows).toHaveLength(20);
      expect(rows.filter((r) => r.status === "registered")).toHaveLength(1);
      const waiting = crowd.filter((p) => rows.find((r) => r.user_id === p.id)!.status === "waitlisted");
      expect(waiting).toHaveLength(19);
      const places = await Promise.all(waiting.map((p) => placeOf(eventId, p)));
      expect([...places].sort((x, y) => x! - y!)).toEqual(Array.from({ length: 19 }, (_, i) => i + 1));
    });
  }
});

describe("CR24: cancel against the event being cancelled or moved", () => {
  async function whileLocked(eventId: string, cookie: string, change: (q: (sql: string) => Promise<unknown>) => Promise<void>) {
    const holder = await db.pool.connect();
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT id FROM events WHERE id = $1 FOR UPDATE", [eventId]);
      const pid = await backendPid(holder);
      let done = false;
      const pending = cancelMine(eventId, cookie).finally(() => {
        done = true;
      });
      expect(await waitUntilBlockedBy(db.pool, pid, () => done)).not.toBeNull();
      await change((sql) => holder.query(sql, [eventId]));
      await holder.query("COMMIT");
      return await pending;
    } finally {
      holder.release();
    }
  }

  it("an event cancelled while the cancel waits: 200 no-op, nobody promoted", async () => {
    const eventId = await newEvent(1);
    const me = await person(db.pool, eventId);
    const w = await person(db.pool, eventId, "waitlisted");
    const reply = await whileLocked(eventId, me.cookie, async (q) => {
      await q("UPDATE events SET status = 'cancelled', cancelled_at = now() WHERE id = $1");
      await q(
        `UPDATE registrations SET status = 'cancelled', cancelled_at = now()
          WHERE event_id = $1 AND checked_in_at IS NULL AND status <> 'cancelled'`,
      );
    });
    expect(asCancelled(reply).id).toBe(me.registrationId);
    expect(await statusOf(w.registrationId)).toBe("cancelled");
    expect(await outboxOf(db.pool, eventId, "promotion")).toEqual([]);
  });

  it("an event moved into the past while the cancel waits: 409 event_started", async () => {
    const eventId = await newEvent(1);
    const me = await person(db.pool, eventId);
    const w = await person(db.pool, eventId, "waitlisted");
    const reply = await whileLocked(eventId, me.cookie, async (q) => {
      await q("UPDATE events SET starts_at = now() - interval '10 minutes' WHERE id = $1");
    });
    expectError(reply, 409, "event_started");
    expect(await statusOf(me.registrationId)).toBe("registered");
    expect(await statusOf(w.registrationId)).toBe("waitlisted");
  });

  it("an event rescheduled while the cancel waits: the promotion carries the new version and start", async () => {
    const eventId = await newEvent(1);
    const me = await person(db.pool, eventId);
    const w = await person(db.pool, eventId, "waitlisted");
    const moved = new Date("2030-07-01T12:00:00.000Z");
    const reply = await whileLocked(eventId, me.cookie, async (q) => {
      await q(
        `UPDATE events SET starts_at = '${moved.toISOString()}', schedule_version = schedule_version + 1 WHERE id = $1`,
      );
    });
    asCancelled(reply);
    const promotions = await outboxOf(db.pool, eventId, "promotion");
    expect(promotions).toHaveLength(1);
    expect(promotions[0]).toMatchObject({ registration_id: w.registrationId, schedule_version: 2 });
    expect(promotions[0].event_starts_at.getTime()).toBe(moved.getTime());
  });
});

describe("CR25: reads after a cancel", () => {
  it("every read shows the cancel and the promotion", async () => {
    const eventId = await newEvent(1);
    const me = await person(db.pool, eventId);
    const w1 = await person(db.pool, eventId, "waitlisted");
    const w2 = await person(db.pool, eventId, "waitlisted");
    const listBefore = await call(api, "GET", "/public/events");
    expect(await placeOf(eventId, w2)).toBe(2);

    asCancelled(await cancelMine(eventId, me.cookie));

    const mine = asRegistration(await myRegistration(api, eventId, me.cookie));
    expect(mine).toMatchObject({ status: "cancelled", ticket_code: me.ticketCode, waitlist_position: null });

    type Mine = { id: string; status: string };
    const myList = await call(api, "GET", "/me/registrations", { cookie: me.cookie });
    const myRows = (myList.body as { registrations: Mine[] }).registrations;
    expect(myRows.find((r) => r.id === me.registrationId)?.status).toBe("cancelled");
    const theirList = await call(api, "GET", "/me/registrations", { cookie: w1.cookie });
    const theirRows = (theirList.body as { registrations: Mine[] }).registrations;
    expect(theirRows.find((r) => r.id === w1.registrationId)?.status).toBe("registered");

    const organizerList = await call(api, "GET", `/events/${eventId}/registrations`, { cookie: owner.cookie });
    const listed = (organizerList.body as { registrations: Mine[] }).registrations;
    expect(listed.map((r) => r.id)).toContain(w1.registrationId);
    expect(listed.map((r) => r.id)).not.toContain(me.registrationId);

    const arrivals = await call(api, "GET", `/events/${eventId}/arrivals`, { cookie: owner.cookie });
    expect(arrivals.body).toEqual({ capacity: 1, registered: 1, arrived: 0 });

    const event = await call(api, "GET", `/events/${eventId}`, { cookie: owner.cookie });
    expect(event.body).toMatchObject({ registered: 1, seats_left: 0 });
    expect(await publicSeats(eventId)).toEqual({ seats_left: 0, full: true });

    const listAfter = await call(api, "GET", "/public/events");
    expect(listAfter.status).toBe(listBefore.status);
    const keys = (reply: Reply) =>
      Object.keys(((reply.body as { events: object[] }).events ?? [])[0] ?? {}).sort();
    expect(keys(listAfter)).toEqual(keys(listBefore));
    expect(keys(listAfter).every((k) => PUBLIC_KEYS.includes(k))).toBe(true);

    expect(await placeOf(eventId, w2)).toBe(1);
  });
});

describe("CR26: registering again after a cancel", () => {
  it("makes a new row at the end of the waiting list; the old row stays; a second cancel cancels the new row", async () => {
    const eventId = await newEvent(1);
    const me = await person(db.pool, eventId);
    const w1 = await person(db.pool, eventId, "waitlisted");
    const w2 = await person(db.pool, eventId, "waitlisted");
    asCancelled(await cancelMine(eventId, me.cookie));
    const oldRow = await rowState(me.registrationId);

    const again = await register(api, eventId, me.cookie);
    expect(again.status, again.text).toBe(201);
    const fresh = asRegistration(again);
    expect(fresh.id).not.toBe(me.registrationId);
    expect(fresh.ticket_code).not.toBe(me.ticketCode);
    expect(fresh.status).toBe("waitlisted");
    expect(fresh.waitlist_position).toBe(2);
    expect(await placeOf(eventId, w2)).toBe(1);
    expect(await statusOf(w1.registrationId)).toBe("registered");
    expect(await rowState(me.registrationId)).toEqual(oldRow);
    expect(asRegistration(await myRegistration(api, eventId, me.cookie)).id).toBe(fresh.id);

    const second = asCancelled(await cancelMine(eventId, me.cookie));
    expect(second.id).toBe(fresh.id);
    expect(await rowState(me.registrationId)).toEqual(oldRow);
  });

  it("with a free seat the new row is registered", async () => {
    const eventId = await newEvent(2);
    const me = await person(db.pool, eventId);
    asCancelled(await cancelMine(eventId, me.cookie));
    const fresh = asRegistration(await register(api, eventId, me.cookie));
    expect(fresh.status).toBe("registered");
    expect(fresh.id).not.toBe(me.registrationId);
  });
});

describe("CR27: shape", () => {
  it("the 200 body has exactly the seven keys and nothing about anyone else", async () => {
    const eventId = await newEvent(1);
    const me = await person(db.pool, eventId);
    const w = await person(db.pool, eventId, "waitlisted");
    const reply = await cancelMine(eventId, me.cookie);
    expect(Object.keys(reply.body as object)).toEqual(REGISTRATION_KEYS);
    for (const word of ["user_id", "queue_no", "cancelled_at", "email", "name", "password_hash"]) {
      expect(reply.text).not.toContain(word);
    }
    for (const value of [me.userId, me.email, w.userId, w.email, w.registrationId, w.ticketCode]) {
      expect(reply.text).not.toContain(value);
    }
  });
});
