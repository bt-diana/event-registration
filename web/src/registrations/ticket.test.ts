// registration-web.md W-R4 (every row of the section 2 table), W-R7 and the list helpers
// (W-R18, W-R40), as pure functions.
import { publicEvent, type SamplePublicEvent } from "../events/test-helpers";
import type { RegistrationStatus } from "./api";
import { registration, type SampleRegistration } from "./test-helpers";
import {
  canCancel,
  eventStatusBadge,
  listStatusText,
  registerAction,
  showQr,
  ticketLabel,
  type RegisterAction,
} from "./ticket";

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
    expect(
      ticketLabel({ status: "registered", waitlist_position: null, checked_in_at: null }),
    ).toEqual({
      heading: "You are registered",
      place: null,
      note: null,
      checkedIn: null,
      badge: { text: "Registered", tone: "open" },
    });
  });

  it.each([1, 2])("waitlisted at place %i", (n) => {
    const label = ticketLabel({ status: "waitlisted", waitlist_position: n, checked_in_at: null });
    expect(label.heading).toBe("You are on the waiting list");
    expect(label.place).toBe(`Your place: ${n}`);
    expect(label.badge).toEqual({ text: "Waiting list", tone: "full" });
  });

  it("cancelled", () => {
    expect(
      ticketLabel({ status: "cancelled", waitlist_position: null, checked_in_at: null }),
    ).toEqual({
      heading: "Registration cancelled",
      place: null,
      note: "This ticket is no longer valid.",
      checkedIn: null,
      badge: { text: "Cancelled", tone: "cancelled" },
    });
  });
});

// W-R25: a checked-in ticket has the line "Checked in" (also in the event page panel).
describe("ticketLabel: checked in", () => {
  it('a checked-in ticket has the line "Checked in", the time is not shown', () => {
    const label = ticketLabel({
      status: "registered",
      waitlist_position: null,
      checked_in_at: "2030-01-01T09:55:00.000Z",
    });
    expect(label.heading).toBe("You are registered");
    expect(label.checkedIn).toBe("Checked in");
  });
});

// Tests first (registration-web.md W-R42): a used ticket's badge says "Checked in" instead
// of "Registered", in the same Open tone; waiting and cancelled keep their own badge.
describe("W-R42: the Checked in badge", () => {
  const AT = "2030-01-01T09:55:00.000Z";

  it.each<[string, string | null, { text: string; tone: string }]>([
    ["registered, checked in", AT, { text: "Checked in", tone: "open" }],
    ["registered, not checked in", null, { text: "Registered", tone: "open" }],
  ])("ticketLabel badge: %s", (_case, checkedInAt, badge) => {
    const label = ticketLabel({
      status: "registered",
      waitlist_position: null,
      checked_in_at: checkedInAt,
    });
    expect(label.badge).toEqual(badge);
    // The event page panel keeps its heading and its line (W-R25).
    expect(label.heading).toBe("You are registered");
    expect(label.checkedIn).toBe(checkedInAt === null ? null : "Checked in");
  });

  it.each<[string, Parameters<typeof ticketLabel>[0], { text: string; tone: string }]>([
    [
      "waitlisted",
      { status: "waitlisted", waitlist_position: 3, checked_in_at: AT },
      { text: "Waiting list", tone: "full" },
    ],
    [
      "cancelled",
      { status: "cancelled", waitlist_position: null, checked_in_at: AT },
      { text: "Cancelled", tone: "cancelled" },
    ],
  ])("ticketLabel badge: %s with checked_in_at set keeps its own badge", (_case, r, badge) => {
    expect(ticketLabel(r).badge).toEqual(badge);
  });

  it.each<[string, Parameters<typeof listStatusText>[0], string]>([
    [
      "registered, checked in",
      { status: "registered", waitlist_position: null, checked_in_at: AT },
      "Checked in",
    ],
    [
      "registered, not checked in",
      { status: "registered", waitlist_position: null, checked_in_at: null },
      "Registered",
    ],
    [
      "waitlisted, checked_in_at set",
      { status: "waitlisted", waitlist_position: 3, checked_in_at: AT },
      "Waiting list: place 3",
    ],
    [
      "cancelled, checked_in_at set",
      { status: "cancelled", waitlist_position: null, checked_in_at: AT },
      "Cancelled",
    ],
  ])("listStatusText: %s", (_case, registration, text) => {
    expect(listStatusText(registration)).toBe(text);
  });
});

