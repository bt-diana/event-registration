import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi, type MockInstance } from "vitest";
import { createApp } from "../../src/app.js";
import { createTestDb, type TestDb } from "../db/helpers.js";
import { listen, sessionCookie, sessionSetCookie, TEST_SECRET, type Running } from "./helpers.js";

// Every test password contains this marker, so the log check can find it.
const MARK = "pw-secret-";
const PASSWORD = `${MARK}12345`;

let db: TestDb;
let api: Running;
const logSpies: MockInstance[] = [];

beforeAll(async () => {
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    logSpies.push(vi.spyOn(console, method));
  }
  db = await createTestDb();
  api = listen(createApp({ pool: db.pool, cookieSecret: TEST_SECRET }));
});

afterAll(async () => {
  await api?.close();
  await db?.drop();
  for (const spy of logSpies) spy.mockRestore();
});

type Reply = {
  status: number;
  body: unknown;
  cookie: string | undefined;
  setCookie: string | undefined;
};

// Calls the API and checks A16 on every response: no password_hash and no
// password in the body.
async function call(
  method: "GET" | "POST",
  path: string,
  options: { body?: unknown; raw?: string; cookie?: string } = {},
): Promise<Reply> {
  const headers: Record<string, string> = {};
  let payload: string | undefined;
  if (options.raw !== undefined) {
    headers["content-type"] = "application/json";
    payload = options.raw;
  } else if (options.body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(options.body);
  }
  if (options.cookie !== undefined) headers.cookie = options.cookie;

  const res = await fetch(`${api.url}${path}`, { method, headers, body: payload });
  const text = await res.text();
  expect(text).not.toContain("password_hash");
  expect(text).not.toContain(MARK);
  return {
    status: res.status,
    body: text === "" ? null : JSON.parse(text),
    cookie: sessionCookie(res),
    setCookie: sessionSetCookie(res),
  };
}

function email(prefix = "person"): string {
  return `${prefix}-${randomUUID()}@example.com`;
}

