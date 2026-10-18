import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import type { Running } from "../auth/helpers.js";
import { enqueueReminders } from "../../src/email/reminders.js";
import { sendPending } from "../../src/email/sender.js";
import {
  backendPid,
  createTestDb,
  insertEvent,
  insertOutbox,
  waitUntilBlockedBy,
  type TestDb,
} from "../db/helpers.js";
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

// POST /events/:id/reschedule (email-reminders.md ER61-ER71, ER84, ER86, ER87;
// B8, DATABASE.md 3.6; roadmap step 36). Tests first: ER64, ER65, ER69, ER70,
// ER71 (and ER72 in api/test/email/reminders.test.ts).

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

// Moves the clock of this process (the app runs in it) to `at`. Only Date is faked.
function setNow(at: Date): void {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(at);
}

const A = new Date("2030-03-01T10:00:00.000Z");
const B = new Date("2030-03-05T10:00:00.000Z");

// An event at `startsAt` with two registered people, one waiting, one cancelled
// and one checked in, and a registration of another event of the same owner.
async function mixedEvent(options: { startsAt?: Date; title?: string; durationMinutes?: number } = {}) {
  const eventId = await insertEvent(db.pool, owner.id, {
    startsAt: options.startsAt ?? A,
    capacity: 10,
    title: options.title ?? "Spring Meetup",
    durationMinutes: options.durationMinutes ?? 90,
  });
  const registered = [await person(db.pool, eventId), await person(db.pool, eventId)];
  const waiting = await person(db.pool, eventId, "waitlisted");
  const cancelled = await person(db.pool, eventId, "cancelled");
  const checkedIn = await person(db.pool, eventId, "checked_in");
  const otherEventId = await insertEvent(db.pool, owner.id, { startsAt: A });
  const elsewhere = await person(db.pool, otherEventId);
  return { eventId, registered, waiting, cancelled, checkedIn, otherEventId, elsewhere };
}

function asEvent(reply: { status: number; body: unknown; text: string }): OrganizerEvent {
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

describe("ER61: guards", () => {
  it("answers 401 without a login and 403 for an attendee, before the id and the body are looked at", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { startsAt: A });
    const person = await attendee(db.pool);
    const before = await allTables(db.pool);

    expectError(await reschedule(api, eventId, { starts_at: B.toISOString() }), 401, "not_logged_in");
    expectError(await reschedule(api, "abc", { starts_at: "nope" }), 401, "not_logged_in");
    expectError(await reschedule(api, eventId, { starts_at: B.toISOString() }, person.cookie), 403, "wrong_role");
    expectError(await reschedule(api, "abc", { starts_at: "nope" }, person.cookie), 403, "wrong_role");

    expect(await allTables(db.pool)).toEqual(before);
  });
});

