import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Running } from "../auth/helpers.js";
import { enqueueReminders } from "../../src/email/reminders.js";
import { backendPid, createTestDb, insertEvent, insertOutbox, waitUntilBlockedBy, type TestDb } from "../db/helpers.js";
import { attendees, register } from "../registrations/helpers.js";
import {
  attendee,
  call,
  DAY,
  fromNow,
  HOUR,
  MALFORMED_IDS,
  MINUTE,
  organizer,
  ORGANIZER_KEYS,
  startApi,
  UNKNOWN_ID,
  type Account,
  type Reply,
} from "./helpers.js";
import {
  allTables,
  cancelEvent,
  databaseCalls,
  eventState,
  expectError,
  failStatement,
  ISO_UTC,
  outboxOf,
  person,
  reschedule,
  sorted,
  type OrganizerEvent,
  type Person,
} from "./manageHelpers.js";

// POST /events/:id/cancel (email-reminders.md ER61, ER62, ER64, ER73-ER81,
// ER85-ER87; B9, DATABASE.md 3.7; roadmap step 37). Tests first: ER64, ER76,
// ER77, ER79.

let db: TestDb;
let api: Running;
let owner: Account;
let stranger: Account;

beforeAll(async () => {
  db = await createTestDb();
  api = startApi(db.pool);
  owner = await organizer(db.pool);
  stranger = await organizer(db.pool);
});

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

const S = new Date("2030-04-01T10:00:00.000Z");

// An event at `startsAt` with two registered people, one waiting, one cancelled
// and one checked in, and a registration of another event of the same owner.
async function mixedEvent(options: { startsAt?: Date; title?: string; capacity?: number } = {}) {
  const eventId = await insertEvent(db.pool, owner.id, {
    startsAt: options.startsAt ?? S,
    capacity: options.capacity ?? 10,
    title: options.title ?? "Spring Meetup",
    durationMinutes: 60,
  });
  const registered = [await person(db.pool, eventId), await person(db.pool, eventId)];
  const waiting = await person(db.pool, eventId, "waitlisted");
  const cancelled = await person(db.pool, eventId, "cancelled");
  const checkedIn = await person(db.pool, eventId, "checked_in");
  const otherEventId = await insertEvent(db.pool, owner.id, { startsAt: S });
  const elsewhere = await person(db.pool, otherEventId);
  return { eventId, registered, waiting, cancelled, checkedIn, otherEventId, elsewhere };
}

function asEvent(reply: Reply): OrganizerEvent {
  expect(reply.status, reply.text).toBe(200);
  expect(Object.keys(reply.body as object), reply.text).toEqual(ORGANIZER_KEYS);
  return reply.body as OrganizerEvent;
}

function ids(people: Person[]): string[] {
  return sorted(people.map((p) => p.registrationId));
}

function regIds(rows: { registration_id: string }[]): string[] {
  return sorted(rows.map((r) => r.registration_id));
}

type RegistrationState = { id: string; status: string; cancelled_at: Date | null; checked_in_at: Date | null };

async function registrationState(id: string): Promise<RegistrationState> {
  const { rows } = await db.pool.query<RegistrationState>(
    "SELECT id, status, cancelled_at, checked_in_at FROM registrations WHERE id = $1",
    [id],
  );
  return rows[0];
}

function checkIn(code: string): Promise<Reply> {
  return call(api, "POST", "/checkin", { cookie: owner.cookie, body: { ticket_code: code } });
}

describe("ER61: guards", () => {
  it("answers 401 without a login and 403 for an attendee, and writes nothing", async () => {
    const { eventId } = await mixedEvent();
    const visitor = await attendee(db.pool);
    const before = await allTables(db.pool);
    expectError(await cancelEvent(api, eventId), 401, "not_logged_in");
    expectError(await cancelEvent(api, "abc"), 401, "not_logged_in");
    expectError(await cancelEvent(api, eventId, visitor.cookie), 403, "wrong_role");
    expectError(await cancelEvent(api, "abc", visitor.cookie), 403, "wrong_role");
    expect(await allTables(db.pool)).toEqual(before);
  });
});

