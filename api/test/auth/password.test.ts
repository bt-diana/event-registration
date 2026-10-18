import { describe, expect, it } from "vitest";
import { DUMMY_HASH, hashPassword, verifyPassword } from "../../src/auth/password.js";

// A1: scrypt hash with a random salt, stored as scrypt$<salt hex>$<key hex>.
describe("password hashing (A1)", () => {
  it("stores scrypt$<16-byte salt hex>$<64-byte key hex>", async () => {
    const stored = await hashPassword("correct horse battery");
    expect(stored).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  });

  it("gives two different strings for the same password", async () => {
    const a = await hashPassword("same password");
    const b = await hashPassword("same password");
    expect(a).not.toBe(b);
    expect(a.split("$")[1]).not.toBe(b.split("$")[1]);
  });

  it("verifies the right password and rejects a wrong one", async () => {
    const stored = await hashPassword("right password");
    expect(await verifyPassword("right password", stored)).toBe(true);
    expect(await verifyPassword("wrong password", stored)).toBe(false);
    expect(await verifyPassword("right passwor", stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
  });

  it("never contains the password in the stored text", async () => {
    const password = "plain-text-secret";
    const stored = await hashPassword(password);
    expect(stored).not.toContain(password);
    expect(stored).not.toContain(Buffer.from(password).toString("hex"));
  });

  it("verifies false, without throwing, for a malformed stored value", async () => {
    const good = await hashPassword("password1");
    const [, salt, key] = good.split("$");
    const malformed = [
      "",
      "hash",
      "scrypt$",
      `scrypt$${salt}`,
      `bcrypt$${salt}$${key}`,
      `scrypt$${salt}$${key}$extra`,
      `scrypt$${salt.slice(2)}$${key}`,
      `scrypt$${salt}$${key.slice(2)}`,
      `scrypt$${salt}$${key.slice(0, -2)}zz`,
      `scrypt$${salt}$${key}00`,
    ];
    for (const stored of malformed) {
      expect(await verifyPassword("password1", stored)).toBe(false);
    }
  });

  it("has a well-formed dummy hash that no ordinary password matches", async () => {
    expect(DUMMY_HASH).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    expect(await verifyPassword("password1", DUMMY_HASH)).toBe(false);
  });
});