describe("ER62: 404, one body", () => {
  it("answers the same 404 for a malformed id, an unknown event and another organizer's event", async () => {
    const foreign = await mixedEvent();
    await db.pool.query("UPDATE events SET organizer_id = $2 WHERE id = $1", [foreign.eventId, stranger.id]);
    const before = await eventState(db.pool, foreign.eventId);
    const body = { starts_at: B.toISOString() };

    const replies = [
      await reschedule(api, UNKNOWN_ID, body, owner.cookie),
      await reschedule(api, foreign.eventId, body, owner.cookie),
    ];
    for (const id of MALFORMED_IDS) {
      let reply;
      const calls = await databaseCalls(db.pool, async () => {
        reply = await reschedule(api, encodeURIComponent(id), body, owner.cookie);
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
});

describe("ER63: reschedule validation", () => {
  const bad: [string, unknown][] = [
    ["an array", [{ starts_at: "2030-03-05T10:00:00Z" }]],
    ["a string", "2030-03-05T10:00:00Z"],
    ["no starts_at", {}],
    ["starts_at null", { starts_at: null }],
    ["starts_at a number", { starts_at: Date.parse("2030-03-05T10:00:00Z") }],
    ["a date only", { starts_at: "2030-03-05" }],
    ["no offset", { starts_at: "2030-03-05T10:00:00" }],
    ["another format", { starts_at: "05.03.2030 10:00" }],
    ["an impossible date", { starts_at: "2030-02-30T10:00:00Z" }],
    ["an impossible time", { starts_at: "2030-03-05T24:30:00Z" }],
    ["a past time", { starts_at: "2020-01-01T10:00:00Z" }],
  ];
  for (const [label, body] of bad) {
    it(`answers 400 invalid_input for ${label}, before any query`, async () => {
      const eventId = await insertEvent(db.pool, owner.id, { startsAt: A });
      let reply;
      const calls = await databaseCalls(db.pool, async () => {
        reply = await reschedule(api, eventId, body, owner.cookie);
      });
      expectError(reply!, 400, "invalid_input");
      expect(calls).toBe(0);
    });
  }

  it("answers 400 for a start exactly at now", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { startsAt: A });
    const before = await eventState(db.pool, eventId);
    const now = fromNow(0);
    setNow(now);
    expectError(await reschedule(api, eventId, { starts_at: now.toISOString() }, owner.cookie), 400, "invalid_input");
    vi.useRealTimers();
    expect(await eventState(db.pool, eventId)).toEqual(before);
  });

  it("answers 400 for a missing body", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { startsAt: A });
    expectError(await call(api, "POST", `/events/${eventId}/reschedule`, { cookie: owner.cookie }), 400, "invalid_input");
  });

  it("decides a bad body before a closed or foreign event", async () => {
    const closed = await insertEvent(db.pool, owner.id, { startsAt: A, status: "cancelled" });
    const foreign = await insertEvent(db.pool, stranger.id, { startsAt: A });
    expectError(await reschedule(api, closed, { starts_at: "nope" }, owner.cookie), 400, "invalid_input");
    expectError(await reschedule(api, foreign, { starts_at: "nope" }, owner.cookie), 400, "invalid_input");
  });

  it("ignores other body fields", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { startsAt: A, title: "Kept", capacity: 7, durationMinutes: 45 });
    const event = asEvent(
      await reschedule(
        api,
        eventId,
        {
          starts_at: B.toISOString(),
          title: "Changed",
          capacity: 1,
          duration_minutes: 5,
          status: "cancelled",
          schedule_version: 99,
          description: "x",
        },
        owner.cookie,
      ),
    );
    expect(event).toMatchObject({
      title: "Kept",
      description: "",
      capacity: 7,
      duration_minutes: 45,
      status: "active",
      schedule_version: 2,
      starts_at: B.toISOString(),
    });
  });
});

