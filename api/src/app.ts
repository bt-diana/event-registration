import cookieParser from "cookie-parser";
import express, { type NextFunction, type Request, type Response } from "express";
import type pg from "pg";
import { authenticate } from "./auth/middleware.js";
import { authRouter } from "./auth/routes.js";
import { checkinRouter } from "./checkin/routes.js";
import { createPool, loadEnv } from "./db/pool.js";
import { emailRouter } from "./email/routes.js";
import { eventsRouter } from "./events/routes.js";
import { registrationsRouter } from "./registrations/routes.js";

export type AppOptions = {
  // Defaults to a pool on DATABASE_URL.
  pool?: pg.Pool;
  // Defaults to COOKIE_SECRET from the environment.
  cookieSecret?: string;
};

const MIN_SECRET = 32;

export function createApp(options: AppOptions = {}) {
  loadEnv();
  const secret = options.cookieSecret ?? process.env.COOKIE_SECRET;
  if (!secret || secret.length < MIN_SECRET) {
    throw new Error(`COOKIE_SECRET must be set to at least ${MIN_SECRET} characters`);
  }
  const pool = options.pool ?? createPool();

  const app = express();
  app.use(express.json());
  app.use(cookieParser(secret));
  app.use(authenticate);
  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });
  app.use(authRouter(pool));
  app.use(eventsRouter(pool));
  app.use(registrationsRouter(pool));
  app.use(checkinRouter(pool));
  app.use(emailRouter(pool));
  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });
  app.use(errorHandler);
  return app;
}

// Errors from the JSON parser are the caller's mistake. Bad JSON and a body
// over the size limit (far over every field limit, for example a too long
// password) answer 400 like any other invalid input (A7); other parser errors
// keep their 4xx status (for example 415 for an unsupported charset). Anything
// else is a 500. The request body is never logged, so a password cannot end up
// in the log.
function errorHandler(error: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) return next(error);
  const { type, status } = (error ?? {}) as { type?: unknown; status?: unknown };
  if (type === "entity.parse.failed" || type === "entity.too.large") {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  if (typeof type === "string" && typeof status === "number" && status >= 400 && status <= 499) {
    res.status(status).json({ error: "invalid_input" });
    return;
  }
  console.error(error instanceof Error ? error.stack : "unknown error");
  res.status(500).json({ error: "internal" });
}
