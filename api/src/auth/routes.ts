import { Router, type Request, type Response } from "express";
import type pg from "pg";
import { clearSession, setSession, type Role } from "./cookie.js";
import { requireOrganizer, requireUser } from "./middleware.js";
import { DUMMY_HASH, hashPassword, verifyPassword } from "./password.js";

// The only place a table name comes from. Never from the request.
const ROLES: ReadonlyArray<{ path: string; table: "users" | "organizers"; role: Role }> = [
  { path: "users", table: "users", role: "user" },
  { path: "organizers", table: "organizers", role: "organizer" },
];

type Account = { id: string; email: string; name: string };

const EMAIL = /^[^@\s]+@[^@\s]+$/;
const MAX_EMAIL = 254;
const MAX_NAME = 100;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128;

// Characters as code points, the same way JSON Schema counts them.
function length(text: string): number {
  return [...text].length;
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

function fields(body: unknown): Record<string, unknown> | null {
  return typeof body === "object" && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

function parseSignup(body: unknown): { email: string; name: string; password: string } | null {
  const b = fields(body);
  if (!b) return null;
  const { email, name, password } = b;
  if (typeof email !== "string" || typeof name !== "string" || typeof password !== "string") {
    return null;
  }
  const cleanEmail = normaliseEmail(email);
  const cleanName = name.trim();
  if (length(cleanEmail) > MAX_EMAIL || !EMAIL.test(cleanEmail)) return null;
  if (length(cleanName) < 1 || length(cleanName) > MAX_NAME) return null;
  if (length(password) < MIN_PASSWORD || length(password) > MAX_PASSWORD) return null;
  return { email: cleanEmail, name: cleanName, password };
}

function parseLogin(body: unknown): { email: string; password: string } | null {
  const b = fields(body);
  if (!b) return null;
  const { email, password } = b;
  if (typeof email !== "string" || typeof password !== "string") return null;
  return { email: normaliseEmail(email), password };
}

function fail(res: Response, status: number, error: string): void {
  res.status(status).json({ error });
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "23505";
}

// The four routes per role: signup, login, logout, me. One handler set for both.
export function authRouter(pool: pg.Pool): Router {
  const router = Router();

  for (const { path, table, role } of ROLES) {
    const base = `/auth/${path}`;

    router.post(`${base}/signup`, async (req: Request, res: Response) => {
      const input = parseSignup(req.body);
      if (!input) return fail(res, 400, "invalid_input");
      const passwordHash = await hashPassword(input.password);
      let account: Account;
      try {
        // lower() again in SQL, so the stored value always meets the table CHECK.
        const { rows } = await pool.query<Account>(
          `INSERT INTO ${table} (email, name, password_hash) VALUES (lower($1), $2, $3)
           RETURNING id, email, name`,
          [input.email, input.name, passwordHash],
        );
        account = rows[0];
      } catch (error) {
        if (isUniqueViolation(error)) return fail(res, 409, "email_taken");
        throw error;
      }
      setSession(res, role, account.id);
      res.status(201).json(account);
    });

    router.post(`${base}/login`, async (req: Request, res: Response) => {
      const input = parseLogin(req.body);
      if (!input) return fail(res, 400, "invalid_input");
      const { rows } = await pool.query<Account & { password_hash: string }>(
        `SELECT id, email, name, password_hash FROM ${table} WHERE email = lower($1)`,
        [input.email],
      );
      const row = rows[0];
      // An unknown email still runs one scrypt, so both failures take about as long.
      const ok = await verifyPassword(input.password, row?.password_hash ?? DUMMY_HASH);
      if (!row || !ok) return fail(res, 401, "invalid_credentials");
      setSession(res, role, row.id);
      res.status(200).json({ id: row.id, email: row.email, name: row.name });
    });

    router.post(`${base}/logout`, (_req: Request, res: Response) => {
      clearSession(res);
      res.status(204).end();
    });

    const guard = role === "user" ? requireUser : requireOrganizer;
    router.get(`${base}/me`, guard, async (req: Request, res: Response) => {
      const id = role === "user" ? req.user!.id : req.organizer!.id;
      const { rows } = await pool.query<Account>(
        `SELECT id, email, name FROM ${table} WHERE id = $1`,
        [id],
      );
      if (!rows[0]) return fail(res, 401, "not_logged_in");
      res.status(200).json(rows[0]);
    });
  }

  return router;
}
