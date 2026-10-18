import type { CookieOptions, Request, Response } from "express";

export type Role = "user" | "organizer";
export type Session = { role: Role; id: string };

export const SESSION_COOKIE = "session";
export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIGITS = /^\d+$/;

// Read on every call, so `secure` follows NODE_ENV at the time.
function cookieOptions(): CookieOptions {
  return {
    signed: true,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
}

// Sets the signed cookie `<role>.<id>.<expiresAtMs>`, valid for 7 days from `now`.
export function setSession(res: Response, role: Role, id: string, now: number = Date.now()): void {
  const expiresAtMs = now + SESSION_MAX_AGE_MS;
  res.cookie(SESSION_COOKIE, `${role}.${id}.${expiresAtMs}`, {
    ...cookieOptions(),
    maxAge: SESSION_MAX_AGE_MS,
  });
}

// Clears the cookie in the browser. A copied cookie stays valid until it expires.
export function clearSession(res: Response): void {
  // Without `signed`, so the cleared value is empty instead of a signed "".
  res.clearCookie(SESSION_COOKIE, { ...cookieOptions(), signed: false });
}

// The login in the signed cookie, or null for no cookie, a bad signature,
// a malformed value, or an expiry at or before `now`.
export function readSession(req: Request, now: number = Date.now()): Session | null {
  const value: unknown = req.signedCookies?.[SESSION_COOKIE];
  if (typeof value !== "string") return null;

  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [role, id, expires] = parts;
  if (role !== "user" && role !== "organizer") return null;
  if (!UUID.test(id)) return null;
  if (!DIGITS.test(expires)) return null;
  const expiresAtMs = Number(expires);
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= now) return null;

  return { role, id };
}
