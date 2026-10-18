import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createPool } from "../src/db/pool.js";
import { TEST_SECRET } from "./auth/helpers.js";

// The app refuses to start without COOKIE_SECRET of at least 32 characters.
describe("createApp and COOKIE_SECRET", () => {
  const saved = process.env.COOKIE_SECRET;
  afterEach(() => {
    if (saved === undefined) delete process.env.COOKIE_SECRET;
    else process.env.COOKIE_SECRET = saved;
  });

  it("throws when the secret is empty or shorter than 32 characters", () => {
    expect(() => createApp({ cookieSecret: "" })).toThrow(/COOKIE_SECRET/);
    expect(() => createApp({ cookieSecret: "x".repeat(31) })).toThrow(/COOKIE_SECRET/);
  });

  it("throws when COOKIE_SECRET in the environment is empty or short", () => {
    process.env.COOKIE_SECRET = "";
    expect(() => createApp()).toThrow(/COOKIE_SECRET/);
    process.env.COOKIE_SECRET = "short";
    expect(() => createApp()).toThrow(/COOKIE_SECRET/);
  });

  it("starts with a secret of 32 characters, from the options or the environment", async () => {
    const pool = createPool({ max: 1 });
    try {
      expect(() => createApp({ pool, cookieSecret: "x".repeat(32) })).not.toThrow();
      process.env.COOKIE_SECRET = TEST_SECRET;
      expect(() => createApp({ pool })).not.toThrow();
    } finally {
      await pool.end();
    }
  });
});