describe("ER64: state check under the lock, reschedule (tests first)", () => {
  it("answers 409 event_cancelled for a cancelled event and writes nothing", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { startsAt: A, status: "cancelled" });
    await person(db.pool, eventId, "cancelled");
    const before = await eventState(db.pool, eventId);
    expectError(await reschedule(api, eventId, { starts_at: B.toISOString() }, owner.cookie), 409, "event_cancelled");
    expect(await eventState(db.pool, eventId)).toEqual(before);
  });

  it("cancelled wins over passed", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { startsAt: fromNow(-3 * DAY), status: "cancelled" });
    expectError(await reschedule(api, eventId, { starts_at: B.toISOString() }, owner.cookie), 409, "event_cancelled");
  });

  it("answers 409 event_passed for an ended event and writes nothing", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { startsAt: fromNow(-3 * HOUR), durationMinutes: 60 });
    await person(db.pool, eventId);
    const before = await eventState(db.pool, eventId);
    expectError(await reschedule(api, eventId, { starts_at: B.toISOString() }, owner.cookie), 409, "event_passed");
    expect(await eventState(db.pool, eventId)).toEqual(before);
  });

  it("answers 409 event_started for a running event and writes nothing", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { startsAt: fromNow(-10 * MINUTE), durationMinutes: 60 });
    await person(db.pool, eventId);
    const before = await eventState(db.pool, eventId);
    expectError(await reschedule(api, eventId, { starts_at: B.toISOString() }, owner.cookie), 409, "event_started");
    expect(await eventState(db.pool, eventId)).toEqual(before);
  });

  it("checks the state before the same-time no-op", async () => {
    const start = fromNow(-10 * MINUTE);
    const eventId = await insertEvent(db.pool, owner.id, { startsAt: start, durationMinutes: 60 });
    const passed = await insertEvent(db.pool, owner.id, { startsAt: fromNow(-3 * HOUR), durationMinutes: 60 });
    const cancelled = await insertEvent(db.pool, owner.id, { startsAt: A, status: "cancelled" });
    // A future time is needed by the body check; for the running and passed
    // events the stored start is in the past, so this cannot be the same time.
    expectError(await reschedule(api, eventId, { starts_at: B.toISOString() }, owner.cookie), 409, "event_started");
    expectError(await reschedule(api, passed, { starts_at: B.toISOString() }, owner.cookie), 409, "event_passed");
    expectError(await reschedule(api, cancelled, { starts_at: A.toISOString() }, owner.cookie), 409, "event_cancelled");
  });

  describe("edges", () => {
    it("now = starts_at is event_started", async () => {
      const start = fromNow(2 * HOUR);
      const eventId = await insertEvent(db.pool, owner.id, { startsAt: start, durationMinutes: 60 });
      setNow(start);
      const reply = await reschedule(api, eventId, { starts_at: new Date(start.getTime() + DAY).toISOString() }, owner.cookie);
      expectError(reply, 409, "event_started");
    });

    it("now = ends_at is event_passed", async () => {
      const start = fromNow(2 * HOUR);
      const eventId = await insertEvent(db.pool, owner.id, { startsAt: start, durationMinutes: 60 });
      setNow(new Date(start.getTime() + 60 * MINUTE));
      const reply = await reschedule(api, eventId, { starts_at: new Date(start.getTime() + DAY).toISOString() }, owner.cookie);
      expectError(reply, 409, "event_passed");
    });

    it("one ms before starts_at is allowed", async () => {
      const start = fromNow(2 * HOUR);
      const eventId = await insertEvent(db.pool, owner.id, { startsAt: start, durationMinutes: 60 });
      setNow(new Date(start.getTime() - 1));
      const to = new Date(start.getTime() + DAY);
      const event = asEvent(await reschedule(api, eventId, { starts_at: to.toISOString() }, owner.cookie));
      expect(event).toMatchObject({ starts_at: to.toISOString(), schedule_version: 2 });
    });
  });
});

describe("ER65: same time is a no-op (tests first)", () => {
  for (const [label, text] of [
    ["the same text", "2030-03-01T10:00:00.000Z"],
    ["another offset", "2030-03-01T12:00:00+02:00"],
    ["no seconds", "2030-03-01T10:00Z"],
  ]) {
    it(`answers 200 with the unchanged event for ${label} and touches nothing`, async () => {
      const { eventId, registered } = await mixedEvent();
      await insertOutbox(db.pool, registered[0].registrationId, { kind: "reminder", status: "pending" });
      const read = await call(api, "GET", `/events/${eventId}`, { cookie: owner.cookie });
      const before = await eventState(db.pool, eventId);

      const reply = await reschedule(api, eventId, { starts_at: text }, owner.cookie);
      expect(asEvent(reply)).toEqual(read.body);
      expect((reply.body as OrganizerEvent).schedule_version).toBe(1);
      expect(await eventState(db.pool, eventId)).toEqual(before);
    });
  }
});

