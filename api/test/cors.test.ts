import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { listen, TEST_SECRET, type Running } from "./auth/helpers.js";

// api-base-url.md R1-R4: the CORS answer for the one web origin in CORS_ORIGIN.
const WEB = "https://web.example.com";
const OTHER = "https://evil.example.com";

const running: Running[] = [];
function start(): Running {
  const r = listen(createApp({ cookieSecret: TEST_SECRET }));
  running.push(r);
  return r;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(running.splice(0).map((r) => r.close()));
});

function preflight(api: Running, path: string, origin: string) {
  return fetch(`${api.url}${path}`, {
    method: "OPTIONS",
    headers: {
      origin,
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type",
    },
  });
}

function expectNoCorsAllow(res: Response) {
  expect(res.headers.get("access-control-allow-origin")).toBeNull();
  expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  expect(res.headers.get("access-control-allow-methods")).toBeNull();
  expect(res.headers.get("access-control-allow-headers")).toBeNull();
}

function varyHasOrigin(res: Response): boolean {
  const vary = res.headers.get("vary") ?? "";
  return vary.split(",").some((v) => v.trim().toLowerCase() === "origin");
}

describe("R1: CORS_ORIGIN set, request from that origin", () => {
  it("allows exactly that origin with credentials and varies on Origin", async () => {
    vi.stubEnv("CORS_ORIGIN", WEB);
    const api = start();
    const res = await fetch(`${api.url}/health`, { headers: { origin: WEB } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("access-control-allow-origin")).toBe(WEB);
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    expect(varyHasOrigin(res)).toBe(true);
  });

  it("also on an error answer of a route", async () => {
    vi.stubEnv("CORS_ORIGIN", WEB);
    const api = start();
    const res = await fetch(`${api.url}/auth/me`, { headers: { origin: WEB } });
    expect(res.status).toBe(401);
    expect(res.headers.get("access-control-allow-origin")).toBe(WEB);
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });
});

describe("R2: CORS_ORIGIN set, preflight from that origin", () => {
  it("answers 204 with the methods, Content-Type and the R1 headers", async () => {
    vi.stubEnv("CORS_ORIGIN", WEB);
    const api = start();
    const res = await preflight(api, "/auth/users/login", WEB);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    const methods = (res.headers.get("access-control-allow-methods") ?? "")
      .split(",")
      .map((m) => m.trim());
    expect(methods).toEqual(expect.arrayContaining(["GET", "POST", "OPTIONS"]));
    expect(res.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("content-type");
    expect(res.headers.get("access-control-allow-origin")).toBe(WEB);
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    expect(varyHasOrigin(res)).toBe(true);
  });

  it("does not reach any route handler or the 404 handler", async () => {
    vi.stubEnv("CORS_ORIGIN", WEB);
    const api = start();
    // Without the middleware OPTIONS gets Express's automatic 200 with Allow or
    // the app's 404 (R4); the preflight ends before both.
    for (const path of ["/health", "/auth/users/login", "/no-such-route"]) {
      const res = await preflight(api, path, WEB);
      expect(res.status, path).toBe(204);
      expect(res.headers.get("allow"), path).toBeNull();
      expect(await res.text(), path).toBe("");
    }
  });
});

describe("R3: CORS_ORIGIN set, other origin or no Origin", () => {
  it("a request from another origin gets no allow headers, the route still answers", async () => {
    vi.stubEnv("CORS_ORIGIN", WEB);
    const api = start();
    const res = await fetch(`${api.url}/health`, { headers: { origin: OTHER } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expectNoCorsAllow(res);
    expect(varyHasOrigin(res)).toBe(true);
  });

  it("an origin that only starts like the allowed one is another origin", async () => {
    vi.stubEnv("CORS_ORIGIN", WEB);
    const api = start();
    for (const origin of [`${WEB}/`, `${WEB}.evil.com`, "http://web.example.com", "null"]) {
      const res = await fetch(`${api.url}/health`, { headers: { origin } });
      expect(res.status, origin).toBe(200);
      expectNoCorsAllow(res);
    }
  });

  it("a preflight from another origin gets no allow headers", async () => {
    vi.stubEnv("CORS_ORIGIN", WEB);
    const api = start();
    const res = await preflight(api, "/auth/users/login", OTHER);
    expect(res.status).toBe(204);
    expectNoCorsAllow(res);
    expect(varyHasOrigin(res)).toBe(true);
  });

  it("a request with no Origin gets no allow headers, the route still answers", async () => {
    vi.stubEnv("CORS_ORIGIN", WEB);
    const api = start();
    const res = await fetch(`${api.url}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expectNoCorsAllow(res);
    expect(varyHasOrigin(res)).toBe(true);
  });
});

describe("R4: CORS_ORIGIN unset", () => {
  it("sends no CORS headers, and OPTIONS is handled as today", async () => {
    vi.stubEnv("CORS_ORIGIN", undefined);
    const api = start();
    const res = await fetch(`${api.url}/health`, { headers: { origin: WEB } });
    expect(res.status).toBe(200);
    expectNoCorsAllow(res);
    expect(varyHasOrigin(res)).toBe(false);

    // As today: a path of a sub-router gets Express's automatic OPTIONS answer
    // (200 with Allow); /health and unknown paths reach the app's 404 handler.
    const routed = await preflight(api, "/auth/users/login", WEB);
    expect(routed.status).toBe(200);
    expect(routed.headers.get("allow")).toContain("POST");
    expectNoCorsAllow(routed);
    expect(varyHasOrigin(routed)).toBe(false);

    for (const path of ["/health", "/no-such-route"]) {
      const options = await preflight(api, path, WEB);
      expect(options.status, path).toBe(404);
      expect(await options.json(), path).toEqual({ error: "not_found" });
      expectNoCorsAllow(options);
      expect(varyHasOrigin(options)).toBe(false);
    }
  });
});
