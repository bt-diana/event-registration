import { expect, vi } from "vitest";
import type pg from "pg";
import { mintSessionCookie, type Running } from "../auth/helpers.js";
import { insertRegistration, insertUser, uniqueEmail } from "../db/helpers.js";
import { call, type Reply } from "./helpers.js";

// Shared by the M7 tests: POST /events/:id/reschedule and POST /events/:id/cancel
// (email-reminders.md ER61-ER87).

export type OrganizerEvent = {
  id: string;
  title: string;
  description: string;
  starts_at: string;
  ends_at: string;
  duration_minutes: number;
  capacity: number;
  registered: number;
  seats_left: number;
  status: string;
  schedule_version: number;
  cancelled_at: string | null;
  created_at: string;
};

export const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function reschedule(api: Running, eventId: string, body: unknown, cookie?: string): Promise<Reply> {
  return call(api, "POST", `/events/${eventId}/reschedule`, { body, cookie });
}

export function cancelEvent(api: Running, eventId: string, cookie?: string, body?: unknown): Promise<Reply> {
  return call(api, "POST", `/events/${eventId}/cancel`, { body, cookie });
}

// A 4xx answer with exactly `{ "error": "<code>" }` (ER86).
export function expectError(reply: Reply, status: number, error: string): void {
  expect(reply.status, reply.text).toBe(status);
  expect(reply.body, reply.text).toEqual({ error });
}

// The event row, its registrations and their outbox rows, every column, to show
// what a call changed (ER62, ER65, ER76).
export type EventState = {
  event: Record<string, unknown> | undefined;
  registrations: Record<string, unknown>[];
  outbox: Record<string, unknown>[];
};

export async function eventState(pool: pg.Pool, eventId: string): Promise<EventState> {
  const event = (await pool.query("SELECT * FROM events WHERE id = $1", [eventId])).rows[0];
  const registrations = (await pool.query("SELECT * FROM registrations WHERE event_id = $1 ORDER BY id", [eventId]))
    .rows;
  const outbox = (
    await pool.query(
      `SELECT o.* FROM outbox o JOIN registrations r ON r.id = o.registration_id
        WHERE r.event_id = $1 ORDER BY o.id`,
      [eventId],
    )
  ).rows;
  return { event, registrations, outbox };
}

// Every row of every table (ER87).
export async function allTables(pool: pg.Pool): Promise<Record<string, Record<string, unknown>[]>> {
  const result: Record<string, Record<string, unknown>[]> = {};
  for (const table of ["organizers", "users", "events", "registrations", "outbox"]) {
    result[table] = (await pool.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
  }
  return result;
}

export type Person = {
  userId: string;
  email: string;
  cookie: string;
  registrationId: string;
  ticketCode: string;
};

// An attendee with a session cookie and one registration on the event. A
// checked-in person is `registered` with `checked_in_at` set.
export async function person(
  pool: pg.Pool,
  eventId: string,
  status: "registered" | "waitlisted" | "cancelled" | "checked_in" = "registered",
): Promise<Person> {
  const email = uniqueEmail("guest");
  const userId = await insertUser(pool, email);
  const row = await insertRegistration(pool, eventId, userId, status === "checked_in" ? "registered" : status);
  if (status === "checked_in") {
    await pool.query("UPDATE registrations SET checked_in_at = now() - interval '1 hour' WHERE id = $1", [row.id]);
  }
  return {
    userId,
    email,
    cookie: await mintSessionCookie("user", userId),
    registrationId: row.id,
    ticketCode: row.ticketCode,
  };
}

export type OutboxItem = {
  id: string;
  registration_id: string;
  kind: string;
  schedule_version: number;
  event_starts_at: Date;
  to_email: string;
  subject: string;
  body: string;
  status: string;
  sent_at: Date | null;
};

// The outbox rows of the event's registrations, optionally of one kind.
export async function outboxOf(pool: pg.Pool, eventId: string, kind?: string): Promise<OutboxItem[]> {
  const { rows } = await pool.query<OutboxItem>(
    `SELECT o.id, o.registration_id, o.kind, o.schedule_version, o.event_starts_at, o.to_email,
            o.subject, o.body, o.status, o.sent_at
       FROM outbox o JOIN registrations r ON r.id = o.registration_id
      WHERE r.event_id = $1 AND ($2::text IS NULL OR o.kind = $2)
      ORDER BY o.schedule_version, o.to_email, o.id`,
    [eventId, kind ?? null],
  );
  return rows;
}

export function sorted(values: string[]): string[] {
  return [...values].sort();
}

// The pool.query and pool.connect calls made during `run`, to prove that a
// request never reached the database.
export async function databaseCalls(pool: pg.Pool, run: () => Promise<void>): Promise<number> {
  const query = vi.spyOn(pool, "query");
  const connect = vi.spyOn(pool, "connect");
  try {
    await run();
    return query.mock.calls.length + connect.mock.calls.length;
  } finally {
    query.mockRestore();
    connect.mockRestore();
  }
}

// Makes the first statement of a pool client that contains `fragment` fail,
// for one request (ER87). The returned function undoes it.
export function failStatement(pool: pg.Pool, fragment: string): () => void {
  const original = pool.connect.bind(pool) as () => Promise<pg.PoolClient>;
  const patched: pg.PoolClient[] = [];
  let failed = false;
  const spy = vi.spyOn(pool, "connect").mockImplementation((async () => {
    const client = await original();
    const query = client.query.bind(client) as (...args: unknown[]) => unknown;
    (client as unknown as { query: unknown }).query = (...args: unknown[]) => {
      const text = typeof args[0] === "string" ? args[0] : "";
      if (!failed && text.includes(fragment)) {
        failed = true;
        return Promise.reject(new Error("injected failure"));
      }
      return query(...args);
    };
    patched.push(client);
    return client;
  }) as never);
  return () => {
    spy.mockRestore();
    for (const client of patched) delete (client as unknown as { query?: unknown }).query;
  };
}