describe("ER62: 404, one body", () => {
  it("answers the same 404 for a malformed id, an unknown event and another organizer's event", async () => {
    const foreign = await mixedEvent();
    await db.pool.query("UPDATE events SET organizer_id = $2 WHERE id = $1", [foreign.eventId, stranger.id]);
    const before = await eventState(db.pool, foreign.eventId);

    const replies = [await cancelEvent(api, UNKNOWN_ID, owner.cookie), await cancelEvent(api, foreign.eventId, owner.cookie)];
    for (const id of MALFORMED_IDS) {
      let reply;
      const calls = await databaseCalls(db.pool, async () => {
        reply = await cancelEvent(api, encodeURIComponent(id), owner.cookie);
      });
      expect(calls, id).toBe(0);
      replies.push(reply!);
    }
    for (const reply of replies) {
      expectError(reply, 404, "not_found");
      expect(reply.text).toBe(replies[0].text);
    }
    expect(await eventState(db.pool, foreign.eventId)).toEqual(before);
  });

  it("the 404 bodies of both routes are the same", async () => {
    const a = await cancelEvent(api, UNKNOWN_ID, owner.cookie);
    const b = await reschedule(api, UNKNOWN_ID, { starts_at: "2030-05-01T10:00:00Z" }, owner.cookie);
    expect(a.text).toBe(b.text);
    expectError(a, 404, "not_found");
  });
});

describe("ER64: state check under the lock, cancel (tests first)", () => {
  it("answers 409 event_passed for an ended event and writes nothing", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { startsAt: fromNow(-3 * HOUR), durationMinutes: 60 });
    await person(db.pool, eventId);
    const before = await eventState(db.pool, eventId);
    expectError(await cancelEvent(api, eventId, owner.cookie), 409, "event_passed");
    expect(await eventState(db.pool, eventId)).toEqual(before);
  });

  it("answers 409 event_started for a running event and writes nothing", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { startsAt: fromNow(-10 * MINUTE), durationMinutes: 60 });
    await person(db.pool, eventId);
    await person(db.pool, eventId, "waitlisted");
    const before = await eventState(db.pool, eventId);
    expectError(await cancelEvent(api, eventId, owner.cookie), 409, "event_started");
    expect(await eventState(db.pool, eventId)).toEqual(before);
  });

  it("now = starts_at is event_started", async () => {
    const start = fromNow(2 * HOUR);
    const eventId = await insertEvent(db.pool, owner.id, { startsAt: start, durationMinutes: 60 });
    setNow(start);
    expectError(await cancelEvent(api, eventId, owner.cookie), 409, "event_started");
  });

  it("now = ends_at is event_passed", async () => {
    const start = fromNow(2 * HOUR);
    const eventId = await insertEvent(db.pool, owner.id, { startsAt: start, durationMinutes: 60 });
    setNow(new Date(start.getTime() + 60 * MINUTE));
    expectError(await cancelEvent(api, eventId, owner.cookie), 409, "event_passed");
  });

  it("one ms before starts_at is allowed", async () => {
    const start = fromNow(2 * HOUR);
    const eventId = await insertEvent(db.pool, owner.id, { startsAt: start, durationMinutes: 60 });
    setNow(new Date(start.getTime() - 1));
    expect(asEvent(await cancelEvent(api, eventId, owner.cookie)).status).toBe("cancelled");
  });
});

