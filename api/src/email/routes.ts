import { Router, type Request, type Response } from "express";
import type pg from "pg";
import { requireOrganizer } from "../auth/middleware.js";
import { EMAIL_KINDS, EMAIL_STATUSES, listEmails, type EmailFilters, type EmailRow } from "./service.js";

// docs/specs/email-outbox.md: GET /events/:id/emails, the emails of one of the
// organizer's own events (OB1-OB18). Order of checks: guard, no-store header,
// path id (404), kind, status, registration_id (400), ownership (404).

// The same regex as the check-in routes (a copy, email-outbox.md section 3).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(res: Response, status: number, error: string): void {
  res.status(status).json({ error });
}

// Absent is undefined; a single string of the list is the value; anything else
// (empty, repeated, another case) is null, which is a 400.
function pick<T extends string>(value: unknown, allowed: readonly T[]): T | undefined | null {
  if (value === undefined) return undefined;
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

function pickUuid(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  return typeof value === "string" && UUID.test(value) ? value : null;
}

// Exactly these keys, mapped one by one so a new column never leaks (OB3, OB4).
function emailShape(row: EmailRow) {
  return {
    id: row.id,
    registration_id: row.registration_id,
    kind: row.kind,
    status: row.status,
    send_attempts: row.send_attempts,
    send_error: row.send_error,
    to_email: row.to_email,
    subject: row.subject,
    schedule_version: row.schedule_version,
    event_starts_at: row.event_starts_at.toISOString(),
    created_at: row.created_at.toISOString(),
    sent_at: row.sent_at === null ? null : row.sent_at.toISOString(),
    attendee_name: row.attendee_name,
  };
}

export function emailRouter(pool: pg.Pool): Router {
  const router = Router();

  router.get("/events/:id/emails", requireOrganizer, async (req: Request, res: Response) => {
    res.set("Cache-Control", "no-store");
    const id = req.params.id;
    if (typeof id !== "string" || !UUID.test(id)) return fail(res, 404, "not_found");

    const kind = pick(req.query.kind, EMAIL_KINDS);
    if (kind === null) return fail(res, 400, "invalid_kind");
    const status = pick(req.query.status, EMAIL_STATUSES);
    if (status === null) return fail(res, 400, "invalid_status");
    const registrationId = pickUuid(req.query.registration_id);
    if (registrationId === null) return fail(res, 400, "invalid_registration_id");

    const filters: EmailFilters = { kind, status, registrationId };
    const result = await listEmails(pool, req.organizer!.id, id, filters);
    if (result.kind === "not_found") return fail(res, 404, "not_found");
    res.status(200).json({ emails: result.rows.map(emailShape), truncated: result.truncated });
  });

  return router;
}