describe("ER66: a new time", () => {
  it("moves the start, bumps the version by one, keeps the duration and everything else", async () => {
    const { eventId } = await mixedEvent({ durationMinutes: 90 });
    const before = await eventState(db.pool, eventId);

    const event = asEvent(await reschedule(api, eventId, { starts_at: "2030-03-05T12:30:00+02:00" }, owner.cookie));
    expect(event).toMatchObject({
      starts_at: "2030-03-05T10:30:00.000Z",
      ends_at: "2030-03-05T12:00:00.000Z",
      duration_minutes: 90,
      schedule_version: 2,
      status: "active",
      cancelled_at: null,
    });

    const after = await eventState(db.pool, eventId);
    expect(after.event).toEqual({
      ...before.event,
      starts_at: new Date("2030-03-05T10:30:00.000Z"),
      schedule_version: 2,
    });
    expect(after.registrations).toEqual(before.registrations);

    const second = asEvent(await reschedule(api, eventId, { starts_at: B.toISOString() }, owner.cookie));
    expect(second.schedule_version).toBe(3);
    expect(second.ends_at).toBe("2030-03-05T11:30:00.000Z");
  });
});

describe("ER67: one reschedule row per waiting or not checked-in registered person", () => {
  it("writes rows for registered and waiting people only, with the new version and start", async () => {
    const { eventId, registered, waiting, cancelled, checkedIn, otherEventId } = await mixedEvent();
    asEvent(await reschedule(api, eventId, { starts_at: B.toISOString() }, owner.cookie));

    const rows = await outboxOf(db.pool, eventId, "reschedule");
    expect(regIds(rows)).toEqual(ids([...registered, waiting]));
    const got = regIds(rows);
    expect(got).not.toContain(cancelled.registrationId);
    expect(got).not.toContain(checkedIn.registrationId);
    for (const row of rows) {
      const who = [...registered, waiting].find((p) => p.registrationId === row.registration_id)!;
      expect(row).toMatchObject({
        schedule_version: 2,
        event_starts_at: B,
        to_email: who.email,
        status: "pending",
        sent_at: null,
      });
    }
    expect(await outboxOf(db.pool, otherEventId, "reschedule")).toEqual([]);
  });
});

describe("ER68: the reschedule text", () => {
  it("has the title in the subject and the title, new start and previous start in the body, no ticket code", async () => {
    const { eventId, registered, waiting } = await mixedEvent({ title: "Rust & Tea" });
    asEvent(await reschedule(api, eventId, { starts_at: "2030-03-05T10:00:00Z" }, owner.cookie));
    const rows = await outboxOf(db.pool, eventId, "reschedule");
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.subject).toBe("Rescheduled: Rust & Tea");
      expect(row.body).toBe("Rust & Tea\nNew start: 2030-03-05 10:00 (UTC)\nPrevious start: 2030-03-01 10:00 (UTC)");
    }
    for (const p of [...registered, waiting]) {
      for (const row of rows) expect(row.body).not.toContain(p.ticketCode);
    }
  });
});

