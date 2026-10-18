import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Running } from "../auth/helpers.js";
import { createTestDb, insertEvent, insertRegistration, insertUser, type TestDb } from "../db/helpers.js";
import { attendee, organizer, startApi, type Account } from "../events/helpers.js";
import {
  asRegistration,
  attendees,
  outboxRows,
  register,
  registrationRows,
  TICKET_CODE,
  type Registration,
} from "./helpers.js";

// Tests first (registration.md step 14): B4 last seat (R8, R9), B1 same account
// twice (R4, R5), B2 full goes to the waiting list (R6, R7).

let db: TestDb;
let api: Running;
let owner: Account;
// 20 different attendees, reused on fresh events.
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

// All attendees register for one event at the same moment, each with its own cookie.
async function registerAtOnce(eventId: string, people: Account[]) {
  return Promise.all(people.map((p) => register(api, eventId, p.cookie)));
}

async function lastSeatRound(capacity: number) {
  const eventId = await insertEvent(db.pool, owner.id, { capacity });
  const replies = await registerAtOnce(eventId, crowd);

  // Every answer is 201: each attendee got a new row.
  for (const reply of replies) expect(reply.status, reply.text).toBe(201);
  const answers = replies.map(asRegistration);
  const seated = answers.filter((a) => a.status === "registered");
  const waiting = answers.filter((a) => a.status === "waitlisted");
  expect(seated).toHaveLength(capacity);
  expect(waiting).toHaveLength(crowd.length - capacity);
  for (const a of seated) expect(a.waitlist_position).toBeNull();
  // Places 1..n, no repeat and no gap.
  expect(waiting.map((a) => a.waitlist_position).sort((x, y) => x! - y!)).toEqual(
    Array.from({ length: crowd.length - capacity }, (_, i) => i + 1),
  );

  const rows = await registrationRows(db.pool, eventId);
  expect(rows).toHaveLength(crowd.length);
  expect(rows.filter((r) => r.status === "registered")).toHaveLength(capacity);
  expect(rows.filter((r) => r.status === "waitlisted")).toHaveLength(crowd.length - capacity);
  // One row per attendee, and the row is the caller's (user_id from the cookie).
  expect(new Set(rows.map((r) => r.user_id))).toEqual(new Set(crowd.map((p) => p.id)));
  for (const [i, reply] of answers.entries()) {
    const row = rows.find((r) => r.id === reply.id)!;
    expect(row.user_id).toBe(crowd[i].id);
    expect(row.ticket_code).toBe(reply.ticket_code);
  }
  // The seats went to the first lock holders (queue_no order), the rest wait in that order.
  expect(rows.slice(0, capacity).every((r) => r.status === "registered")).toBe(true);
  const byQueue = rows.filter((r) => r.status === "waitlisted").map((r) => r.id);
  const byPosition = [...waiting].sort((x, y) => x.waitlist_position! - y.waitlist_position!).map((a) => a.id);
  expect(byPosition).toEqual(byQueue);

  // Codes are well formed and unique.
  for (const a of answers) expect(a.ticket_code).toMatch(TICKET_CODE);
  expect(new Set(answers.map((a) => a.ticket_code)).size).toBe(crowd.length);

  // One ticket email per seat, none for the waiting list.
  const outbox = await outboxRows(db.pool, eventId);
  expect(outbox).toHaveLength(capacity);
  expect(outbox.every((o) => o.kind === "ticket")).toBe(true);
  expect(new Set(outbox.map((o) => o.registration_id))).toEqual(new Set(seated.map((a) => a.id)));
}