async function countRows(table: "users" | "organizers", address: string): Promise<number> {
  const { rows } = await db.pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ${table} WHERE email = $1`,
    [address],
  );
  return rows[0].n;
}

const ROLES = [
  { path: "users", table: "users", role: "user", otherPath: "organizers" },
  { path: "organizers", table: "organizers", role: "organizer", otherPath: "users" },
] as const;

describe.each(ROLES)("auth routes for /auth/$path", ({ path, table, otherPath }) => {
  const base = `/auth/${path}`;

  async function signup(address: string, name = "Ann", password = PASSWORD) {
    return call("POST", `${base}/signup`, { body: { email: address, name, password } });
  }

  it("A4: sign-up creates the row, sets the cookie, answers 201 with { id, email, name }", async () => {
    const address = email();
    const reply = await signup(address, "Ann Smith");
    expect(reply.status).toBe(201);
    expect(reply.body).toEqual({ id: expect.any(String), email: address, name: "Ann Smith" });
    expect(reply.cookie).toMatch(/^session=s%3A/);

    const { rows } = await db.pool.query(
      `SELECT id, email, name, password_hash FROM ${table} WHERE email = $1`,
      [address],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe((reply.body as { id: string }).id);
    expect(rows[0].password_hash).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);

    const me = await call("GET", `${base}/me`, { cookie: reply.cookie });
    expect(me.status).toBe(200);
    expect(me.body).toEqual(reply.body);
  });

  it("A5: the email is trimmed and lowercased for sign-up and login; the name is trimmed", async () => {
    const id = randomUUID();
    const reply = await signup(`  Ann-${id}@Mail.COM `, "  Ann  ");
    expect(reply.status).toBe(201);
    expect(reply.body).toMatchObject({ email: `ann-${id}@mail.com`, name: "Ann" });
    expect(await countRows(table, `ann-${id}@mail.com`)).toBe(1);

    const login = await call("POST", `${base}/login`, {
      body: { email: `ANN-${id}@mail.com`, password: PASSWORD },
    });
    expect(login.status).toBe(200);
    expect(login.body).toEqual(reply.body);
  });

  it("A6: an existing email answers 409 and creates nothing", async () => {
    const address = email();
    expect((await signup(address)).status).toBe(201);

    const again = await signup(`  ${address.toUpperCase()}  `, "Other");
    expect(again.status).toBe(409);
    expect(again.body).toEqual({ error: "email_taken" });
    expect(again.cookie).toBeUndefined();
    expect(await countRows(table, address)).toBe(1);
  });

  it("A6: two parallel sign-ups with one email give one row and one 409", async () => {
    for (let round = 0; round < 5; round++) {
      const address = email("parallel");
      const replies = await Promise.all([signup(address, "One"), signup(address, "Two")]);
      expect(replies.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await countRows(table, address)).toBe(1);
    }
  });

  it("A7: a bad sign-up body answers 400 and creates nothing", async () => {
    const address = email("bad");
    const long = `${"a".repeat(243)}@example.com`; // 255 characters
    expect(long).toHaveLength(255);
    const bodies: unknown[] = [
      {},
      { name: "Ann", password: PASSWORD },
      { email: address, password: PASSWORD },
      { email: address, name: "Ann" },
      { email: 42, name: "Ann", password: PASSWORD },
      { email: address, name: ["Ann"], password: PASSWORD },
      { email: address, name: "Ann", password: 12345678 },
      { email: address, name: "Ann", password: null },
      { email: "no-at-sign.example.com", name: "Ann", password: PASSWORD },
      { email: "two@at@example.com", name: "Ann", password: PASSWORD },
      { email: "@example.com", name: "Ann", password: PASSWORD },
      { email: "ann@", name: "Ann", password: PASSWORD },
      { email: "ann smith@example.com", name: "Ann", password: PASSWORD },
      { email: "   ", name: "Ann", password: PASSWORD },
      { email: long, name: "Ann", password: PASSWORD },
      { email: address, name: "", password: PASSWORD },
      { email: address, name: "   ", password: PASSWORD },
      { email: address, name: "n".repeat(101), password: PASSWORD },
      { email: address, name: "Ann", password: `${MARK}`.slice(0, 7) },
      { email: address, name: "Ann", password: `${MARK}${"x".repeat(129 - MARK.length)}` },
      [address, "Ann", PASSWORD],
      "just a string",
      null,
    ];
    for (const body of bodies) {
      const reply = await call("POST", `${base}/signup`, { body });
      expect(reply.status, JSON.stringify(body)).toBe(400);
      expect(reply.body).toEqual({ error: "invalid_input" });
      expect(reply.cookie).toBeUndefined();
    }
    const noBody = await call("POST", `${base}/signup`);
    expect(noBody.status).toBe(400);
    const badJson = await call("POST", `${base}/signup`, { raw: `{"email": "${address}",` });
    expect(badJson.status).toBe(400);
    expect(badJson.body).toEqual({ error: "invalid_input" });

    expect(await countRows(table, address)).toBe(0);
    expect(await countRows(table, long)).toBe(0);
  });

  it("A7: the limits themselves are accepted (8 and 128 password characters, 100 name characters, 254 email characters)", async () => {
    const short = await signup(email(), "Ann", `${MARK}`.slice(0, 8));
    expect(short.status).toBe(201);
    const longPassword = await signup(email(), "n".repeat(100), `${MARK}${"x".repeat(128 - MARK.length)}`);
    expect(longPassword.status).toBe(201);
    const longEmail = `${randomUUID()}${"a".repeat(206)}@example.com`;
    expect(longEmail).toHaveLength(254);
    expect((await signup(longEmail)).status).toBe(201);
  });

  it("A8: login with the right email and password sets the cookie and answers 200", async () => {
    const address = email();
    const created = await signup(address, "Bob");
    const login = await call("POST", `${base}/login`, { body: { email: address, password: PASSWORD } });
    expect(login.status).toBe(200);
    expect(login.body).toEqual(created.body);
    expect(login.cookie).toMatch(/^session=s%3A/);

    const me = await call("GET", `${base}/me`, { cookie: login.cookie });
    expect(me.status).toBe(200);
    expect(me.body).toEqual(created.body);
  });

  it("A9: unknown email and wrong password answer the same 401 and set no cookie", async () => {
    const address = email();
    await signup(address);
    const wrongPassword = await call("POST", `${base}/login`, {
      body: { email: address, password: `${MARK}wrong` },
    });
    const unknownEmail = await call("POST", `${base}/login`, {
      body: { email: email("nobody"), password: PASSWORD },
    });
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
    expect(wrongPassword.body).toEqual({ error: "invalid_credentials" });
    expect(wrongPassword.setCookie).toBeUndefined();
    expect(unknownEmail.setCookie).toBeUndefined();
  });

  it("login with a missing or non-string field answers 400", async () => {
    const bodies: unknown[] = [
      {},
      { email: email() },
      { password: PASSWORD },
      { email: 1, password: PASSWORD },
      { email: email(), password: 12345678 },
      [email(), PASSWORD],
      null,
    ];
    for (const body of bodies) {
      const reply = await call("POST", `${base}/login`, { body });
      expect(reply.status, JSON.stringify(body)).toBe(400);
      expect(reply.body).toEqual({ error: "invalid_input" });
      expect(reply.setCookie).toBeUndefined();
    }
    expect((await call("POST", `${base}/login`)).status).toBe(400);
  });

  it("A10: logout clears the cookie and answers 204, also when nobody is logged in", async () => {
    const created = await signup(email());
    const logout = await call("POST", `${base}/logout`, { cookie: created.cookie });
    expect(logout.status).toBe(204);
    expect(logout.body).toBeNull();
    expect(logout.setCookie).toMatch(/^session=;/);
    expect(logout.setCookie).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");

    const anonymous = await call("POST", `${base}/logout`);
    expect(anonymous.status).toBe(204);
    expect(anonymous.setCookie).toMatch(/^session=;/);
  });

  it("A10 limitation: a copy of the cookie stays valid after logout (no sessions table)", async () => {
    const created = await signup(email());
    await call("POST", `${base}/logout`, { cookie: created.cookie });
    const me = await call("GET", `${base}/me`, { cookie: created.cookie });
    expect(me.status).toBe(200);
  });

  it("A11: me without a valid cookie answers 401", async () => {
    const none = await call("GET", `${base}/me`);
    expect(none.status).toBe(401);
    expect(none.body).toEqual({ error: "not_logged_in" });

    const created = await signup(email());
    const tampered = created.cookie!.replace(/.$/, (c) => (c === "A" ? "B" : "A"));
    expect((await call("GET", `${base}/me`, { cookie: tampered })).status).toBe(401);
    const unsigned = `session=${encodeURIComponent(`${ROLES[0].role}.${randomUUID()}.${Date.now() + 1e6}`)}`;
    expect((await call("GET", `${base}/me`, { cookie: unsigned })).status).toBe(401);
  });

  it("A11: me reads the name from the database", async () => {
    const created = await signup(email(), "Old Name");
    const { id } = created.body as { id: string };
    await db.pool.query(`UPDATE ${table} SET name = 'New Name' WHERE id = $1`, [id]);
    const me = await call("GET", `${base}/me`, { cookie: created.cookie });
    expect(me.body).toMatchObject({ id, name: "New Name" });
  });

  it("me with a cookie of the other role answers 403", async () => {
    const other = await call("POST", `/auth/${otherPath}/signup`, {
      body: { email: email(), name: "Other", password: PASSWORD },
    });
    expect(other.status).toBe(201);
    const me = await call("GET", `${base}/me`, { cookie: other.cookie });
    expect(me.status).toBe(403);
    expect(me.body).toEqual({ error: "wrong_role" });
  });
});

describe("one email, two roles (A12)", () => {
  it("an attendee and an organizer may share one email; logging in as the other role replaces the cookie", async () => {
    const address = email("both");
    const user = await call("POST", "/auth/users/signup", {
      body: { email: address, name: "As user", password: PASSWORD },
    });
    const organizer = await call("POST", "/auth/organizers/signup", {
      body: { email: address, name: "As organizer", password: `${MARK}organizer` },
    });
    expect(user.status).toBe(201);
    expect(organizer.status).toBe(201);
    expect(await countRows("users", address)).toBe(1);
    expect(await countRows("organizers", address)).toBe(1);

    // The user is logged in; logging in as organizer gives a cookie with the other role.
    const login = await call("POST", "/auth/organizers/login", {
      body: { email: address, password: `${MARK}organizer` },
    });
    expect(login.status).toBe(200);
    expect(login.body).toEqual(organizer.body);
    expect((await call("GET", "/auth/organizers/me", { cookie: login.cookie })).status).toBe(200);
    expect((await call("GET", "/auth/users/me", { cookie: login.cookie })).status).toBe(403);

    // The attendee password does not open the organizer account.
    const wrong = await call("POST", "/auth/organizers/login", {
      body: { email: address, password: PASSWORD },
    });
    expect(wrong.status).toBe(401);
  });
});

describe("routes outside the fixed role map", () => {
  it("answers 404 for an unknown role", async () => {
    const reply = await call("POST", "/auth/admins/signup", {
      body: { email: email(), name: "Eve", password: PASSWORD },
    });
    expect(reply.status).toBe(404);
  });
});

describe("logs (A16)", () => {
  it("never logs a password", () => {
    for (const spy of logSpies) {
      for (const args of spy.mock.calls) {
        expect(JSON.stringify(args.map(String))).not.toContain(MARK);
      }
    }
  });
});
