import { Router, type Request, type Response } from "express";
import type pg from "pg";
import { requireOrganizer } from "../auth/middleware.js";
import { registrationShape } from "../registrations/routes.js";
import { listRegistrations, type ListedRegistrationRow } from "./service.js";

// docs/specs/checkin.md (M5): GET /events/:id/registrations, the organizer
// registrations list the arrivals counter is counted from (C1, C15-C19).
// POST /checkin is a later step.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(res: Response, status: number, error: string): void {
  res.status(status).json({ error });
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

export function checkinRouter(pool: pg.Pool): Router {
  const router = Router();

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

  return router;
}