describe("ER69: A -> B -> A -> B through the route (tests first)", () => {
  // Own times (2031), so no other event of this file is in the reminder window.
  const A = new Date("2031-05-01T08:00:00.000Z");
  const B = new Date("2031-05-04T08:00:00.000Z");

  it("each move bumps the version, emails every person and opens a fresh reminder", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { startsAt: A, capacity: 2, title: "Loop" });
    const seated = [await person(db.pool, eventId), await person(db.pool, eventId)];
    const waiting = await person(db.pool, eventId, "waitlisted");

    const moves = [B, A, B];
    for (const [i, to] of moves.entries()) {
      const version = i + 2;
      const event = asEvent(await reschedule(api, eventId, { starts_at: to.toISOString() }, owner.cookie));
      expect(event).toMatchObject({ starts_at: to.toISOString(), schedule_version: version });

      const moved = (await outboxOf(db.pool, eventId, "reschedule")).filter((r) => r.schedule_version === version);
      expect(regIds(moved), `move ${i + 1}`).toEqual(ids([...seated, waiting]));
      expect(moved.every((r) => r.event_starts_at.getTime() === to.getTime())).toBe(true);

      const now = new Date(to.getTime() - DAY);
      expect(await enqueueReminders(db.pool, now)).toBe(2);
      const reminders = (await outboxOf(db.pool, eventId, "reminder")).filter((r) => r.schedule_version === version);
      expect(regIds(reminders), `reminders of version ${version}`).toEqual(ids(seated));
      expect(await enqueueReminders(db.pool, now)).toBe(0);

      // The reminders of this version are sent (as the sender would), so the
      // next move keeps them (ER71 deletes only pending ones).
      await db.pool.query(
        `UPDATE outbox o SET status = 'sent', sent_at = now() FROM registrations r
          WHERE r.id = o.registration_id AND r.event_id = $1 AND o.kind = 'reminder'`,
        [eventId],
      );
    }

    const before = await eventState(db.pool, eventId);
    const repeat = asEvent(await reschedule(api, eventId, { starts_at: B.toISOString() }, owner.cookie));
    expect(repeat.schedule_version).toBe(4);
    expect(await eventState(db.pool, eventId)).toEqual(before);

    const reschedules = await outboxOf(db.pool, eventId, "reschedule");
    expect(reschedules.map((r) => r.schedule_version)).toEqual([2, 2, 2, 3, 3, 3, 4, 4, 4]);
    const reminders = await outboxOf(db.pool, eventId, "reminder");
    expect(reminders.map((r) => r.schedule_version)).toEqual([2, 2, 3, 3, 4, 4]);
  });
});

describe("ER70: concurrency, the event lock (tests first)", () => {
  it("waits for the same FOR UPDATE lock on the event as the register service", async () => {
    const { eventId } = await mixedEvent();
    const client = await db.pool.connect();
    let done = false;
    let pending: Promise<{ status: number }> | undefined;
    let blocked: number | null | undefined;
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM events WHERE id = $1 FOR UPDATE", [eventId]);
      const holder = await backendPid(client);
      pending = reschedule(api, eventId, { starts_at: B.toISOString() }, owner.cookie).finally(() => {
        done = true;
      });
      blocked = await waitUntilBlockedBy(db.pool, holder, () => done);
      expect(await outboxOf(db.pool, eventId, "reschedule")).toEqual([]);
    } finally {
      await client.query("COMMIT");
      client.release();
    }
    expect((await pending!).status).toBe(200);
    expect(blocked).not.toBeNull();
  });

  it("(a) two parallel reschedules to the same time: version +1 in total, one row per person", async () => {
    for (let round = 0; round < 5; round++) {
      const { eventId, registered, waiting } = await mixedEvent();
      const replies = await Promise.all([
        reschedule(api, eventId, { starts_at: B.toISOString() }, owner.cookie),
        reschedule(api, eventId, { starts_at: "2030-03-05T11:00:00+01:00" }, owner.cookie),
      ]);
      for (const reply of replies) asEvent(reply);
      const { event } = await eventState(db.pool, eventId);
      expect(event).toMatchObject({ schedule_version: 2, starts_at: B });
      expect(regIds(await outboxOf(db.pool, eventId, "reschedule"))).toEqual(ids([...registered, waiting]));
    }
  });

  it("(b) two parallel reschedules to different times: version +2, two rows per person", async () => {
    const C = new Date("2030-03-09T10:00:00.000Z");
    for (let round = 0; round < 5; round++) {
      const { eventId, registered, waiting } = await mixedEvent();
      const replies = await Promise.all([
        reschedule(api, eventId, { starts_at: B.toISOString() }, owner.cookie),
        reschedule(api, eventId, { starts_at: C.toISOString() }, owner.cookie),
      ]);
      for (const reply of replies) asEvent(reply);
      const { event } = await eventState(db.pool, eventId);
      expect(event?.schedule_version).toBe(3);
      const finalStart = (event?.starts_at as Date).getTime();
      expect([B.getTime(), C.getTime()]).toContain(finalStart);

      const rows = await outboxOf(db.pool, eventId, "reschedule");
      const people = [...registered, waiting];
      for (const p of people) {
        const mine = rows.filter((r) => r.registration_id === p.registrationId);
        expect(mine.map((r) => r.schedule_version)).toEqual([2, 3]);
      }
      const last = rows.filter((r) => r.schedule_version === 3);
      expect(last.every((r) => r.event_starts_at.getTime() === finalStart)).toBe(true);
      expect(rows).toHaveLength(2 * people.length);
    }
  });

  it("(c) a reschedule and a cancel at once: the event ends cancelled, the answers agree with the rows", async () => {
    for (let round = 0; round < 6; round++) {
      const { eventId, registered, waiting } = await mixedEvent();
      const people = [...registered, waiting];
      const [moved, cancelled] = await Promise.all([
        reschedule(api, eventId, { starts_at: B.toISOString() }, owner.cookie),
        cancelEvent(api, eventId, owner.cookie),
      ]);
      expect(cancelled.status, cancelled.text).toBe(200);
      const { event } = await eventState(db.pool, eventId);
      expect(event?.status).toBe("cancelled");

      const reschedules = await outboxOf(db.pool, eventId, "reschedule");
      const notices = await outboxOf(db.pool, eventId, "event_cancelled");
      expect(regIds(notices)).toEqual(ids(people));
      if (moved.status === 200) {
        expect(regIds(reschedules)).toEqual(ids(people));
        expect(event?.schedule_version).toBe(2);
        expect(notices.every((r) => r.schedule_version === 2 && r.event_starts_at.getTime() === B.getTime())).toBe(
          true,
        );
      } else {
        expectError(moved, 409, "event_cancelled");
        expect(reschedules).toEqual([]);
        expect(event?.schedule_version).toBe(1);
      }
    }
  });
});

