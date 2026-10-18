import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mintSessionCookie, type Running } from "../auth/helpers.js";
import { createTestDb, insertEvent, insertRegistration, insertUser, uniqueEmail, type TestDb } from "../db/helpers.js";
import { attendee, DAY, HOUR, MALFORMED_IDS, organizer, startApi, UNKNOWN_ID, type Account } from "../events/helpers.js";
import {
  asRegistration,
  cancelEventInDb,
  cancelRegistrationInDb,
  myRegistration,
  REGISTRATION_KEYS,
  register,
} from "./helpers.js";

// GET /events/:id/registrations/me (registration.md R17-R20, R22).

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

async function readMine(eventId: string, cookie: string) {
  const reply = await myRegistration(api, eventId, cookie);
  expect(reply.status, reply.text).toBe(200);
  return asRegistration(reply);
}

describe("R17: my registration", () => {
  it("answers 200 with the same registration the POST answered (registered)", async () => {
    const person = await attendee(db.pool);
    const eventId = await insertEvent(db.pool, owner.id, { capacity: 2 });
    const created = asRegistration(await register(api, eventId, person.cookie));
    expect(await readMine(eventId, person.cookie)).toEqual(created);
    expect(created).toMatchObject({ status: "registered", waitlist_position: null });
  });

  it("answers a waiting registration with its place", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { capacity: 1 });
    await insertRegistration(db.pool, eventId, await insertUser(db.pool), "registered");
    const first = await attendee(db.pool);
    const second = await attendee(db.pool);
    await register(api, eventId, first.cookie);
    await register(api, eventId, second.cookie);
    expect(await readMine(eventId, first.cookie)).toMatchObject({ status: "waitlisted", waitlist_position: 1 });
    expect(await readMine(eventId, second.cookie)).toMatchObject({ status: "waitlisted", waitlist_position: 2 });
  });

  it("answers a row made by SQL with its stored ticket code", async () => {
    const person = await attendee(db.pool);
    const eventId = await insertEvent(db.pool, owner.id);
    const row = await insertRegistration(db.pool, eventId, person.id, "registered");
    expect(await readMine(eventId, person.cookie)).toMatchObject({
      id: row.id,
      event_id: eventId,
      ticket_code: row.ticketCode,
      status: "registered",
      waitlist_position: null,
      checked_in_at: null,
    });
  });

  it("answers checked_in_at as an ISO string once it is set", async () => {
    const person = await attendee(db.pool);
    const eventId = await insertEvent(db.pool, owner.id);
    const row = await insertRegistration(db.pool, eventId, person.id, "registered");
    const at = new Date("2030-05-06T07:08:09.123Z");
    await db.pool.query("UPDATE registrations SET checked_in_at = $2 WHERE id = $1", [row.id, at]);
    expect((await readMine(eventId, person.cookie)).checked_in_at).toBe(at.toISOString());
  });

  it("answers the newest cancelled row when there is no active row", async () => {
    const person = await attendee(db.pool);
    const eventId = await insertEvent(db.pool, owner.id);
    await insertRegistration(db.pool, eventId, person.id, "cancelled");
    const newer = await insertRegistration(db.pool, eventId, person.id, "cancelled");
    expect(await readMine(eventId, person.cookie)).toMatchObject({
      id: newer.id,
      ticket_code: newer.ticketCode,
      status: "cancelled",
      waitlist_position: null,
    });
  });

  it("answers the active row before any newer cancelled row", async () => {
    const person = await attendee(db.pool);
    const eventId = await insertEvent(db.pool, owner.id);
    const active = await insertRegistration(db.pool, eventId, person.id, "waitlisted");
    await insertRegistration(db.pool, eventId, person.id, "cancelled");
    expect(await readMine(eventId, person.cookie)).toMatchObject({
      id: active.id,
      status: "waitlisted",
      waitlist_position: 1,
    });
  });
});

