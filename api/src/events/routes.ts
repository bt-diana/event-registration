import { Router, type Request, type Response } from "express";
import type pg from "pg";
import { requireOrganizer } from "../auth/middleware.js";
import { deriveStatus, endsAt, MINUTE_MS, type StoredStatus } from "./status.js";

// docs/specs/events.md (M2): POST /events, GET /events, GET /events/:id for the
// owner, and GET /public/events/:id for anyone. The optional description is
// docs/specs/event-description.md (DS1-DS13). GET /public/events is
// docs/specs/events-public-list.md (PL1-PL11).

const MAX_TITLE = 200;
const MAX_DESCRIPTION = 2000;
const MIN_CAPACITY = 1;
const MAX_CAPACITY = 100000;
const MIN_DURATION = 1;
const MAX_DURATION = 1440;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ISO 8601 extended format with a date, a time and Z or an offset:
// 2030-01-01T10:00Z, 2030-01-01T10:00:00Z, 2030-01-01T10:00:00.250+02:00.
// At most three fraction digits, so the stored instant is the answered one.
const ISO_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(?:Z|([+-])(\d{2}):(\d{2}))$/;

type EventRow = {
  id: string;
  title: string;
  description: string;
  starts_at: Date;
  duration_minutes: number;
  capacity: number;
  status: StoredStatus;
  schedule_version: number;
  cancelled_at: Date | null;
  created_at: Date;
  // count() is a bigint, which pg gives as a string.
  registered: string | number;
};

type NewEvent = {
  title: string;
  description: string;
  startsAt: Date;
  durationMinutes: number;
  capacity: number;
};

const COLUMNS = `e.id, e.title, e.description, e.starts_at, e.duration_minutes, e.capacity, e.status,
  e.schedule_version, e.cancelled_at, e.created_at`;

// One query for read and list, no lock: seats are a snapshot (events.md section 3).
const SELECT_WITH_COUNT = `SELECT ${COLUMNS},
    count(r.id) FILTER (WHERE r.status = 'registered') AS registered
  FROM events e LEFT JOIN registrations r ON r.event_id = e.id`;

function fail(res: Response, status: number, error: string): void {
  res.status(status).json({ error });
}

function fields(body: unknown): Record<string, unknown> | null {
  return typeof body === "object" && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

function isIntegerIn(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// The instant an ISO 8601 timestamp names, or null when it is not one (no
// offset, impossible date or time, other formats).
function parseTimestamp(text: string): Date | null {
  const match = ISO_TIMESTAMP.exec(text);
  if (!match) return null;
  const [, y, mo, d, h, mi, s, fraction, sign, oh, om] = match;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = s === undefined ? 0 : Number(s);
  const ms = fraction === undefined ? 0 : Number(fraction.padEnd(3, "0"));
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  let offsetMinutes = 0;
  if (sign !== undefined) {
    if (Number(oh) > 23 || Number(om) > 59) return null;
    offsetMinutes = (sign === "-" ? -1 : 1) * (Number(oh) * 60 + Number(om));
  }
  const local = new Date(0);
  local.setUTCFullYear(year, month - 1, day);
  local.setUTCHours(hour, minute, second, ms);
  return new Date(local.getTime() - offsetMinutes * MINUTE_MS);
}

// The string trimmed with JS trim(), or null when it is not a string, contains
// NUL, or is over `max` code points after trimming (title E2, description DS6/DS7).
function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if ([...text].length > max || text.includes("\0")) return null;
  return text;
}

// DS4: missing or null is ''; otherwise the cleaned text, or null when bad.
function parseDescription(value: unknown): string | null {
  if (value === undefined || value === null) return "";
  return cleanText(value, MAX_DESCRIPTION);
}

// E2: null for a bad body. Extra fields are ignored.
function parseNewEvent(body: unknown, now: Date): NewEvent | null {
  const b = fields(body);
  if (!b) return null;
  const { title, description, starts_at, duration_minutes, capacity } = b;

  const cleanTitle = cleanText(title, MAX_TITLE);
  if (cleanTitle === null || cleanTitle === "") return null;

  const cleanDescription = parseDescription(description);
  if (cleanDescription === null) return null;

  if (typeof starts_at !== "string") return null;
  const startsAt = parseTimestamp(starts_at);
  if (!startsAt || startsAt.getTime() <= now.getTime()) return null;

  if (!isIntegerIn(capacity, MIN_CAPACITY, MAX_CAPACITY)) return null;
  if (!isIntegerIn(duration_minutes, MIN_DURATION, MAX_DURATION)) return null;

  return {
    title: cleanTitle,
    description: cleanDescription,
    startsAt,
    durationMinutes: duration_minutes,
    capacity,
  };
}

// The values both shapes share, from one `now` per request (E15, E18, E19).
function derive(row: EventRow, now: Date) {
  const registered = Number(row.registered);
  return {
    endsAt: endsAt(row.starts_at, row.duration_minutes),
    status: deriveStatus(row.status, row.starts_at, row.duration_minutes, now),
    registered,
    seatsLeft: Math.max(row.capacity - registered, 0),
    hasStarted: row.starts_at.getTime() <= now.getTime(),
  };
}

// Organizer event: the real numbers for every status (E10). No organizer_id.
function organizerShape(row: EventRow, now: Date) {
  const d = derive(row, now);
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    starts_at: row.starts_at.toISOString(),
    ends_at: d.endsAt.toISOString(),
    duration_minutes: row.duration_minutes,
    capacity: row.capacity,
    registered: d.registered,
    seats_left: d.seatsLeft,
    status: d.status,
    schedule_version: row.schedule_version,
    cancelled_at: row.cancelled_at === null ? null : row.cancelled_at.toISOString(),
    created_at: row.created_at.toISOString(),
  };
}

