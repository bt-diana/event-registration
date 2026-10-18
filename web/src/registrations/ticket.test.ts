// registration-web.md W-R4 (every row of the section 2 table) and W-R7, as pure functions.
import { publicEvent, type SamplePublicEvent } from "../events/test-helpers";
import type { RegistrationStatus } from "./api";
import { registerAction, ticketLabel, type RegisterAction } from "./ticket";

const OPEN: Partial<SamplePublicEvent> = {};
const STARTED: Partial<SamplePublicEvent> = { has_started: true };
const FULL: Partial<SamplePublicEvent> = { full: true, seats_left: 0 };
const FULL_STARTED: Partial<SamplePublicEvent> = { full: true, has_started: true, seats_left: 0 };
const CANCELLED: Partial<SamplePublicEvent> = { status: "cancelled" };
const PASSED: Partial<SamplePublicEvent> = { status: "passed", has_started: true };

describe("registerAction", () => {
  it.each<[string, Partial<SamplePublicEvent>, RegistrationStatus | null, RegisterAction]>([
    ["open, none", OPEN, null, "register"],
    ["started, none", STARTED, null, "register"],
    ["full, none", FULL, null, "waitlist"],
    ["full and started, none", FULL_STARTED, null, "waitlist"],
    ["cancelled event, none", CANCELLED, null, "none"],
    ["passed event, none", PASSED, null, "none"],
    ["open, registered", OPEN, "registered", "none"],
    ["full, waitlisted", FULL, "waitlisted", "none"],
    ["passed, registered", PASSED, "registered", "none"],
    ["open, cancelled ticket", OPEN, "cancelled", "register-again"],
    ["started, cancelled ticket", STARTED, "cancelled", "register-again"],
    ["full, cancelled ticket", FULL, "cancelled", "waitlist"],
    ["cancelled event, cancelled ticket", CANCELLED, "cancelled", "none"],
    ["passed event, cancelled ticket", PASSED, "cancelled", "none"],
  ])("%s: %s", (_case, overrides, status, action) => {
    expect(registerAction(publicEvent(overrides), status ? { status } : null)).toBe(action);
  });
});

describe("ticketLabel", () => {
  it("registered", () => {
    expect(ticketLabel({ status: "registered", waitlist_position: null })).toEqual({
      heading: "You are registered",
      place: null,
      note: null,
      badge: { text: "Registered", tone: "open" },
    });
  });

  it.each([1, 2])("waitlisted at place %i", (n) => {
    const label = ticketLabel({ status: "waitlisted", waitlist_position: n });
    expect(label.heading).toBe("You are on the waiting list");
    expect(label.place).toBe(`Your place: ${n}`);
    expect(label.badge).toEqual({ text: "Waiting list", tone: "full" });
  });

  it("cancelled", () => {
    expect(ticketLabel({ status: "cancelled", waitlist_position: null })).toEqual({
      heading: "Registration cancelled",
      place: null,
      note: "This ticket is no longer valid.",
      badge: { text: "Cancelled", tone: "cancelled" },
    });
  });
});