describe("ER71: a reschedule deletes the pending reminders of older versions (tests first)", () => {
  it("deletes pending old-version reminders of this event and keeps sent, error_sending, other kinds and other events", async () => {
    const { eventId, registered, waiting, otherEventId, elsewhere } = await mixedEvent();
    const [first, second] = registered;
    const pendingOld = await insertOutbox(db.pool, first.registrationId, { kind: "reminder", scheduleVersion: 1 });
    const sentOld = await insertOutbox(db.pool, second.registrationId, {
      kind: "reminder",
      scheduleVersion: 1,
      status: "sent",
      sentAt: new Date(),
    });
    const failedOld = await insertOutbox(db.pool, waiting.registrationId, {
      kind: "reminder",
      scheduleVersion: 1,
      status: "error_sending",
      sendAttempts: 3,
      sendError: "boom",
    });
    const ticket = await insertOutbox(db.pool, first.registrationId, { kind: "ticket", scheduleVersion: 1 });
    const promotion = await insertOutbox(db.pool, second.registrationId, { kind: "promotion", scheduleVersion: 1 });
    const otherEvent = await insertOutbox(db.pool, elsewhere.registrationId, { kind: "reminder", scheduleVersion: 1 });

    asEvent(await reschedule(api, eventId, { starts_at: B.toISOString() }, owner.cookie));

    const left = (await outboxOf(db.pool, eventId)).map((r) => r.id);
    expect(left).not.toContain(pendingOld);
    for (const id of [sentOld, failedOld, ticket, promotion]) expect(left).toContain(id);
    expect((await outboxOf(db.pool, otherEventId)).map((r) => r.id)).toContain(otherEvent);
  });

  it("keeps a pending reminder of the current version written after an earlier move", async () => {
    const { eventId, registered } = await mixedEvent();
    asEvent(await reschedule(api, eventId, { starts_at: B.toISOString() }, owner.cookie));
    const current = await insertOutbox(db.pool, registered[0].registrationId, { kind: "reminder", scheduleVersion: 2 });
    asEvent(await reschedule(api, eventId, { starts_at: A.toISOString() }, owner.cookie));
    // Version 3 now: the version-2 pending reminder is old and goes.
    expect((await outboxOf(db.pool, eventId)).map((r) => r.id)).not.toContain(current);
  });

  it("does not delete a reminder the sender holds: it waits, sees it sent and leaves it", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { startsAt: A });
    const seat = await person(db.pool, eventId);
    // The oldest pending row of the schema, so the sender claims it first.
    const reminder = await insertOutbox(db.pool, seat.registrationId, {
      kind: "reminder",
      scheduleVersion: 1,
      createdAt: new Date("2000-01-01T00:00:00.000Z"),
    });

    const original = db.pool.connect.bind(db.pool) as () => Promise<pg.PoolClient>;
    let senderPid = 0;
    const connect = vi.spyOn(db.pool, "connect").mockImplementationOnce((async () => {
      const client = await original();
      senderPid = await backendPid(client);
      return client;
    }) as never);

    let release: () => void = () => undefined;
    let claimed: () => void = () => undefined;
    const isClaimed = new Promise<void>((resolve) => (claimed = resolve));
    const transport = vi.fn(async () => {
      claimed();
      await new Promise<void>((resolve) => (release = resolve));
    });
    const sending = sendPending(db.pool, { transport, batchSize: 1, log: () => undefined, onError: () => undefined });

    let done = false;
    let blocked: number | null | undefined;
    let moved: Promise<{ status: number; text: string }> | undefined;
    try {
      await isClaimed;
      connect.mockRestore();
      moved = reschedule(api, eventId, { starts_at: B.toISOString() }, owner.cookie).finally(() => {
        done = true;
      });
      blocked = await waitUntilBlockedBy(db.pool, senderPid, () => done);
    } finally {
      release();
    }
    expect(await sending).toBe(1);
    const reply = await moved!;
    expect(reply.status, reply.text).toBe(200);
    expect(blocked).not.toBeNull();

    const { rows } = await db.pool.query<{ status: string }>("SELECT status FROM outbox WHERE id = $1", [reminder]);
    expect(rows).toEqual([{ status: "sent" }]);
  });
});