describe("R18: the place on the waiting list is current", () => {
  it("gets smaller when waiting rows before it are cancelled", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { capacity: 0 });
    const a = await insertRegistration(db.pool, eventId, await insertUser(db.pool), "waitlisted");
    const b = await insertRegistration(db.pool, eventId, await insertUser(db.pool), "waitlisted");
    const person = await attendee(db.pool);
    const created = asRegistration(await register(api, eventId, person.cookie));
    expect(created.waitlist_position).toBe(3);
    const later = await insertRegistration(db.pool, eventId, await insertUser(db.pool), "waitlisted");

    await cancelRegistrationInDb(db.pool, a.id);
    expect((await readMine(eventId, person.cookie)).waitlist_position).toBe(2);
    await cancelRegistrationInDb(db.pool, b.id);
    expect((await readMine(eventId, person.cookie)).waitlist_position).toBe(1);
    // A row behind changes nothing.
    await cancelRegistrationInDb(db.pool, later.id);
    expect(await readMine(eventId, person.cookie)).toMatchObject({ id: created.id, waitlist_position: 1 });
  });

  it("does not count waiting rows of other events", async () => {
    const other = await insertEvent(db.pool, owner.id, { capacity: 0 });
    await insertRegistration(db.pool, other, await insertUser(db.pool), "waitlisted");
    const eventId = await insertEvent(db.pool, owner.id, { capacity: 0 });
    const person = await attendee(db.pool);
    await register(api, eventId, person.cookie);
    expect((await readMine(eventId, person.cookie)).waitlist_position).toBe(1);
  });
});

describe("R19: 404 only for unknown events and for never registered (tests first)", () => {
  it("answers 404 not_found for an unknown uuid", async () => {
    const person = await attendee(db.pool);
    const reply = await myRegistration(api, UNKNOWN_ID, person.cookie);
    expect(reply).toMatchObject({ status: 404, body: { error: "not_found" } });
  });

  it("answers 404 for an id that is not a uuid without a query", async () => {
    const person = await attendee(db.pool);
    const query = vi.spyOn(db.pool, "query");
    const connect = vi.spyOn(db.pool, "connect");
    try {
      for (const id of MALFORMED_IDS) {
        const reply = await myRegistration(api, encodeURIComponent(id), person.cookie);
        expect(reply, id).toMatchObject({ status: 404, body: { error: "not_found" } });
      }
      expect(query).not.toHaveBeenCalled();
      expect(connect).not.toHaveBeenCalled();
    } finally {
      query.mockRestore();
      connect.mockRestore();
    }
  });

  it("answers 404 to an attendee who never registered for an existing event", async () => {
    const person = await attendee(db.pool);
    const eventId = await insertEvent(db.pool, owner.id);
    const reply = await myRegistration(api, eventId, person.cookie);
    expect(reply).toMatchObject({ status: 404, body: { error: "not_found" } });
  });

  it("never shows another attendee's registration: the same 404 as an unknown event", async () => {
    const emailB = uniqueEmail("attendee-b");
    const idB = await insertUser(db.pool, emailB);
    const cookieB = await mintSessionCookie("user", idB);
    const personA = await attendee(db.pool);
    const eventId = await insertEvent(db.pool, owner.id);
    const regB = asRegistration(await register(api, eventId, cookieB));

    const foreign = await myRegistration(api, eventId, personA.cookie);
    const unknown = await myRegistration(api, UNKNOWN_ID, personA.cookie);
    expect(foreign).toMatchObject({ status: 404, body: { error: "not_found" } });
    expect(foreign.status).toBe(unknown.status);
    expect(foreign.text).toBe(unknown.text);
    for (const hidden of [regB.id, regB.ticket_code, idB, emailB]) {
      expect(foreign.text).not.toContain(hidden);
    }
    // B still sees their own.
    expect((await readMine(eventId, cookieB)).id).toBe(regB.id);
  });
});

