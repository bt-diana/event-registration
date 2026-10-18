import { randomUUID } from "node:crypto";
import cookieParser from "cookie-parser";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearSession,
  readSession,
  SESSION_MAX_AGE_MS,
  setSession,
  type Role,
} from "../../src/auth/cookie.js";
import { listen, sessionCookie, sessionSetCookie, TEST_SECRET, type Running } from "./helpers.js";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// A small app around the cookie functions. `now` lets a test move the clock.
function cookieApp(secret = TEST_SECRET) {
  const app = express();
  app.use(cookieParser(secret));
  app.post("/set", (req, res) => {
    const now = req.query.now === undefined ? undefined : Number(req.query.now);
    setSession(res, String(req.query.role) as Role, String(req.query.id), now);
    res.status(204).end();
  });
  // Signs any value with the app secret, to test signed but malformed content.
  app.post("/raw", (req, res) => {
    res.cookie("session", String(req.query.value), { signed: true });
    res.status(204).end();
  });
  app.post("/clear", (_req, res) => {
    clearSession(res);
    res.status(204).end();
  });
  app.get("/read", (req, res) => {
    const now = req.query.now === undefined ? undefined : Number(req.query.now);
    res.json({ session: readSession(req, now) });
  });
  return app;
}

const running: Running[] = [];
function start(secret?: string): Running {
  const r = listen(cookieApp(secret));
  running.push(r);
  return r;
}

afterEach(async () => {
  await Promise.all(running.splice(0).map((r) => r.close()));
});

async function setCookie(api: Running, role: string, id: string, now?: number) {
  const query = new URLSearchParams({ role, id });
  if (now !== undefined) query.set("now", String(now));
  const res = await fetch(`${api.url}/set?${query}`, { method: "POST" });
  expect(res.status).toBe(204);
  return res;
}

async function read(api: Running, cookie: string | undefined, now?: number) {
  const query = now === undefined ? "" : `?now=${now}`;
  const res = await fetch(`${api.url}/read${query}`, {
    headers: cookie === undefined ? {} : { cookie },
  });
  return ((await res.json()) as { session: unknown }).session;
}

// The value inside the signed cookie, unsigned with the given secret.
function unsignedValue(cookie: string, secret = TEST_SECRET): string | false {
  const raw = decodeURIComponent(cookie.slice("session=".length));
  return cookieParser.signedCookie(raw, secret) as string | false;
}

describe("session cookie (A2)", () => {
  it("is signed, httpOnly, sameSite=lax, path /, 7 days, and not secure outside production", async () => {
    const api = start();
    const id = randomUUID();
    const before = Date.now();
    const res = await setCookie(api, "user", id);
    const header = sessionSetCookie(res);
    expect(header).toBeDefined();
    const parts = header!.split(";").map((p) => p.trim());

    expect(parts[0]).toMatch(/^session=s%3A/);
    expect(parts).toContain("HttpOnly");
    expect(parts).toContain("SameSite=Lax");
    expect(parts).toContain("Path=/");
    expect(parts).toContain(`Max-Age=${SEVEN_DAYS_MS / 1000}`);
    expect(parts).not.toContain("Secure");

    const expires = parts.find((p) => p.startsWith("Expires="));
    const expiresAt = Date.parse(expires!.slice("Expires=".length));
    expect(expiresAt).toBeGreaterThanOrEqual(before + SEVEN_DAYS_MS - 1000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + SEVEN_DAYS_MS + 1000);
  });

  it("is secure when NODE_ENV=production", async () => {
    const api = start();
    const old = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const res = await setCookie(api, "organizer", randomUUID());
      const parts = sessionSetCookie(res)!.split(";").map((p) => p.trim());
      expect(parts).toContain("Secure");
    } finally {
      process.env.NODE_ENV = old;
    }
  });

  it("carries <role>.<id>.<expiresAtMs> with the expiry 7 days ahead", async () => {
    expect(SESSION_MAX_AGE_MS).toBe(SEVEN_DAYS_MS);
    const api = start();
    const id = randomUUID();
    const now = Date.now();
    const cookie = sessionCookie(await setCookie(api, "organizer", id, now))!;
    expect(unsignedValue(cookie)).toBe(`organizer.${id}.${now + SEVEN_DAYS_MS}`);
  });

  it("reads back the role and the id, for both roles", async () => {
    const api = start();
    const userId = randomUUID();
    const organizerId = randomUUID();
    const userCookie = sessionCookie(await setCookie(api, "user", userId));
    const organizerCookie = sessionCookie(await setCookie(api, "organizer", organizerId));
    expect(await read(api, userCookie)).toEqual({ role: "user", id: userId });
    expect(await read(api, organizerCookie)).toEqual({ role: "organizer", id: organizerId });
  });

  it("is cleared by clearSession", async () => {
    const api = start();
    const res = await fetch(`${api.url}/clear`, { method: "POST" });
    const header = sessionSetCookie(res);
    expect(header).toBeDefined();
    expect(header).toMatch(/^session=;/);
    expect(header).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  });
});