describe("ER84: reads after a reschedule", () => {
  it("every read shows the new start and the same people", async () => {
    const { eventId, registered, waiting } = await mixedEvent({ durationMinutes: 90 });
    const listBefore = await call(api, "GET", `/events/${eventId}/registrations`, { cookie: owner.cookie });
    const publicBefore = await call(api, "GET", `/public/events/${eventId}`);
    const mineBefore = await call(api, "GET", `/events/${eventId}/registrations/me`, { cookie: registered[0].cookie });

    asEvent(await reschedule(api, eventId, { starts_at: B.toISOString() }, owner.cookie));
    const ends = "2030-03-05T11:30:00.000Z";

    const own = await call(api, "GET", `/events/${eventId}`, { cookie: owner.cookie });
    expect(own.body).toMatchObject({ starts_at: B.toISOString(), ends_at: ends, schedule_version: 2 });
    const list = await call(api, "GET", "/events", { cookie: owner.cookie });
    const item = (list.body as { events: OrganizerEvent[] }).events.find((e) => e.id === eventId);
    expect(item).toMatchObject({ starts_at: B.toISOString(), ends_at: ends, schedule_version: 2 });

    const pub = await call(api, "GET", `/public/events/${eventId}`);
    expect(pub.body).toEqual({
      ...(publicBefore.body as object),
      starts_at: B.toISOString(),
      ends_at: ends,
      has_started: false,
    });

    const mine = await call(api, "GET", "/me/registrations", { cookie: waiting.cookie });
    const row = (mine.body as { registrations: { event_id: string; event_starts_at: string }[] }).registrations.find(
      (r) => r.event_id === eventId,
    );
    expect(row?.event_starts_at).toBe(B.toISOString());

    const ticket = await call(api, "GET", `/events/${eventId}/registrations/me`, { cookie: registered[0].cookie });
    expect(ticket.body).toEqual(mineBefore.body);

    const listAfter = await call(api, "GET", `/events/${eventId}/registrations`, { cookie: owner.cookie });
    expect(listAfter.body).toEqual(listBefore.body);
  });

  it("GET /events/:id/registrations/:registrationId/emails shows the reschedule row (ER48)", async () => {
    const { eventId, registered, waiting, cancelled, checkedIn } = await mixedEvent();
    asEvent(await reschedule(api, eventId, { starts_at: B.toISOString() }, owner.cookie));

    const emailsOf = async (p: Person) => {
      const reply = await call(api, "GET", `/events/${eventId}/registrations/${p.registrationId}/emails`, {
        cookie: owner.cookie,
      });
      expect(reply.status, reply.text).toBe(200);
      return (reply.body as { emails: { kind: string; status: string; to_email: string; subject: string }[] }).emails;
    };
    for (const p of [registered[0], registered[1], waiting]) {
      expect(await emailsOf(p)).toEqual([
        expect.objectContaining({ kind: "reschedule", status: "pending", to_email: p.email, subject: "Rescheduled: Spring Meetup" }),
      ]);
    }
    for (const p of [checkedIn, cancelled]) {
      expect((await emailsOf(p)).map((e) => e.kind)).not.toContain("reschedule");
    }
  });
});

