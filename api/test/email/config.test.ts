import { describe, expect, it } from "vitest";
import { readMailConfig } from "../../src/email/config.js";

// The mail settings (email-reminders.md ER44-ER46, D59), tests first. Plain
// objects only: the real environment and the real key are never read.

const KEY = "re_test_secret";
const FROM = "onboarding@resend.dev";
const BAD_VALUES = [undefined, "", "   ", "\t\n"];

function messageOf(env: Record<string, string | undefined>): string {
  try {
    readMailConfig(env);
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return (error as Error).message;
  }
  throw new Error("expected readMailConfig to throw");
}

describe("ER44: readMailConfig reads the two settings (tests first)", () => {
  it("returns the key and the sender, trimmed", () => {
    expect(readMailConfig({ EMAIL_API_KEY: KEY, MAIL_FROM: FROM })).toEqual({ apiKey: KEY, from: FROM });
    expect(readMailConfig({ EMAIL_API_KEY: `  ${KEY}\n`, MAIL_FROM: " Events <onboarding@resend.dev> " })).toEqual({
      apiKey: KEY,
      from: "Events <onboarding@resend.dev>",
    });
  });

  it("reads only the object it gets, not process.env", () => {
    const saved = { key: process.env.EMAIL_API_KEY, from: process.env.MAIL_FROM };
    process.env.EMAIL_API_KEY = "from-process-env";
    process.env.MAIL_FROM = "process@example.com";
    try {
      expect(() => readMailConfig({})).toThrow(/EMAIL_API_KEY/);
      expect(readMailConfig({ EMAIL_API_KEY: KEY, MAIL_FROM: FROM })).toEqual({ apiKey: KEY, from: FROM });
    } finally {
      if (saved.key === undefined) delete process.env.EMAIL_API_KEY;
      else process.env.EMAIL_API_KEY = saved.key;
      if (saved.from === undefined) delete process.env.MAIL_FROM;
      else process.env.MAIL_FROM = saved.from;
    }
  });
});

describe("ER45: a missing or blank setting stops the start (tests first)", () => {
  it("names EMAIL_API_KEY when it is missing, empty or blank", () => {
    expect(messageOf({ MAIL_FROM: FROM })).toContain("EMAIL_API_KEY");
    for (const value of BAD_VALUES) {
      const message = messageOf({ EMAIL_API_KEY: value, MAIL_FROM: FROM });
      expect(message, JSON.stringify(value)).toContain("EMAIL_API_KEY");
      expect(message, JSON.stringify(value)).not.toContain("MAIL_FROM");
    }
  });

  it("names MAIL_FROM when it is missing, empty or blank", () => {
    expect(messageOf({ EMAIL_API_KEY: KEY })).toContain("MAIL_FROM");
    for (const value of BAD_VALUES) {
      const message = messageOf({ EMAIL_API_KEY: KEY, MAIL_FROM: value });
      expect(message, JSON.stringify(value)).toContain("MAIL_FROM");
      expect(message, JSON.stringify(value)).not.toContain("EMAIL_API_KEY");
    }
  });

  it("names both when both are bad", () => {
    for (const value of BAD_VALUES) {
      const message = messageOf({ EMAIL_API_KEY: value, MAIL_FROM: value });
      expect(message).toContain("EMAIL_API_KEY");
      expect(message).toContain("MAIL_FROM");
    }
    const message = messageOf({});
    expect(message).toContain("EMAIL_API_KEY");
    expect(message).toContain("MAIL_FROM");
  });
});

describe("ER46: the message never holds a value (tests first)", () => {
  it("does not contain the key when MAIL_FROM is missing", () => {
    const message = messageOf({ EMAIL_API_KEY: KEY });
    expect(message).toContain("MAIL_FROM");
    expect(message).not.toContain(KEY);
  });

  it("does not contain the sender when the key is missing", () => {
    const from = "Events <owner-address@example.com>";
    const message = messageOf({ MAIL_FROM: from });
    expect(message).toContain("EMAIL_API_KEY");
    expect(message).not.toContain(from);
    expect(message).not.toContain("owner-address@example.com");
  });
});
