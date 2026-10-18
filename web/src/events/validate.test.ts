// events-web.md W-E5: the client checks, the same limits as the API.
import {
  ERRORS,
  validateCapacity,
  validateCapacityChange,
  validateDescription,
  validateDuration,
  validateStart,
  validateTitle,
} from "./validate";

describe("validateTitle", () => {
  it.each([
    ["one character", "a", null],
    ["200 characters", "a".repeat(200), null],
    ["200 emoji (more UTF-16 units)", "😀".repeat(200), null],
    ["200 characters with spaces around", `  ${"a".repeat(200)}  `, null],
    ["empty", "", ERRORS.title],
    ["only spaces", "   ", ERRORS.title],
    ["201 characters", "a".repeat(201), ERRORS.title],
  ])("%s", (_label, value, expected) => {
    expect(validateTitle(value)).toBe(expected);
  });
});

describe("validateDescription", () => {
  it.each([
    ["empty", "", null],
    ["2000 characters", "a".repeat(2000), null],
    ["2000 emoji", "😀".repeat(2000), null],
    ["2000 characters with spaces around", `\n ${"a".repeat(2000)} \n`, null],
    ["2001 characters", "a".repeat(2001), ERRORS.description],
  ])("%s", (_label, value, expected) => {
    expect(validateDescription(value)).toBe(expected);
  });
});

describe("validateStart", () => {
  const now = new Date("2030-01-01T10:00");

  it.each([
    ["a minute later", "2030-01-01T10:01", null],
    ["next year", "2031-06-01T08:00", null],
    ["exactly now", "2030-01-01T10:00", ERRORS.start],
    ["in the past", "2029-12-31T23:59", ERRORS.start],
    ["empty", "", ERRORS.start],
    ["not a date", "soon", ERRORS.start],
  ])("%s", (_label, value, expected) => {
    expect(validateStart(value, now)).toBe(expected);
  });
});

describe("validateDuration", () => {
  it.each([
    ["1", null],
    ["90", null],
    ["1440", null],
    [" 90 ", null],
    ["0", ERRORS.duration],
    ["1441", ERRORS.duration],
    ["1.5", ERRORS.duration],
    ["", ERRORS.duration],
    ["1e3", ERRORS.duration],
    ["-5", ERRORS.duration],
    ["ninety", ERRORS.duration],
  ])("%j", (value, expected) => {
    expect(validateDuration(value)).toBe(expected);
  });
});

describe("validateCapacity", () => {
  it.each([
    ["1", null],
    ["25", null],
    ["100000", null],
    ["0", ERRORS.capacity],
    ["100001", ERRORS.capacity],
    ["1.5", ERRORS.capacity],
    ["", ERRORS.capacity],
    ["1e3", ERRORS.capacity],
    ["-1", ERRORS.capacity],
  ])("%j", (value, expected) => {
    expect(validateCapacity(value)).toBe(expected);
  });
});

// capacity-web.md W-CP3 (test first): not below the page's registered count.
describe("validateCapacityChange", () => {
  it.each<[string, string, number, string | null]>([
    ["below, plural", "2", 3, "Capacity cannot be below 3 registered people."],
    ["below with spaces around", " 2 ", 3, "Capacity cannot be below 3 registered people."],
    ["far below", "1", 40, "Capacity cannot be below 40 registered people."],
    ["exactly the registered count", "3", 3, null],
    ["above", "4", 3, null],
    ["nobody registered", "1", 0, null],
    ["not a number is left to validateCapacity", "abc", 3, null],
    ["empty is left to validateCapacity", "", 3, null],
  ])("%s", (_label, value, registered, expected) => {
    expect(validateCapacityChange(value, registered)).toBe(expected);
  });

  it("the text says person for one and people otherwise", () => {
    expect(ERRORS.capacityBelow(1)).toBe("Capacity cannot be below 1 registered person.");
    expect(ERRORS.capacityBelow(0)).toBe("Capacity cannot be below 0 registered people.");
    expect(ERRORS.capacityBelow(5)).toBe("Capacity cannot be below 5 registered people.");
  });
});