describe("ER86: shapes", () => {
  it("answers exactly the organizer event keys with numbers and ISO dates", async () => {
    const { eventId } = await mixedEvent();
    const reply = await reschedule(api, eventId, { starts_at: B.toISOString() }, owner.cookie);
    const event = asEvent(reply);
    expect(reply.text).not.toContain("organizer_id");
    expect(typeof event.registered).toBe("number");
    expect(typeof event.seats_left).toBe("number");
    expect(typeof event.schedule_version).toBe("number");
    expect(event.registered).toBe(3);
    expect(event.seats_left).toBe(7);
    for (const key of ["starts_at", "ends_at", "created_at"] as const) expect(event[key]).toMatch(ISO_UTC);
    expect(event.cancelled_at).toBeNull();
  });
});

describe("ER87: scope of writes", () => {
  it("changes only events.starts_at, events.schedule_version and outbox, and logs nothing", async () => {
    const { eventId } = await mixedEvent();
    const before = await allTables(db.pool);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      asEvent(await reschedule(api, eventId, { starts_at: B.toISOString() }, owner.cookie));
      expect(log).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
    const after = await allTables(db.pool);
    for (const table of ["organizers", "users", "registrations"]) expect(after[table], table).toEqual(before[table]);
    expect(after.events).toEqual(
      before.events.map((e) => (e.id === eventId ? { ...e, starts_at: B, schedule_version: 2 } : e)),
    );
    const newRows = after.outbox.filter((o) => !before.outbox.some((b) => b.id === o.id));
    expect(newRows.map((o) => o.kind)).toEqual(["reschedule", "reschedule", "reschedule"]);
  });

  it("rolls back and answers 500 internal when a statement fails; nothing is written", async () => {
    const { eventId } = await mixedEvent();
    await insertOutbox(db.pool, (await person(db.pool, eventId)).registrationId, { kind: "reminder" });
    const before = await eventState(db.pool, eventId);
    const undo = failStatement(db.pool, "INSERT INTO outbox");
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expectError(await reschedule(api, eventId, { starts_at: B.toISOString() }, owner.cookie), 500, "internal");
    } finally {
      undo();
      error.mockRestore();
    }
    expect(await eventState(db.pool, eventId)).toEqual(before);
    asEvent(await reschedule(api, eventId, { starts_at: B.toISOString() }, owner.cookie));
  });
});
