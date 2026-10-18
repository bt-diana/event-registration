import { expect } from "vitest";
import type pg from "pg";
import type { Running } from "../auth/helpers.js";
import { attendee, call, type Account, type Reply } from "../events/helpers.js";

// The registration shape, in the order of registration.md R21.
export const REGISTRATION_KEYS = [
  "id",
  "event_id",
  "status",
  "ticket_code",
  "waitlist_position",
  "checked_in_at",
  "created_at",
];

// 10 characters from A-Z without I and O, and 2-9 (R2, DATABASE.md decision 3).
export const TICKET_CODE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10}$/;

export type Registration = {
  id: string;
  event_id: string;
  status: "registered" | "waitlisted" | "cancelled";
  ticket_code: string;
  waitlist_position: number | null;
  checked_in_at: string | null;
  created_at: string;
};

export function register(api: Running, eventId: string, cookie?: string, body?: unknown): Promise<Reply> {
  return call(api, "POST", `/events/${eventId}/registrations`, { cookie, body });
}

export function myRegistration(api: Running, eventId: string, cookie?: string): Promise<Reply> {
  return call(api, "GET", `/events/${eventId}/registrations/me`, { cookie });
}

// Checks the exact key list (R21) and gives the body typed.
export function asRegistration(reply: Reply): Registration {
  expect(Object.keys(reply.body as object), reply.text).toEqual(REGISTRATION_KEYS);
  return reply.body as Registration;
}

// `n` attendee rows, each with its own session cookie.
export async function attendees(pool: pg.Pool, n: number): Promise<Account[]> {
  const list: Account[] = [];
  for (let i = 0; i < n; i++) list.push(await attendee(pool));
  return list;
}

export type RegistrationRow = {
  id: string;
  user_id: string;
  status: string;
  ticket_code: string;
  queue_no: string;
  cancelled_at: Date | null;
  checked_in_at: Date | null;
};

export async function registrationRows(pool: pg.Pool, eventId: string): Promise<RegistrationRow[]> {
  const { rows } = await pool.query<RegistrationRow>(
    `SELECT id, user_id, status, ticket_code, queue_no, cancelled_at, checked_in_at
       FROM registrations WHERE event_id = $1 ORDER BY queue_no`,
    [eventId],
  );
  return rows;
}

export type OutboxRow = {
  id: string;
  registration_id: string;
  kind: string;
  schedule_version: number;
  event_starts_at: Date;
  to_email: string;
  subject: string;
  body: string;
  sent_at: Date | null;
};

// The outbox rows that belong to registrations of this event.
export async function outboxRows(pool: pg.Pool, eventId: string): Promise<OutboxRow[]> {
  const { rows } = await pool.query<OutboxRow>(
    `SELECT o.id, o.registration_id, o.kind, o.schedule_version, o.event_starts_at, o.to_email,
            o.subject, o.body, o.sent_at
       FROM outbox o JOIN registrations r ON r.id = o.registration_id
      WHERE r.event_id = $1
      ORDER BY o.created_at, o.id`,
    [eventId],
  );
  return rows;
}

// Total rows in registrations and outbox, to show that nothing was written.
export async function counts(pool: pg.Pool): Promise<{ registrations: number; outbox: number }> {
  const { rows } = await pool.query<{ registrations: number; outbox: number }>(
    `SELECT (SELECT count(*)::int FROM registrations) AS registrations,
            (SELECT count(*)::int FROM outbox) AS outbox`,
  );
  return rows[0];
}

export async function cancelEventInDb(pool: pg.Pool, eventId: string): Promise<void> {
  await pool.query("UPDATE events SET status = 'cancelled', cancelled_at = now() WHERE id = $1", [eventId]);
}

export async function cancelRegistrationInDb(pool: pg.Pool, registrationId: string): Promise<void> {
  await pool.query("UPDATE registrations SET status = 'cancelled', cancelled_at = now() WHERE id = $1", [
    registrationId,
  ]);
}