describe("ER73: cancel an active event in the future", () => {
  it("sets status cancelled and cancelled_at once, and keeps the rest", async () => {
    const { eventId } = await mixedEvent();
    const before = await eventState(db.pool, eventId);
    const startedAt = Date.now();

    const event = asEvent(await cancelEvent(api, eventId, owner.cookie));
    expect(event.status).toBe("cancelled");
    expect(event.cancelled_at).toMatch(ISO_UTC);
    expect(Math.abs(Date.parse(event.cancelled_at!) - startedAt)).toBeLessThan(5 * MINUTE);

    const after = await eventState(db.pool, eventId);
    expect(after.event).toEqual({
      ...before.event,
      status: "cancelled",
      cancelled_at: expect.any(Date),
    });
    expect((after.event!.cancelled_at as Date).toISOString()).toBe(event.cancelled_at);
    expect(event).toMatchObject({
      starts_at: S.toISOString(),
      schedule_version: 1,
      duration_minutes: 60,
      capacity: 10,
    });
  });
});

describe("ER74: registrations of the cancelled event", () => {
  it("moves registered (not checked in) and waiting people to cancelled at the event's instant, and keeps the rest", async () => {
    const { eventId, registered, waiting, cancelled, checkedIn, elsewhere } = await mixedEvent({ capacity: 2 });
    const before = await eventState(db.pool, eventId);
    const oldCancelled = await registrationState(cancelled.registrationId);
    const elsewhereBefore = await registrationState(elsewhere.registrationId);

    asEvent(await cancelEvent(api, eventId, owner.cookie));

    for (const p of [...registered, waiting]) {
      expect((await registrationState(p.registrationId)).status).toBe("cancelled");
    }
    const { rows } = await db.pool.query<{ same: boolean }>(
      `SELECT r.cancelled_at = e.cancelled_at AS same FROM registrations r JOIN events e ON e.id = r.event_id
        WHERE r.id = ANY($1::uuid[])`,
      [[...registered, waiting].map((p) => p.registrationId)],
    );
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.same)).toBe(true);

    expect(await registrationState(cancelled.registrationId)).toEqual(oldCancelled);
    const seated = await registrationState(checkedIn.registrationId);
    expect(seated.status).toBe("registered");
    expect(seated.checked_in_at).not.toBeNull();
    expect(await registrationState(elsewhere.registrationId)).toEqual(elsewhereBefore);

    // Kept columns: id, ticket_code, user_id, queue_no, created_at.
    const after = await eventState(db.pool, eventId);
    const keep = (r: Record<string, unknown>) => [r.id, r.ticket_code, r.user_id, r.queue_no, r.created_at];
    expect(after.registrations.map(keep)).toEqual(before.registrations.map(keep));

    // Nobody is promoted.
    const kinds = (await outboxOf(db.pool, eventId)).map((r) => r.kind);
    expect(kinds).not.toContain("promotion");
    expect(after.registrations.filter((r) => r.status === "registered")).toHaveLength(1);
  });
});

describe("ER75: event_cancelled rows", () => {
  it("writes one row per moved registration with the version, start, email and text, no ticket code", async () => {
    const { eventId, registered, waiting, cancelled, checkedIn } = await mixedEvent({ title: "Rust & Tea" });
    await db.pool.query("UPDATE events SET schedule_version = 3 WHERE id = $1", [eventId]);

    asEvent(await cancelEvent(api, eventId, owner.cookie));

    const rows = await outboxOf(db.pool, eventId, "event_cancelled");
    const moved = [...registered, waiting];
    expect(regIds(rows)).toEqual(ids(moved));
    expect(regIds(rows)).not.toContain(cancelled.registrationId);
    expect(regIds(rows)).not.toContain(checkedIn.registrationId);
    for (const row of rows) {
      const who = moved.find((p) => p.registrationId === row.registration_id)!;
      expect(row).toMatchObject({
        schedule_version: 3,
        event_starts_at: S,
        to_email: who.email,
        status: "pending",
        sent_at: null,
        subject: "Cancelled: Rust & Tea",
        body: "Rust & Tea\nWas to start: 2030-04-01 10:00 (UTC)\nThe event has been cancelled.",
      });
      expect(row.body).not.toContain(who.ticketCode);
    }
  });
});

