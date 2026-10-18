import { randomUUID } from "node:crypto";
import cookieParser from "cookie-parser";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SESSION_MAX_AGE_MS, setSession, type Role } from "../../src/auth/cookie.js";
import { authenticate, requireOrganizer, requireUser } from "../../src/auth/middleware.js";
import { listen, sessionCookie, TEST_SECRET, type Running } from "./helpers.js";

// Counts how often each guarded handler really ran.
const ran = { user: 0, organizer: 0 };

function guardedApp(secret = TEST_SECRET) {
  const app = express();
  app.use(cookieParser(secret));
  app.use(authenticate);
  // Mints a cookie; `now` moves the clock for the expired case.
  app.post("/mint", (req, res) => {
    const now = req.query.now === undefined ? undefined : Number(req.query.now);
    setSession(res, String(req.query.role) as Role, String(req.query.id), now);
    res.status(204).end();
  });
  app.get("/whoami", (req, res) => {
    res.json({ user: req.user ?? null, organizer: req.organizer ?? null });
  });
  app.get("/attendee-only", requireUser, (req, res) => {
    ran.user++;
    res.json({ id: req.user!.id });
  });
  app.get("/organizer-only", requireOrganizer, (req, res) => {
    ran.organizer++;
    res.json({ id: req.organizer!.id });
  });
  return app;
}

let api: Running;
let other: Running;

beforeAll(() => {
  api = listen(guardedApp());
  other = listen(guardedApp("another-secret-another-secret-another-secret"));
});

afterAll(async () => {
  await api?.close();
  await other?.close();
});

beforeEach(() => {
  ran.user = 0;
  ran.organizer = 0;
});

async function mint(role: Role, id = randomUUID(), now?: number, on = api): Promise<string> {
  const query = new URLSearchParams({ role, id });
  if (now !== undefined) query.set("now", String(now));
  const res = await fetch(`${on.url}/mint?${query}`, { method: "POST" });
  return sessionCookie(res)!;
}

async function get(path: string, cookie?: string) {
  const res = await fetch(`${api.url}${path}`, { headers: cookie ? { cookie } : {} });
  return { status: res.status, body: (await res.json()) as unknown };
}

// Cookies that must all count as no login (A3).
async function invalidCookies(): Promise<Record<string, string>> {
  const good = await mint("user");
  return {
    tampered: good.replace("s%3Auser.", "s%3Aorganizer."),
    "bad signature": good.slice(0, -1) + (good.endsWith("A") ? "B" : "A"),
    unsigned: `session=${encodeURIComponent(`organizer.${randomUUID()}.${Date.now() + SESSION_MAX_AGE_MS}`)}`,
    "other secret": await mint("organizer", randomUUID(), undefined, other),
    expired: await mint("organizer", randomUUID(), Date.now() - SESSION_MAX_AGE_MS - 1000),
  };
}

describe("authenticate (A13)", () => {
  it("sets req.user to { id } for an attendee cookie", async () => {
    const id = randomUUID();
    const reply = await get("/whoami", await mint("user", id));
    expect(reply).toEqual({ status: 200, body: { user: { id }, organizer: null } });
  });

  it("sets req.organizer to { id } for an organizer cookie", async () => {
    const id = randomUUID();
    const reply = await get("/whoami", await mint("organizer", id));
    expect(reply).toEqual({ status: 200, body: { user: null, organizer: { id } } });
  });

  it("sets neither, and does not fail, without a cookie or with an invalid one", async () => {
    expect(await get("/whoami")).toEqual({ status: 200, body: { user: null, organizer: null } });
    for (const [name, cookie] of Object.entries(await invalidCookies())) {
      const reply = await get("/whoami", cookie);
      expect(reply, name).toEqual({ status: 200, body: { user: null, organizer: null } });
    }
  });
});

describe("requireUser and requireOrganizer (A14, A15)", () => {
  it("A14: no cookie answers 401 on both guards", async () => {
    expect(await get("/attendee-only")).toEqual({ status: 401, body: { error: "not_logged_in" } });
    expect(await get("/organizer-only")).toEqual({ status: 401, body: { error: "not_logged_in" } });
    expect(ran).toEqual({ user: 0, organizer: 0 });
  });

  it("A14: an invalid cookie answers 401 on both guards", async () => {
    for (const [name, cookie] of Object.entries(await invalidCookies())) {
      expect(await get("/attendee-only", cookie), name).toEqual({
        status: 401,
        body: { error: "not_logged_in" },
      });
      expect(await get("/organizer-only", cookie), name).toEqual({
        status: 401,
        body: { error: "not_logged_in" },
      });
    }
    expect(ran).toEqual({ user: 0, organizer: 0 });
  });

  it("A15: an attendee cookie on an organizer route answers 403 and runs no handler", async () => {
    const reply = await get("/organizer-only", await mint("user"));
    expect(reply).toEqual({ status: 403, body: { error: "wrong_role" } });
    expect(ran).toEqual({ user: 0, organizer: 0 });
  });

  it("A15: an organizer cookie on an attendee route answers 403 and runs no handler", async () => {
    const reply = await get("/attendee-only", await mint("organizer"));
    expect(reply).toEqual({ status: 403, body: { error: "wrong_role" } });
    expect(ran).toEqual({ user: 0, organizer: 0 });
  });

  it("lets the right role through with its id", async () => {
    const userId = randomUUID();
    const organizerId = randomUUID();
    expect(await get("/attendee-only", await mint("user", userId))).toEqual({
      status: 200,
      body: { id: userId },
    });
    expect(await get("/organizer-only", await mint("organizer", organizerId))).toEqual({
      status: 200,
      body: { id: organizerId },
    });
    expect(ran).toEqual({ user: 1, organizer: 1 });
  });
});
