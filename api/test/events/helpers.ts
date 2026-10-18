import { expect } from "vitest";
import type pg from "pg";
import { createApp } from "../../src/app.js";
import { listen, mintSessionCookie, TEST_SECRET, type Running } from "../auth/helpers.js";
import { insertOrganizer, insertUser } from "../db/helpers.js";

// The organizer event shape, in the order of events.md section 3.
export const ORGANIZER_KEYS = [
  "id",
  "title",
  "starts_at",
  "ends_at",
  "duration_minutes",
  "capacity",
  "registered",
  "seats_left",
  "status",
  "schedule_version",
  "cancelled_at",
  "created_at",
];

// The public event shape, in the order of events.md E11 and E13.
export const PUBLIC_KEYS = [
  "id",
  "title",
  "starts_at",
  "ends_at",
  "duration_minutes",
  "capacity",
  "status",
  "has_started",
  "seats_left",
  "full",
];

export const MINUTE = 60 * 1000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

// A uuid (v7 layout) that no row has.
export const UNKNOWN_ID = "01900000-0000-7000-8000-000000000000";

// Ids that are not a uuid; each must answer 404 without a query (E8, E16).
export const MALFORMED_IDS = [
  "abc",
  "123",
  "not-a-uuid",
  "01900000-0000-7000-8000-00000000000",
  "01900000-0000-7000-8000-0000000000000",
  "01900000000070008000000000000000",
  "{01900000-0000-7000-8000-000000000000}",
  "01900000-0000-7000-8000-00000000000g",
  "' OR '1'='1",
];

export type Reply = { status: number; body: unknown; text: string };

export function startApi(pool: pg.Pool): Running {
  return listen(createApp({ pool, cookieSecret: TEST_SECRET }));
}

// Calls the API. Every answer is checked for E17: no password_hash anywhere.
export async function call(
  api: Running,
  method: "GET" | "POST",
  path: string,
  options: { body?: unknown; raw?: string; cookie?: string } = {},
): Promise<Reply> {
  const headers: Record<string, string> = {};
  let payload: string | undefined;
  if (options.raw !== undefined) {
    headers["content-type"] = "application/json";
    payload = options.raw;
  } else if (options.body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(options.body);
  }
  if (options.cookie !== undefined) headers.cookie = options.cookie;

  const res = await fetch(`${api.url}${path}`, { method, headers, body: payload });
  const text = await res.text();
  expect(text).not.toContain("password_hash");
  return { status: res.status, body: text === "" ? null : JSON.parse(text), text };
}

export type Account = { id: string; cookie: string };

// An organizer row and a valid session cookie for it.
export async function organizer(pool: pg.Pool): Promise<Account> {
  const id = await insertOrganizer(pool);
  return { id, cookie: await mintSessionCookie("organizer", id) };
}

// An attendee row and a valid session cookie for it.
export async function attendee(pool: pg.Pool): Promise<Account> {
  const id = await insertUser(pool);
  return { id, cookie: await mintSessionCookie("user", id) };
}

// The number of rows in events, to show that nothing was written.
export async function countEvents(pool: pg.Pool): Promise<number> {
  const { rows } = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM events");
  return rows[0].n;
}

// A Date with whole milliseconds, a little after `offsetMs` from now.
export function fromNow(offsetMs: number): Date {
  return new Date(Date.now() + offsetMs);
}