describe("ER76: idempotent (tests first)", () => {
  it("a second cancel answers 200 with the same event and writes nothing", async () => {
    const { eventId } = await mixedEvent();
    const first = asEvent(await cancelEvent(api, eventId, owner.cookie));
    const before = await eventState(db.pool, eventId);
    const second = asEvent(await cancelEvent(api, eventId, owner.cookie));
    expect(second).toEqual(first);
    expect(await eventState(db.pool, eventId)).toEqual(before);
  });

  it("is 200 also when the cancelled event has started or passed meanwhile", async () => {
    for (const start of [fromNow(-10 * MINUTE), fromNow(-3 * DAY)]) {
      const eventId = await insertEvent(db.pool, owner.id, { startsAt: start, durationMinutes: 60, status: "cancelled" });
      await db.pool.query("UPDATE events SET cancelled_at = now() - interval '5 days' WHERE id = $1", [eventId]);
      await person(db.pool, eventId, "cancelled");
      const before = await eventState(db.pool, eventId);
      const event = asEvent(await cancelEvent(api, eventId, owner.cookie));
      expect(event.status).toBe("cancelled");
      expect(event.cancelled_at).toBe((before.event!.cancelled_at as Date).toISOString());
      expect(await eventState(db.pool, eventId)).toEqual(before);
    }
  });

  it("two parallel cancels: both 200, one row per person, cancelled_at of the first", async () => {
    for (let round = 0; round < 5; round++) {
      const { eventId, registered, waiting } = await mixedEvent();
      const replies = await Promise.all([cancelEvent(api, eventId, owner.cookie), cancelEvent(api, eventId, owner.cookie)]);
      const [a, b] = replies.map(asEvent);
      expect(a.cancelled_at).toBe(b.cancelled_at);
      const { event } = await eventState(db.pool, eventId);
      expect((event!.cancelled_at as Date).toISOString()).toBe(a.cancelled_at);
      expect(regIds(await outboxOf(db.pool, eventId, "event_cancelled"))).toEqual(ids([...registered, waiting]));
    }
  });
});

describe("ER77: cancel against register, the event lock (tests first)", () => {
  it("waits for the same FOR UPDATE lock on the event as the register service", async () => {
    const { eventId } = await mixedEvent();
    const client = await db.pool.connect();
    let done = false;
    let pending: Promise<Reply> | undefined;
    let blocked: number | null | undefined;
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM events WHERE id = $1 FOR UPDATE", [eventId]);
      const holder = await backendPid(client);
      pending = cancelEvent(api, eventId, owner.cookie).finally(() => {
        done = true;
      });
      blocked = await waitUntilBlockedBy(db.pool, holder, () => done);
      expect((await eventState(db.pool, eventId)).event?.status).toBe("active");
    } finally {
      await client.query("COMMIT");
      client.release();
    }
    expect((await pending!).status).toBe(200);
    expect(blocked).not.toBeNull();
  });

  it("one cancel and 20 parallel registrations: every answer is consistent, nobody is left seated or waiting", async () => {
    for (let round = 0; round < 5; round++) {
      const eventId = await insertEvent(db.pool, owner.id, { startsAt: S, capacity: 5 });
      const people = await attendees(db.pool, 20);
      const calls: Promise<Reply>[] = people.map((p) => register(api, eventId, p.cookie));
      calls.splice(10, 0, cancelEvent(api, eventId, owner.cookie));
      const replies = await Promise.all(calls);
      const [cancelled] = replies.splice(10, 1);
      expect(asEvent(cancelled).status).toBe("cancelled");

      for (const reply of replies) {
        if (reply.status === 409) expectError(reply, 409, "event_cancelled");
        else expect(reply.status, reply.text).toBe(201);
      }
      const created = replies.filter((r) => r.status === 201).length;

      const { registrations } = await eventState(db.pool, eventId);
      expect(registrations).toHaveLength(created);
      expect(registrations.filter((r) => r.status !== "cancelled")).toEqual([]);

      const notices = await outboxOf(db.pool, eventId, "event_cancelled");
      expect(regIds(notices)).toEqual(sorted(registrations.map((r) => r.id as string)));
      // A refused registration made no row, so it has no email either.
      const userIds = new Set(registrations.map((r) => r.user_id));
      for (const [i, reply] of replies.entries()) {
        if (reply.status === 409) expect(userIds.has(people[i].id)).toBe(false);
      }
      // The ticket emails of the seated ones stay queued.
      expect((await outboxOf(db.pool, eventId, "ticket")).length).toBe(Math.min(created, 5));
    }
  });
});

