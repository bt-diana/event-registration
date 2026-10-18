import type { NextFunction, Request, Response } from "express";

// CORS for the one web origin in CORS_ORIGIN (api-base-url.md P3, R1-R4).
// Exact match only, no wildcard: a wildcard is not allowed with credentials.
// CORS_ORIGIN is read on each request, so tests can change it. Unset: no CORS
// headers at all. The browser enforces CORS; a request from another origin
// still reaches its route, it just gets no allow headers.
export function cors(req: Request, res: Response, next: NextFunction): void {
  const allowed = process.env.CORS_ORIGIN;
  if (!allowed) return next();

  res.vary("Origin");
  const origin = req.headers.origin;
  const match = origin === allowed;
  if (match) {
    res.setHeader("Access-Control-Allow-Origin", allowed);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }

  // A preflight ends here with 204 and never reaches auth or a route. Only
  // the allowed origin gets the methods and headers.
  const preflight =
    req.method === "OPTIONS" &&
    origin !== undefined &&
    req.headers["access-control-request-method"] !== undefined;
  if (preflight) {
    if (match) {
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    }
    res.status(204).end();
    return;
  }
  next();
}