// Tests first (registration-web.md W-R25): when the ticket page shows the QR.
describe("W-R25: showQr", () => {
  it.each<[string, Partial<SamplePublicEvent>, Parameters<typeof registration>[0], boolean]>([
    ["registered, open event", OPEN, {}, true],
    ["registered, started event", STARTED, {}, true],
    ["registered, full event", FULL, {}, true],
    ["registered, ended event", PASSED, {}, true],
    ["registered, cancelled event", CANCELLED, {}, false],
    ["waitlisted", FULL, { status: "waitlisted", waitlist_position: 1 }, false],
    ["cancelled ticket", OPEN, { status: "cancelled" }, false],
    ["checked in", OPEN, { checked_in_at: "2030-01-01T09:55:00.000Z" }, false],
    ["checked in, ended event", PASSED, { checked_in_at: "2030-01-01T09:55:00.000Z" }, false],
  ])("%s: %s", (_case, event, ticket, shown) => {
    expect(showQr(registration(ticket), publicEvent(event))).toBe(shown);
  });
});

// W-R18: the registration badge text on the attendee list.
describe("listStatusText", () => {
  it.each<[string, Parameters<typeof listStatusText>[0], string]>([
    ["registered", { status: "registered", waitlist_position: null, checked_in_at: null }, "Registered"],
    [
      "waitlisted at place 1",
      { status: "waitlisted", waitlist_position: 1, checked_in_at: null },
      "Waiting list: place 1",
    ],
    [
      "waitlisted at place 3",
      { status: "waitlisted", waitlist_position: 3, checked_in_at: null },
      "Waiting list: place 3",
    ],
    ["cancelled", { status: "cancelled", waitlist_position: null, checked_in_at: null }, "Cancelled"],
  ])("%s", (_case, registration, text) => {
    expect(listStatusText(registration)).toBe(text);
  });
});

// W-R40: the extra badge for the event's status.
describe("eventStatusBadge", () => {
  it.each<[Parameters<typeof eventStatusBadge>[0], string | null]>([
    ["active", null],
    ["cancelled", "Event cancelled"],
    ["passed", "Ended"],
  ])("%s: %s", (status, text) => {
    expect(eventStatusBadge(status)).toBe(text);
  });
});

// cancel-registration-web.md W-CR1 (test first): the cancel section only for an active
// (registered or waiting) ticket that is not checked in, on an active event that has not
// started. Four registrations x four event states.
describe("W-CR1: canCancel", () => {
  const CHECKED_IN = "2030-01-01T09:55:00.000Z";
  const tickets: [string, Partial<SampleRegistration>, boolean][] = [
    ["registered", { status: "registered" }, true],
    ["waitlisted", { status: "waitlisted", waitlist_position: 2 }, true],
    ["cancelled", { status: "cancelled" }, false],
    ["registered and checked in", { status: "registered", checked_in_at: CHECKED_IN }, false],
  ];
  const events: [string, Partial<SamplePublicEvent>, boolean][] = [
    ["active", OPEN, true],
    ["already started", STARTED, false],
    ["cancelled", CANCELLED, false],
    ["ended", PASSED, false],
  ];
  const rows = tickets.flatMap(([ticketCase, ticket, ticketOk]) =>
    events.map(
      ([eventCase, event, eventOk]) =>
        [`${ticketCase}, ${eventCase} event`, ticket, event, ticketOk && eventOk] as const,
    ),
  );

  it.each(rows)("%s", (_case, ticket, event, shown) => {
    expect(canCancel(registration(ticket), publicEvent(event))).toBe(shown);
  });

  it("a full active event still allows it (the waiting list moves up)", () => {
    expect(canCancel(registration(), publicEvent(FULL))).toBe(true);
  });
});