describe("ER78: cancel against check-in", () => {
  it("either the check-in wins (no email) or the cancel wins (409, cancelled, email); never both, never 500", async () => {
    for (let round = 0; round < 10; round++) {
      const eventId = await insertEvent(db.pool, owner.id, { startsAt: S });
      const guest = await person(db.pool, eventId);
      const [checked, cancelled] = await Promise.all([checkIn(guest.ticketCode), cancelEvent(api, eventId, owner.cookie)]);
      expect(asEvent(cancelled).status).toBe("cancelled");

      const state = await registrationState(guest.registrationId);
      const notices = await outboxOf(db.pool, eventId, "event_cancelled");
      if (checked.status === 200) {
        expect(state.status).toBe("registered");
        expect(state.checked_in_at).not.toBeNull();
        expect(notices).toEqual([]);
      } else {
        expectError(checked, 409, "event_cancelled");
        expect(state.status).toBe("cancelled");
        expect(state.checked_in_at).toBeNull();
        expect(regIds(notices)).toEqual([guest.registrationId]);
      }
    }
  });
});

describe("ER79: queued reminders on cancel (tests first)", () => {
  it("deletes pending reminders of every version and keeps sent, error_sending and other kinds", async () => {
    const { eventId, registered, waiting, otherEventId, elsewhere } = await mixedEvent();
    const [first, second] = registered;
    const v1 = await insertOutbox(db.pool, first.registrationId, { kind: "reminder", scheduleVersion: 1 });
    const v2 = await insertOutbox(db.pool, second.registrationId, { kind: "reminder", scheduleVersion: 2 });
    const sent = await insertOutbox(db.pool, first.registrationId, {
      kind: "reminder",
      scheduleVersion: 3,
      status: "sent",
      sentAt: new Date(),
    });
    const failed = await insertOutbox(db.pool, second.registrationId, {
      kind: "reminder",
      scheduleVersion: 3,
      status: "error_sending",
      sendAttempts: 3,
      sendError: "boom",
    });
    const ticket = await insertOutbox(db.pool, first.registrationId, { kind: "ticket" });
    const promotion = await insertOutbox(db.pool, waiting.registrationId, { kind: "promotion" });
    const moved = await insertOutbox(db.pool, waiting.registrationId, { kind: "reschedule", scheduleVersion: 2 });
    const otherEvent = await insertOutbox(db.pool, elsewhere.registrationId, { kind: "reminder" });

    asEvent(await cancelEvent(api, eventId, owner.cookie));

    const rows = await outboxOf(db.pool, eventId);
    const left = rows.map((r) => r.id);
    expect(left).not.toContain(v1);
    expect(left).not.toContain(v2);
    for (const id of [sent, failed, ticket, promotion, moved]) expect(left).toContain(id);
    for (const id of [ticket, promotion, moved]) expect(rows.find((r) => r.id === id)?.status).toBe("pending");
    expect((await outboxOf(db.pool, otherEventId)).map((r) => r.id)).toContain(otherEvent);
  });

  it("the reminder worker writes nothing for the event afterwards, also inside the window", async () => {
    const start = new Date("2032-01-10T10:00:00.000Z");
    const eventId = await insertEvent(db.pool, owner.id, { startsAt: start });
    await person(db.pool, eventId);
    await person(db.pool, eventId);
    asEvent(await cancelEvent(api, eventId, owner.cookie));
    await enqueueReminders(db.pool, new Date(start.getTime() - HOUR));
    expect(await outboxOf(db.pool, eventId, "reminder")).toEqual([]);
  });
});

