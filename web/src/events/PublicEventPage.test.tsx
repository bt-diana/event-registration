// Tests first (events-web.md): W-E17. The page is rendered for a logged-out viewer.
import { screen } from "@testing-library/react";
import { json, mockFetch, renderApp } from "../auth/test-helpers";
import { EVENT_ID, publicEvent, type SamplePublicEvent } from "./test-helpers";

afterEach(() => {
  vi.unstubAllGlobals();
});

const PUBLIC = `GET /public/events/${EVENT_ID}`;
const LABELS = ["Open", "Full", "Already started", "Cancelled", "Ended"];

async function show(event: SamplePublicEvent) {
  mockFetch({
    "GET /auth/me": () => json(401, { error: "not_logged_in" }),
    [PUBLIC]: () => json(200, event),
  });
  renderApp(`/event/${EVENT_ID}`);
  await screen.findByRole("heading", { level: 1, name: event.title });
}

function expectOnlyLabel(label: string) {
  expect(screen.getByText(label)).toBeTruthy();
  for (const other of LABELS.filter((l) => l !== label)) {
    expect(screen.queryByText(other)).toBeNull();
  }
}

describe("W-E17: status line, first match wins", () => {
  it.each<[string, Partial<SamplePublicEvent>, string, boolean]>([
    ["active, not started, not full", {}, "Open", false],
    ["full", { full: true, seats_left: 0 }, "Full", false],
    ["started", { has_started: true, seats_left: 10 }, "Already started", false],
    ["cancelled", { status: "cancelled", seats_left: 0 }, "Cancelled", true],
    ["passed", { status: "passed", has_started: true, seats_left: 0 }, "Ended", true],
    // Order cases.
    ["cancelled and started", { status: "cancelled", has_started: true, seats_left: 0 }, "Cancelled", true],
    ["full and started", { full: true, has_started: true, seats_left: 0 }, "Already started", false],
    ["passed and full", { status: "passed", full: true, seats_left: 0 }, "Ended", true],
  ])("%s: the right label", async (_label, overrides, label, closed) => {
    await show(publicEvent(overrides));
    expectOnlyLabel(label);
    if (closed) {
      expect(screen.getByText("Registration is closed.")).toBeTruthy();
    } else {
      expect(screen.queryByText("Registration is closed.")).toBeNull();
    }
  });

  it.each(["active", "cancelled", "passed"] as const)(
    "has no register button (%s)",
    async (status) => {
      await show(publicEvent({ status }));
      expect(screen.queryByRole("button", { name: /register|sign up|join/i })).toBeNull();
    },
  );
});
