import { safeNext, validateEmail, validateName, validatePassword } from "./validate";

describe("validateEmail (W-A10)", () => {
  it.each(["ann@mail.com", "  ann@mail.com  ", "Ann@Mail.COM", "a@b"])("accepts %j", (email) => {
    expect(validateEmail(email)).toBeNull();
  });

  it.each(["", "   ", "ann", "@mail.com", "ann@", "a@b@c", "an n@mail.com", "ann@ma il.com"])(
    "refuses %j",
    (email) => {
      expect(validateEmail(email)).toBe("Enter a valid email address.");
    },
  );

  it("allows 254 characters and refuses 255", () => {
    const local = (size: number) => "a".repeat(size - "@mail.com".length);
    expect(validateEmail(`${local(254)}@mail.com`)).toBeNull();
    expect(validateEmail(`${local(255)}@mail.com`)).toBe("Enter a valid email address.");
  });
});

describe("validateName (W-A10)", () => {
  it("accepts 1 and 100 characters after trimming", () => {
    expect(validateName(" A ")).toBeNull();
    expect(validateName(`  ${"n".repeat(100)}  `)).toBeNull();
  });

  it("refuses empty, blank and 101 characters", () => {
    const text = "Enter your name (1 to 100 characters).";
    expect(validateName("")).toBe(text);
    expect(validateName("   ")).toBe(text);
    expect(validateName("n".repeat(101))).toBe(text);
  });
});

describe("validatePassword (W-A10)", () => {
  it("sign-up needs 8 to 128 characters, not trimmed", () => {
    const text = "Use 8 to 128 characters.";
    expect(validatePassword("1234567", "signup")).toBe(text);
    expect(validatePassword("12345678", "signup")).toBeNull();
    expect(validatePassword("p".repeat(128), "signup")).toBeNull();
    expect(validatePassword("p".repeat(129), "signup")).toBe(text);
    expect(validatePassword("        ", "signup")).toBeNull();
    expect(validatePassword(" 123456 ", "signup")).toBeNull();
  });

  it("counts characters as code points, like the API", () => {
    expect(validatePassword("\u{1F600}".repeat(8), "signup")).toBeNull();
    expect(validatePassword("\u{1F600}".repeat(128), "signup")).toBeNull();
    expect(validatePassword("\u{1F600}".repeat(129), "signup")).toBe("Use 8 to 128 characters.");
  });

  it("login only needs a non-empty password", () => {
    expect(validatePassword("", "login")).toBe("Enter your password.");
    expect(validatePassword("x", "login")).toBeNull();
    expect(validatePassword(" ", "login")).toBeNull();
  });
});

describe("safeNext (W-A5)", () => {
  it.each(["/", "/a", "/a?b=1", "/organizer?tab=2#x", "/tickets/abc"])("keeps %j", (next) => {
    expect(safeNext(next)).toBe(next);
  });

  it.each([
    null,
    undefined,
    "",
    "a",
    "//evil.com",
    "///evil.com",
    "https://x",
    "javascript:alert(1)",
    "/\\evil.com",
    "/\t/evil.com",
    "/ x",
  ])("refuses %j", (next) => {
    expect(safeNext(next)).toBeNull();
  });
});