describe("ER80: register on an event cancelled through the route", () => {
  it("answers 409 event_cancelled for someone with a registration and for someone with none; nothing is written", async () => {
    const { eventId, registered } = await mixedEvent();
    asEvent(await cancelEvent(api, eventId, owner.cookie));
    const newcomer = await attendee(db.pool);
    const before = await allTables(db.pool);
    expectError(await register(api, eventId, registered[0].cookie), 409, "event_cancelled");
    expectError(await register(api, eventId, newcomer.cookie), 409, "event_cancelled");
    expect(await allTables(db.pool)).toEqual(before);
  });
});

describe("ER81: check-in on an event cancelled through the route", () => {
  it("answers 409 event_cancelled for a moved ticket and for a checked-in one; nothing changes", async () => {
    const { eventId, registered, checkedIn } = await mixedEvent();
    asEvent(await cancelEvent(api, eventId, owner.cookie));
    const before = await allTables(db.pool);
    expectError(await checkIn(registered[0].ticketCode), 409, "event_cancelled");
    expectError(await checkIn(checkedIn.ticketCode), 409, "event_cancelled");
    expect(await allTables(db.pool)).toEqual(before);
  });

  it("reschedule of the cancelled event answers 409 event_cancelled (ER64)", async () => {
    const { eventId } = await mixedEvent();
    asEvent(await cancelEvent(api, eventId, owner.cookie));
    const before = await eventState(db.pool, eventId);
    expectError(
      await reschedule(api, eventId, { starts_at: "2030-05-01T10:00:00Z" }, owner.cookie),
      409,
      "event_cancelled",
    );
    expect(await eventState(db.pool, eventId)).toEqual(before);
  });
});

describe("ER82, ER83: routes of M4, not built yet", () => {
  it.todo("ER82: capacity change on a cancelled event answers 409 event_cancelled, on a passed one event_passed");
  it.todo("ER83: cancelling one's own registration on a cancelled event is a 200 no-op, nobody is promoted");
});

describe("ER85: reads after a cancel", () => {
  it("every read shows the cancelled event and the real numbers", async () => {
    const { eventId, registered, waiting, checkedIn } = await mixedEvent({ capacity: 10 });
    const ticketBefore = await call(api, "GET", `/events/${eventId}/registrations/me`, { cookie: registered[0].cookie });
    asEvent(await cancelEvent(api, eventId, owner.cookie));

    const own = await call(api, "GET", `/events/${eventId}`, { cookie: owner.cookie });
    expect(own.body).toMatchObject({ status: "cancelled", cancelled_at: expect.stringMatching(ISO_UTC), registered: 1, seats_left: 9 });

    const pub = await call(api, "GET", `/public/events/${eventId}`);
    expect(pub.body).toMatchObject({ status: "cancelled", seats_left: 0, full: false });

    const listed = await call(api, "GET", "/public/events");
    expect((listed.body as { events: { id: string }[] }).events.map((e) => e.id)).not.toContain(eventId);

    const ticket = await call(api, "GET", `/events/${eventId}/registrations/me`, { cookie: registered[0].cookie });
    expect(ticket.status).toBe(200);
    expect(ticket.body).toMatchObject({
      status: "cancelled",
      ticket_code: (ticketBefore.body as { ticket_code: string }).ticket_code,
      waitlist_position: null,
    });

    const mine = await call(api, "GET", "/me/registrations", { cookie: waiting.cookie });
    const row = (mine.body as { registrations: { event_id: string; status: string; event_status: string }[] })
      .registrations.find((r) => r.event_id === eventId);
    expect(row).toMatchObject({ status: "cancelled", event_status: "cancelled" });

    const list = await call(api, "GET", `/events/${eventId}/registrations`, { cookie: owner.cookie });
    const people = (list.body as { registrations: { id: string; status: string }[] }).registrations;
    expect(people.map((p) => p.id)).toEqual([checkedIn.registrationId]);
    expect(people.every((p) => p.status === "registered")).toBe(true);

    const arrivals = await call(api, "GET", `/events/${eventId}/arrivals`, { cookie: owner.cookie });
    expect(arrivals.body).toEqual({ capacity: 10, registered: 1, arrived: 1 });
  });

  // The per-registration emails route of ER48-ER60 is not built yet.
  it.todo("GET /events/:id/registrations/:registrationId/emails shows the event_cancelled row (ER48 route not built)");
});

