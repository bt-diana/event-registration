import { Router, type Request, type Response } from "express";
import type pg from "pg";
import { requireOrganizer } from "../auth/middleware.js";
import { registrationShape } from "../registrations/routes.js";
import { TICKET_ALPHABET, TICKET_LENGTH } from "../registrations/ticket.js";
import {
  checkIn,
  getArrivals,
  listRegistrations,
  type ArrivalsRow,
  type CheckedInRow,
  type ListedRegistrationRow,
} from "./service.js";

// docs/specs/checkin.md (M5): POST /checkin, the check-in of a ticket at the
// door (B6, C1-C14, C19), and GET /events/:id/registrations, the organizer
// registrations list (C1, C15-C19). docs/specs/arrivals.md: GET
// /events/:id/arrivals, the counts the arrivals counter reads (AR1-AR15).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The ticket alphabet of registration.md R2, the same constant that makes the
// codes. It has only letters and digits, so it is safe inside a character class.
const TICKET_CODE = new RegExp(`^[${TICKET_ALPHABET}]{${TICKET_LENGTH}}$`);

function fail(res: Response, status: number, error: string): void {
  res.status(status).json({ error });
}

// C2: trimmed, then upper-cased, then exactly 10 characters of the alphabet.
// Anything else is null and never reaches the database.
function normaliseCode(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const raw = (body as { ticket_code?: unknown }).ticket_code;
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return TICKET_CODE.test(code) ? code : null;
}

// Exactly these keys (C14): no email, user_id, queue_no or other person's data.
function checkInShape(row: CheckedInRow) {
  return {
    registration_id: row.registration_id,
    ticket_code: row.ticket_code,
    event_id: row.event_id,
    event_title: row.event_title,
    attendee_name: row.attendee_name,
    checked_in_at: row.checked_in_at.toISOString(),
  };
}

// Exactly these keys (C15): the registration shape (R21) plus the attendee's
// name and email. No user_id, queue_no, cancelled_at or password_hash.
function listItemShape(row: ListedRegistrationRow) {
  return {
    ...registrationShape(row),
    attendee_name: row.attendee_name,
    attendee_email: row.attendee_email,
  };
}

// Exactly these keys (AR2): no event_id, title, organizer_id or person's data.
function arrivalsShape(row: ArrivalsRow) {
  return { capacity: row.capacity, registered: row.registered, arrived: row.arrived };
}

export function checkinRouter(pool: pg.Pool): Router {
  const router = Router();

  // The guard runs first (C1), then the body check (C2). The organizer is the
  // cookie's, never a value from the body; other body fields are ignored.
  router.post("/checkin", requireOrganizer, async (req: Request, res: Response) => {
    const code = normaliseCode(req.body);
    if (code === null) return fail(res, 400, "invalid_input");
    const result = await checkIn(pool, req.organizer!.id, code);
    if (result.kind === "not_found") return fail(res, 404, "not_found");
    if (result.kind === "refused") return fail(res, 409, result.error);
    if (result.kind === "already_checked_in") {
      res.status(409).json({
        error: "already_checked_in",
        checked_in_at: result.checked_in_at.toISOString(),
        attendee_name: result.attendee_name,
      });
      return;
    }
    res.status(200).json(checkInShape(result.row));
  });

  // Same path as the attendee POST of registrationsRouter, another method.
  // The guard runs first (C1); unknown, malformed and foreign events give the
  // same 404 (C17), and a malformed id never reaches the database.
  router.get("/events/:id/registrations", requireOrganizer, async (req: Request, res: Response) => {
    res.set("Cache-Control", "no-store");
    const id = req.params.id;
    if (typeof id !== "string" || !UUID.test(id)) return fail(res, 404, "not_found");
    const result = await listRegistrations(pool, req.organizer!.id, id);
    if (result.kind === "not_found") return fail(res, 404, "not_found");
    res.status(200).json({ registrations: result.rows.map(listItemShape) });
  });

  // docs/specs/arrivals.md. Same guard, header and 404 rules as the list
  // (AR1, AR8, AR13); the only input is the path id, so there is no 400 (AR14).
  router.get("/events/:id/arrivals", requireOrganizer, async (req: Request, res: Response) => {
    res.set("Cache-Control", "no-store");
    const id = req.params.id;
    if (typeof id !== "string" || !UUID.test(id)) return fail(res, 404, "not_found");
    const result = await getArrivals(pool, req.organizer!.id, id);
    if (result.kind === "not_found") return fail(res, 404, "not_found");
    res.status(200).json(arrivalsShape(result.row));
  });

  return router;
}
