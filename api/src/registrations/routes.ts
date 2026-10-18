import { Router, type Request, type Response } from "express";
import type pg from "pg";
import { requireUser } from "../auth/middleware.js";
import {
  listMyRegistrations,
  REGISTRATION_COLUMNS,
  registerForEvent,
  type MyRegistrationRow,
  type RegistrationRow,
} from "./service.js";

// docs/specs/registration.md (M3): POST /events/:id/registrations and
// GET /events/:id/registrations/me for the logged-in attendee.
// docs/specs/my-registrations.md: GET /me/registrations, all of the
// attendee's own registrations.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(res: Response, status: number, error: string): void {
  res.status(status).json({ error });
}

// Exactly these keys (R21): no user_id, queue_no, cancelled_at or personal data.
// Also the first keys of the organizer list item (checkin.md C15).
export function registrationShape(row: RegistrationRow) {
  return {
    id: row.id,
    event_id: row.event_id,
    status: row.status,
    ticket_code: row.ticket_code,
    waitlist_position: row.status === "waitlisted" ? row.waitlist_position : null,
    checked_in_at: row.checked_in_at === null ? null : row.checked_in_at.toISOString(),
    created_at: row.created_at.toISOString(),
  };
}

// Exactly these keys (MR3): the registration shape plus three event keys. No
// user_id, queue_no, cancelled_at, organizer_id, capacity, description or
// personal data.
function myRegistrationShape(row: MyRegistrationRow) {
  return {
    ...registrationShape(row),
    event_title: row.event_title,
    event_starts_at: row.event_starts_at.toISOString(),
    event_status: row.event_status,
  };
}

export function registrationsRouter(pool: pg.Pool): Router {
  const router = Router();

  // The user id is the cookie's, never a query or body value (MR4). There is
  // no input, so no 400 and no 404 (MR14). One `now` per request (MR7).
  router.get("/me/registrations", requireUser, async (req: Request, res: Response) => {
    res.set("Cache-Control", "no-store");
    const rows = await listMyRegistrations(pool, req.user!.id, new Date());
    res.status(200).json({ registrations: rows.map(myRegistrationShape) });
  });

  // The body is ignored; the attendee is the cookie's user (R1).
  router.post("/events/:id/registrations", requireUser, async (req: Request, res: Response) => {
    const id = req.params.id;
    if (typeof id !== "string" || !UUID.test(id)) return fail(res, 404, "not_found");
    const result = await registerForEvent(pool, id, req.user!.id, new Date());
    if (result.kind === "not_found") return fail(res, 404, "not_found");
    if (result.kind === "closed") return fail(res, 409, result.error);
    res.status(result.created ? 201 : 200).json(registrationShape(result.registration));
  });

  // The caller's own row in any status, for any event status, no lock (R17,
  // R22). An active row wins, else the newest cancelled one. Unknown event and
  // never registered give the same 404 (R19).
  router.get("/events/:id/registrations/me", requireUser, async (req: Request, res: Response) => {
    const id = req.params.id;
    if (typeof id !== "string" || !UUID.test(id)) return fail(res, 404, "not_found");
    const { rows } = await pool.query<RegistrationRow>(
      `SELECT ${REGISTRATION_COLUMNS} FROM registrations r
        WHERE r.event_id = $1 AND r.user_id = $2
        ORDER BY (r.status <> 'cancelled') DESC, r.created_at DESC, r.queue_no DESC
        LIMIT 1`,
      [id, req.user!.id],
    );
    if (rows.length === 0) return fail(res, 404, "not_found");
    res.status(200).json(registrationShape(rows[0]));
  });

  return router;
}