describe("ER86: shapes", () => {
  it("answers exactly the organizer event keys with numbers and ISO dates", async () => {
    const { eventId } = await mixedEvent();
    const reply = await cancelEvent(api, eventId, owner.cookie);
    const event = asEvent(reply);
    expect(reply.text).not.toContain("organizer_id");
    expect(typeof event.registered).toBe("number");
    expect(typeof event.seats_left).toBe("number");
    expect(typeof event.schedule_version).toBe("number");
    expect(event.registered).toBe(1);
    for (const key of ["starts_at", "ends_at", "created_at", "cancelled_at"] as const) {
      expect(event[key]).toMatch(ISO_UTC);
    }
  });

  it("a 409 body has only the error key", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { startsAt: fromNow(-10 * MINUTE), durationMinutes: 60 });
    const reply = await cancelEvent(api, eventId, owner.cookie);
    expect(reply.text).toBe('{"error":"event_started"}');
  });
});

describe("ER87: scope of writes", () => {
  it("changes only events.status, events.cancelled_at, registrations.status, registrations.cancelled_at and outbox, and logs nothing", async () => {
    const { eventId, registered, waiting } = await mixedEvent();
    const before = await allTables(db.pool);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let event: OrganizerEvent;
    try {
      event = asEvent(await cancelEvent(api, eventId, owner.cookie));
      expect(log).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
    const after = await allTables(db.pool);
    for (const table of ["organizers", "users"]) expect(after[table], table).toEqual(before[table]);
    const at = new Date(event!.cancelled_at!);
    const stamp = (row: Record<string, unknown>) =>
      row.cancelled_at instanceof Date ? { ...row, cancelled_at: new Date(row.cancelled_at.toISOString()) } : row;
    expect(after.events.map(stamp)).toEqual(
      before.events.map((e) => (e.id === eventId ? { ...e, status: "cancelled", cancelled_at: at } : e)).map(stamp),
    );
    const moved = new Set([...registered, waiting].map((p) => p.registrationId));
    expect(after.registrations.map(stamp)).toEqual(
      before.registrations
        .map((r) => (moved.has(r.id as string) ? { ...r, status: "cancelled", cancelled_at: at } : r))
        .map(stamp),
    );
    const newRows = after.outbox.filter((o) => !before.outbox.some((b) => b.id === o.id));
    expect(newRows.map((o) => o.kind)).toEqual(["event_cancelled", "event_cancelled", "event_cancelled"]);
  });

  it("rolls back and answers 500 internal when a statement fails; nothing is written", async () => {
    const { eventId, registered } = await mixedEvent();
    await insertOutbox(db.pool, registered[0].registrationId, { kind: "reminder" });
    const before = await eventState(db.pool, eventId);
    const undo = failStatement(db.pool, "DELETE FROM outbox");
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expectError(await cancelEvent(api, eventId, owner.cookie), 500, "internal");
    } finally {
      undo();
      error.mockRestore();
    }
    expect(await eventState(db.pool, eventId)).toEqual(before);
    expect(asEvent(await cancelEvent(api, eventId, owner.cookie)).status).toBe("cancelled");
  });
});