describe("R8, R9 (B4): the last seat with 20 attendees at once (tests first)", () => {
  for (let round = 1; round <= 5; round++) {
    it(`capacity 1: exactly one registered and 19 waitlisted (round ${round})`, async () => {
      await lastSeatRound(1);
    });
  }

  it("capacity 3: exactly 3 registered and 17 waitlisted", async () => {
    await lastSeatRound(3);
  });

  it("capacity 3 again on a fresh event", async () => {
    await lastSeatRound(3);
  });

  it("capacity 0 (made by SQL) puts everyone on the waiting list and writes no email", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { capacity: 0 });
    const replies = await registerAtOnce(eventId, crowd.slice(0, 5));
    for (const reply of replies) expect(reply.status, reply.text).toBe(201);
    const answers = replies.map(asRegistration);
    expect(answers.every((a) => a.status === "waitlisted")).toBe(true);
    expect(answers.map((a) => a.waitlist_position).sort((x, y) => x! - y!)).toEqual([1, 2, 3, 4, 5]);
    const rows = await registrationRows(db.pool, eventId);
    expect(rows.filter((r) => r.status === "registered")).toHaveLength(0);
    expect(await outboxRows(db.pool, eventId)).toHaveLength(0);
  });

  it("never seats more than capacity when seats were already taken by SQL", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { capacity: 2 });
    await insertRegistration(db.pool, eventId, await insertUser(db.pool), "registered");
    const replies = await registerAtOnce(eventId, crowd.slice(0, 10));
    const answers = replies.map(asRegistration);
    expect(answers.filter((a) => a.status === "registered")).toHaveLength(1);
    expect(answers.filter((a) => a.status === "waitlisted")).toHaveLength(9);
    const rows = await registrationRows(db.pool, eventId);
    expect(rows.filter((r) => r.status === "registered")).toHaveLength(2);
  });
});

describe("R4 (B1): the same account registering again (tests first)", () => {
  it("answers 200 with the same registration and writes nothing new (seat free)", async () => {
    const person = await attendee(db.pool);
    const eventId = await insertEvent(db.pool, owner.id, { capacity: 5 });

    const first = await register(api, eventId, person.cookie);
    expect(first.status, first.text).toBe(201);
    const created = asRegistration(first);
    expect(created.status).toBe("registered");

    const again = await register(api, eventId, person.cookie);
    expect(again.status, again.text).toBe(200);
    expect(asRegistration(again)).toEqual(created);

    const rows = await registrationRows(db.pool, eventId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: created.id, user_id: person.id, ticket_code: created.ticket_code });
    const outbox = await outboxRows(db.pool, eventId);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ kind: "ticket", registration_id: created.id });
  });

  it("answers 200 with the same waiting registration and place when the event is full", async () => {
    const person = await attendee(db.pool);
    const eventId = await insertEvent(db.pool, owner.id, { capacity: 1 });
    await insertRegistration(db.pool, eventId, await insertUser(db.pool), "registered");

    const first = await register(api, eventId, person.cookie);
    expect(first.status, first.text).toBe(201);
    const created = asRegistration(first);
    expect(created).toMatchObject({ status: "waitlisted", waitlist_position: 1 });

    const again = await register(api, eventId, person.cookie);
    expect(again.status, again.text).toBe(200);
    expect(asRegistration(again)).toEqual(created);
    expect(await registrationRows(db.pool, eventId)).toHaveLength(2);
    expect(await outboxRows(db.pool, eventId)).toHaveLength(0);
  });

  it("answers 200 for a row that already exists from SQL, with its stored ticket code", async () => {
    const person = await attendee(db.pool);
    const eventId = await insertEvent(db.pool, owner.id, { capacity: 5 });
    const existing = await insertRegistration(db.pool, eventId, person.id, "registered");

    const reply = await register(api, eventId, person.cookie);
    expect(reply.status, reply.text).toBe(200);
    expect(asRegistration(reply)).toMatchObject({
      id: existing.id,
      ticket_code: existing.ticketCode,
      status: "registered",
    });
    expect(await registrationRows(db.pool, eventId)).toHaveLength(1);
    expect(await outboxRows(db.pool, eventId)).toHaveLength(0);
  });
});