// api-base-url.md R5, R6: SameSite and Secure follow CORS_ORIGIN and NODE_ENV.
describe("session cookie across sites (R5, R6)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function setParts(api: Running): Promise<string[]> {
    const res = await setCookie(api, "user", randomUUID());
    return sessionSetCookie(res)!.split(";").map((p) => p.trim());
  }

  async function clearParts(api: Running): Promise<string[]> {
    const res = await fetch(`${api.url}/clear`, { method: "POST" });
    return sessionSetCookie(res)!.split(";").map((p) => p.trim());
  }

  it("R5: CORS_ORIGIN set and production: SameSite=None and Secure, still httpOnly, 7 days, signed", async () => {
    vi.stubEnv("CORS_ORIGIN", "https://web.example.com");
    vi.stubEnv("NODE_ENV", "production");
    const api = start();
    const parts = await setParts(api);
    expect(parts[0]).toMatch(/^session=s%3A/);
    expect(parts).toContain("SameSite=None");
    expect(parts).not.toContain("SameSite=Lax");
    expect(parts).toContain("Secure");
    expect(parts).toContain("HttpOnly");
    expect(parts).toContain("Path=/");
    expect(parts).toContain(`Max-Age=${SEVEN_DAYS_MS / 1000}`);
  });

  it("R5: clearSession uses the same options", async () => {
    vi.stubEnv("CORS_ORIGIN", "https://web.example.com");
    vi.stubEnv("NODE_ENV", "production");
    const api = start();
    const parts = await clearParts(api);
    expect(parts[0]).toBe("session=");
    expect(parts).toContain("SameSite=None");
    expect(parts).toContain("Secure");
    expect(parts).toContain("HttpOnly");
    expect(parts).toContain("Path=/");
  });

  it("R6: CORS_ORIGIN set outside production: SameSite=Lax and not secure", async () => {
    vi.stubEnv("CORS_ORIGIN", "https://web.example.com");
    vi.stubEnv("NODE_ENV", "test");
    const api = start();
    for (const parts of [await setParts(api), await clearParts(api)]) {
      expect(parts).toContain("SameSite=Lax");
      expect(parts).not.toContain("Secure");
      expect(parts).toContain("HttpOnly");
    }
  });

  it("R6: CORS_ORIGIN unset in production: SameSite=Lax and Secure", async () => {
    vi.stubEnv("CORS_ORIGIN", undefined);
    vi.stubEnv("NODE_ENV", "production");
    const api = start();
    for (const parts of [await setParts(api), await clearParts(api)]) {
      expect(parts).toContain("SameSite=Lax");
      expect(parts).toContain("Secure");
      expect(parts).toContain("HttpOnly");
    }
  });

  it("R6: CORS_ORIGIN unset outside production: SameSite=Lax and not secure", async () => {
    vi.stubEnv("CORS_ORIGIN", undefined);
    vi.stubEnv("NODE_ENV", "test");
    const api = start();
    for (const parts of [await setParts(api), await clearParts(api)]) {
      expect(parts).toContain("SameSite=Lax");
      expect(parts).not.toContain("Secure");
    }
  });
});

describe("invalid session cookie counts as no login (A3)", () => {
  it("no cookie is no login", async () => {
    const api = start();
    expect(await read(api, undefined)).toBeNull();
  });

  it("a changed value with the old signature is no login", async () => {
    const api = start();
    const id = randomUUID();
    const cookie = sessionCookie(await setCookie(api, "user", id))!;
    const tampered = cookie.replace("s%3Auser.", "s%3Aorganizer.");
    expect(tampered).not.toBe(cookie);
    expect(await read(api, tampered)).toBeNull();

    const otherId = cookie.replace(id, randomUUID());
    expect(await read(api, otherId)).toBeNull();

    const badSignature = cookie.slice(0, -2) + (cookie.endsWith("AA") ? "BB" : "AA");
    expect(await read(api, badSignature)).toBeNull();
  });

  it("an unsigned cookie is no login", async () => {
    const api = start();
    const value = encodeURIComponent(`user.${randomUUID()}.${Date.now() + SEVEN_DAYS_MS}`);
    expect(await read(api, `session=${value}`)).toBeNull();
  });

  it("a cookie signed with another secret is no login", async () => {
    const other = start("another-secret-another-secret-another-secret");
    const api = start();
    const cookie = sessionCookie(await setCookie(other, "user", randomUUID()))!;
    expect(await read(other, cookie)).not.toBeNull();
    expect(await read(api, cookie)).toBeNull();
  });

  it("a cookie past its 7 days is no login, checked on the server", async () => {
    const api = start();
    const id = randomUUID();
    const old = sessionCookie(await setCookie(api, "user", id, Date.now() - SEVEN_DAYS_MS - 1000))!;
    expect(await read(api, old)).toBeNull();

    const issuedAt = Date.now();
    const fresh = sessionCookie(await setCookie(api, "user", id, issuedAt))!;
    expect(await read(api, fresh, issuedAt + SEVEN_DAYS_MS - 1)).toEqual({ role: "user", id });
    expect(await read(api, fresh, issuedAt + SEVEN_DAYS_MS)).toBeNull();
  });

  it("signed but malformed content is no login", async () => {
    const api = start();
    const id = randomUUID();
    const future = Date.now() + SEVEN_DAYS_MS;
    const values = [
      `admin.${id}.${future}`,
      `.${id}.${future}`,
      `user.not-a-uuid.${future}`,
      `user.${id}`,
      `user.${id}.`,
      `user.${id}.soon`,
      `user.${id}.${future}.extra`,
      `user.${id}.-1`,
      `user.${id}.1e20`,
      "",
    ];
    for (const value of values) {
      const res = await fetch(`${api.url}/raw?value=${encodeURIComponent(value)}`, {
        method: "POST",
      });
      const cookie = sessionCookie(res)!;
      expect(unsignedValue(cookie)).toBe(value);
      expect(await read(api, cookie)).toBeNull();
    }
  });
});
