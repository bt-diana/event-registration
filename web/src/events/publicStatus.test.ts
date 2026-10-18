// events-web.md W-E17: the order of the status line, as a pure function.
import { isClosed, publicStatus, type PublicStatus } from "./publicStatus";

type Flags = Parameters<typeof publicStatus>[0];

describe("publicStatus", () => {
  it.each<[Flags, PublicStatus]>([
    [{ status: "active", has_started: false, full: false }, "open"],
    [{ status: "active", has_started: false, full: true }, "full"],
    [{ status: "active", has_started: true, full: false }, "started"],
    [{ status: "active", has_started: true, full: true }, "started"],
    [{ status: "cancelled", has_started: false, full: false }, "cancelled"],
    [{ status: "cancelled", has_started: true, full: true }, "cancelled"],
    [{ status: "passed", has_started: true, full: false }, "ended"],
    [{ status: "passed", has_started: true, full: true }, "ended"],
  ])("%o is %s", (flags, expected) => {
    expect(publicStatus(flags)).toBe(expected);
  });

  it("only cancelled and ended are closed", () => {
    expect(isClosed("cancelled")).toBe(true);
    expect(isClosed("ended")).toBe(true);
    expect(isClosed("started")).toBe(false);
    expect(isClosed("full")).toBe(false);
    expect(isClosed("open")).toBe(false);
  });
});