// Public event: exactly these keys (E13, DS10). A cancelled or passed event is
// closed: seats_left 0 and full false (E14, E20); the description is the stored
// text for every status.
function publicShape(row: EventRow, now: Date) {
  const d = derive(row, now);
  const open = d.status === "active";
  const seatsLeft = open ? d.seatsLeft : 0;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    starts_at: row.starts_at.toISOString(),
    ends_at: d.endsAt.toISOString(),
    duration_minutes: row.duration_minutes,
    capacity: row.capacity,
    status: d.status,
    has_started: d.hasStarted,
    seats_left: seatsLeft,
    full: open && seatsLeft === 0,
  };
}

// Public list item: the public shape without description, the ten keys picked
// (events-public-list.md PL5). Every listed event is active, so seats_left and
// full come from the normal rule.
function publicListItem(row: EventRow, now: Date) {
  const { id, title, starts_at, ends_at, duration_minutes, capacity, status, has_started, seats_left, full } =
    publicShape(row, now);
  return { id, title, starts_at, ends_at, duration_minutes, capacity, status, has_started, seats_left, full };
}

const PUBLIC_LIST_LIMIT = 100;

export function eventsRouter(pool: pg.Pool): Router {
  const router = Router();

  router.post("/events", requireOrganizer, async (req: Request, res: Response) => {
    const now = new Date();
    const input = parseNewEvent(req.body, now);
    if (!input) return fail(res, 400, "invalid_input");
    // organizer_id comes from the cookie, never from the body (E1).
    const { rows } = await pool.query<EventRow>(
      `INSERT INTO events AS e (organizer_id, title, description, starts_at, duration_minutes, capacity)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${COLUMNS}, 0 AS registered`,
      [req.organizer!.id, input.title, input.description, input.startsAt, input.durationMinutes, input.capacity],
    );
    res.status(201).json(organizerShape(rows[0], now));
  });

  router.get("/events", requireOrganizer, async (req: Request, res: Response) => {
    const now = new Date();
    const { rows } = await pool.query<EventRow>(
      `${SELECT_WITH_COUNT} WHERE e.organizer_id = $1 GROUP BY e.id ORDER BY e.starts_at, e.id`,
      [req.organizer!.id],
    );
    res.status(200).json({ events: rows.map((row) => organizerShape(row, now)) });
  });

  // Another organizer's event and a missing one take the same path: 404 (E7).
  router.get("/events/:id", requireOrganizer, async (req: Request, res: Response) => {
    const id = req.params.id;
    if (typeof id !== "string" || !UUID.test(id)) return fail(res, 404, "not_found");
    const now = new Date();
    const { rows } = await pool.query<EventRow>(
      `${SELECT_WITH_COUNT} WHERE e.id = $1 AND e.organizer_id = $2 GROUP BY e.id`,
      [id, req.organizer!.id],
    );
    if (rows.length === 0) return fail(res, 404, "not_found");
    res.status(200).json(organizerShape(rows[0], now));
  });

  // No guard, no query parameters (PL1, PL8). One `now` per request, passed to
  // the query so the filter and the derived fields agree (PL2). The path has no
  // param, so it never matches /public/events/:id (PL11).
  router.get("/public/events", async (_req: Request, res: Response) => {
    const now = new Date();
    const { rows } = await pool.query<EventRow>(
      `${SELECT_WITH_COUNT}
       WHERE e.status <> 'cancelled' AND e.starts_at + make_interval(mins => e.duration_minutes) > $1
       GROUP BY e.id ORDER BY e.starts_at ASC, e.id ASC LIMIT ${PUBLIC_LIST_LIMIT}`,
      [now],
    );
    res.status(200).json({ events: rows.map((row) => publicListItem(row, now)) });
  });

  // No guard: the cookie is ignored (E11).
  router.get("/public/events/:id", async (req: Request, res: Response) => {
    const id = req.params.id;
    if (typeof id !== "string" || !UUID.test(id)) return fail(res, 404, "not_found");
    const now = new Date();
    const { rows } = await pool.query<EventRow>(`${SELECT_WITH_COUNT} WHERE e.id = $1 GROUP BY e.id`, [id]);
    if (rows.length === 0) return fail(res, 404, "not_found");
    res.status(200).json(publicShape(rows[0], now));
  });

  return router;
}
