import type { NextFunction, Request, Response } from "express";
import { readSession } from "./cookie.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Express request augmentation
  namespace Express {
    interface Request {
      // Set by `authenticate` from a valid attendee cookie.
      user?: { id: string };
      // Set by `authenticate` from a valid organizer cookie.
      organizer?: { id: string };
    }
  }
}

// Reads the signed cookie and sets req.user or req.organizer. Never fails:
// no cookie or an invalid one leaves both unset. Does not read the database.
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const session = readSession(req);
  if (session?.role === "user") req.user = { id: session.id };
  if (session?.role === "organizer") req.organizer = { id: session.id };
  next();
}

// 401 without a valid login, 403 when logged in as an organizer.
export function requireUser(req: Request, res: Response, next: NextFunction): void {
  if (req.user) return next();
  if (req.organizer) {
    res.status(403).json({ error: "wrong_role" });
    return;
  }
  res.status(401).json({ error: "not_logged_in" });
}

// 401 without a valid login, 403 when logged in as an attendee.
export function requireOrganizer(req: Request, res: Response, next: NextFunction): void {
  if (req.organizer) return next();
  if (req.user) {
    res.status(403).json({ error: "wrong_role" });
    return;
  }
  res.status(401).json({ error: "not_logged_in" });
}
