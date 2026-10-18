// events-web.md W-E19 and the starts_at conversion of W-E4.
import { formatDateTime, formatDuration, localToIso, localZoneName, toLocalInput } from "./format";

describe("formatDateTime", () => {
  it("shows the date and time with the zone name", () => {
    expect(formatDateTime("2030-01-01T10:00:00.000Z", "UTC")).toBe("Tue, 1 Jan 2030, 10:00 UTC");
  });

  it("uses the given zone", () => {
    expect(formatDateTime("2030-01-01T10:00:00.000Z", "Europe/Berlin")).toBe(
      "Tue, 1 Jan 2030, 11:00 CET",
    );
    expect(formatDateTime("2030-01-01T23:30:00.000Z", "Asia/Almaty")).toMatch(
      /^Wed, 2 Jan 2030, 0\d:30 \S+$/,
    );
  });

  it("uses a 24-hour clock, midnight is 00:00", () => {
    expect(formatDateTime("2030-01-02T00:00:00.000Z", "UTC")).toBe("Wed, 2 Jan 2030, 00:00 UTC");
  });
});

describe("formatDuration", () => {
  it.each([
    [1, "1 min"],
    [45, "45 min"],
    [59, "59 min"],
    [60, "1 h"],
    [90, "1 h 30 min"],
    [125, "2 h 5 min"],
    [1440, "24 h"],
  ])("%i minutes is %s", (minutes, text) => {
    expect(formatDuration(minutes)).toBe(text);
  });
});

describe("localToIso", () => {
  it("is new Date(value).toISOString(), in UTC with Z", () => {
    const iso = localToIso("2030-01-01T10:00");
    expect(iso).toBe(new Date("2030-01-01T10:00").toISOString());
    expect(iso).toMatch(/Z$/);
  });

  it.each(["", "not a date", "2030-13-45T99:99"])("gives null for %j", (value) => {
    expect(localToIso(value)).toBeNull();
  });
});

describe("helpers for the start field", () => {
  it("toLocalInput gives the local datetime-local value", () => {
    expect(toLocalInput(new Date(2030, 0, 2, 3, 4))).toBe("2030-01-02T03:04");
  });

  it("localZoneName gives the zone name", () => {
    expect(localZoneName(new Date("2030-01-01T10:00:00.000Z"), "UTC")).toBe("UTC");
    expect(localZoneName(new Date("2030-01-01T10:00:00.000Z"), "Europe/Berlin")).toBe("CET");
  });
});