describe("R20: guards on GET /events/:id/registrations/me", () => {
  it("answers 401 not_logged_in without a valid login and 403 wrong_role to an organizer", async () => {
    const person = await attendee(db.pool);
    const eventId = await insertEvent(db.pool, owner.id);
    await insertRegistration(db.pool, eventId, person.id, "registered");
    const expired = await mintSessionCookie("user", person.id, Date.now() - 8 * DAY);
    const query = vi.spyOn(db.pool, "query");
    try {
      for (const id of [eventId, UNKNOWN_ID, MALFORMED_IDS[0]]) {
        for (const cookie of [undefined, "session=garbage", expired]) {
          const reply = await myRegistration(api, id, cookie);
          expect(reply, `${cookie} ${id}`).toMatchObject({ status: 401, body: { error: "not_logged_in" } });
        }
        const reply = await myRegistration(api, id, owner.cookie);
        expect(reply, id).toMatchObject({ status: 403, body: { error: "wrong_role" } });
      }
      expect(query).not.toHaveBeenCalled();
    } finally {
      query.mockRestore();
    }
  });
});

describe("R22: the read ignores the event status (tests first)", () => {
  it("answers 200 with the registration for a cancelled event", async () => {
    const person = await attendee(db.pool);
    const eventId = await insertEvent(db.pool, owner.id);
    const created = asRegistration(await register(api, eventId, person.cookie));
    await cancelEventInDb(db.pool, eventId);
    expect(await readMine(eventId, person.cookie)).toEqual(created);
  });

  it("answers 200 with the registration for a passed event", async () => {
    const person = await attendee(db.pool);
    const eventId = await insertEvent(db.pool, owner.id, {
      startsAt: new Date(Date.now() - 3 * HOUR),
      durationMinutes: 60,
    });
    const row = await insertRegistration(db.pool, eventId, person.id, "waitlisted");
    expect(await readMine(eventId, person.cookie)).toMatchObject({
      id: row.id,
      status: "waitlisted",
      waitlist_position: 1,
    });
  });

  it("answers a cancelled row with status cancelled, its old code and no place, also on closed events", async () => {
    const person = await attendee(db.pool);
    const open = await insertEvent(db.pool, owner.id, { capacity: 0 });
    const cancelled = await insertEvent(db.pool, owner.id);
    const passed = await insertEvent(db.pool, owner.id, { startsAt: new Date(Date.now() - 2 * DAY) });

    for (const eventId of [open, cancelled, passed]) {
      const row = await insertRegistration(db.pool, eventId, person.id, "waitlisted");
      await cancelRegistrationInDb(db.pool, row.id);
      if (eventId === cancelled) await cancelEventInDb(db.pool, eventId);
      const reply = await myRegistration(api, eventId, person.cookie);
      expect(reply.status, reply.text).toBe(200);
      expect(Object.keys(reply.body as object)).toEqual(REGISTRATION_KEYS);
      expect(reply.body).toMatchObject({
        id: row.id,
        event_id: eventId,
        status: "cancelled",
        ticket_code: row.ticketCode,
        waitlist_position: null,
        checked_in_at: null,
      });
    }
  });

  it("answers the new active row after a cancelled row and a new registration", async () => {
    const person = await attendee(db.pool);
    const eventId = await insertEvent(db.pool, owner.id, { capacity: 5 });
    const first = asRegistration(await register(api, eventId, person.cookie));
    await cancelRegistrationInDb(db.pool, first.id);
    expect(await readMine(eventId, person.cookie)).toMatchObject({ id: first.id, status: "cancelled" });

    const again = await register(api, eventId, person.cookie);
    expect(again.status, again.text).toBe(201);
    const second = asRegistration(again);
    expect(second.ticket_code).not.toBe(first.ticket_code);
    expect(await readMine(eventId, person.cookie)).toEqual(second);
  });
});
