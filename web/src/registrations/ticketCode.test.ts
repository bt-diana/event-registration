// Tests first (registration-web.md W-R31, W-R32): the ticket code check, before any request.
import { parseTicketCode, normalizeTyped } from "./ticketCode";

describe("W-R31: parseTicketCode", () => {
  it.each(["K7M2QX9TPA", "H4Z8WR5NCD", "ABCDEFGHJK", "2345678923"])("%s is a ticket code", (code) => {
    expect(parseTicketCode(code)).toBe(code);
  });

  it("trims the decoded text", () => {
    expect(parseTicketCode("  K7M2QX9TPA\n")).toBe("K7M2QX9TPA");
  });

  it.each([
    ["lower case", "k7m2qx9tpa"],
    ["a space inside", "K7M2 QX9TPA"],
    ["I", "K7M2QX9TPI"],
    ["O", "K7M2QX9TPO"],
    ["0", "K7M2QX9TP0"],
    ["1", "K7M2QX9TP1"],
    ["length 9", "K7M2QX9TP"],
    ["length 11", "K7M2QX9TPAB"],
    ["a URL", "https://example.com/K7M2QX9TPA"],
    ["a prefix", "TICKET:K7M2QX9TPA"],
    ["empty", ""],
  ])("%s is not a ticket code", (_case, text) => {
    expect(parseTicketCode(text)).toBeNull();
  });
});

describe("W-R32: the typed code is upper-cased and its spaces removed first", () => {
  it.each([
    ["k7m2qx9tpa", "K7M2QX9TPA"],
    [" k7m2 qx9 tpa ", "K7M2QX9TPA"],
    ["K7M2-QX9TPA", null],
    ["", null],
  ])("%j gives %j", (typed, code) => {
    expect(parseTicketCode(normalizeTyped(typed))).toBe(code);
  });
});