describe("R5 (B1): five parallel requests from one account (tests first)", () => {
  async function fiveAtOnce(capacity: number, seatsTaken: number) {
    const person = await attendee(db.pool);
    const eventId = await insertEvent(db.pool, owner.id, { capacity });
    for (let i = 0; i < seatsTaken; i++) {
      await insertRegistration(db.pool, eventId, await insertUser(db.pool), "registered");
    }
    const replies = await registerAtOnce(eventId, Array(5).fill(person));
    const statuses = replies.map((r) => r.status).sort();
    expect(statuses, replies.map((r) => r.text).join("\n")).toEqual([200, 200, 200, 200, 201]);
    const answers = replies.map(asRegistration);
    expect(new Set(answers.map((a) => a.id)).size).toBe(1);
    expect(new Set(answers.map((a) => a.ticket_code)).size).toBe(1);
    const mine = (await registrationRows(db.pool, eventId)).filter((r) => r.user_id === person.id);
    expect(mine).toHaveLength(1);
    return { eventId, answers, mine };
  }

  it("gives one row, one ticket email, one 201 and four 200 with free seats", async () => {
    const { eventId, answers, mine } = await fiveAtOnce(5, 0);
    expect(answers.every((a) => a.status === "registered")).toBe(true);
    const outbox = await outboxRows(db.pool, eventId);
    expect(outbox).toHaveLength(1);
    expect(outbox[0].registration_id).toBe(mine[0].id);
  });

  it("gives one waitlisted row with one place and no email when the event is full", async () => {
    const { eventId, answers } = await fiveAtOnce(1, 1);
    expect(answers.every((a) => a.status === "waitlisted" && a.waitlist_position === 1)).toBe(true);
    expect(await outboxRows(db.pool, eventId)).toHaveLength(0);
  });
});

describe("R6, R7 (B2): a full event puts new people on the waiting list (tests first)", () => {
  it("stores waitlisted when registered rows equal capacity, takes no seat and writes no email", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { capacity: 2 });
    await insertRegistration(db.pool, eventId, await insertUser(db.pool), "registered");
    await insertRegistration(db.pool, eventId, await insertUser(db.pool), "registered");
    const person = await attendee(db.pool);

    const reply = await register(api, eventId, person.cookie);
    expect(reply.status, reply.text).toBe(201);
    const answer = asRegistration(reply);
    expect(answer).toMatchObject({ status: "waitlisted", waitlist_position: 1, event_id: eventId });
    expect(answer.ticket_code).toMatch(TICKET_CODE);

    const rows = await registrationRows(db.pool, eventId);
    expect(rows.filter((r) => r.status === "registered")).toHaveLength(2);
    expect(rows.find((r) => r.id === answer.id)).toMatchObject({ status: "waitlisted", user_id: person.id });
    expect(await outboxRows(db.pool, eventId)).toHaveLength(0);
  });

  it("numbers the waiting list 1, 2, 3 in order of registering; seats come first", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { capacity: 2 });
    const people = await attendees(db.pool, 5);
    const answers: Registration[] = [];
    for (const p of people) {
      const reply = await register(api, eventId, p.cookie);
      expect(reply.status, reply.text).toBe(201);
      answers.push(asRegistration(reply));
    }
    expect(answers.map((a) => [a.status, a.waitlist_position])).toEqual([
      ["registered", null],
      ["registered", null],
      ["waitlisted", 1],
      ["waitlisted", 2],
      ["waitlisted", 3],
    ]);
    expect(await outboxRows(db.pool, eventId)).toHaveLength(2);
  });

  it("does not count waitlisted and cancelled rows as taken seats", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { capacity: 1 });
    await insertRegistration(db.pool, eventId, await insertUser(db.pool), "waitlisted");
    await insertRegistration(db.pool, eventId, await insertUser(db.pool), "cancelled");
    const person = await attendee(db.pool);
    const reply = await register(api, eventId, person.cookie);
    expect(reply.status, reply.text).toBe(201);
    expect(asRegistration(reply)).toMatchObject({ status: "registered", waitlist_position: null });
  });

  it("counts a place after waiting rows made by SQL, and skips cancelled ones", async () => {
    const eventId = await insertEvent(db.pool, owner.id, { capacity: 0 });
    await insertRegistration(db.pool, eventId, await insertUser(db.pool), "waitlisted");
    await insertRegistration(db.pool, eventId, await insertUser(db.pool), "cancelled");
    await insertRegistration(db.pool, eventId, await insertUser(db.pool), "waitlisted");
    const person = await attendee(db.pool);
    const reply = await register(api, eventId, person.cookie);
    expect(reply.status, reply.text).toBe(201);
    expect(asRegistration(reply)).toMatchObject({ status: "waitlisted", waitlist_position: 3 });
  });
});
