// Tests first (events-web.md): W-E17. Then W-E15, W-E16, W-E18, W-E20, W-E21 (public view).
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { ANN, OLGA, callsTo, deferred, json, mockFetch, renderApp } from "../auth/test-helpers";
import { formatDateTime } from "./format";
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

  // Updated for registration-web.md W-R2: logged out gets a login link, never a button,
  // and only while the event is not closed.
  it.each<[SamplePublicEvent["status"], boolean]>([
    ["active", true],
    ["cancelled", false],
    ["passed", false],
  ])("logged out: no register button, a login link only when open (%s)", async (status, link) => {
    await show(publicEvent({ status }));
    expect(screen.queryByRole("button", { name: /register|sign up|join/i })).toBeNull();
    expect(screen.queryByRole("link", { name: "Log in to register" }) !== null).toBe(link);
  });
});

function main() {
  return within(screen.getByRole("main"));
}

function detail(label: string): string | null {
  return main().getByText(label, { selector: "dt" }).nextElementSibling?.textContent ?? null;
}

describe("W-E15: the same public view for every viewer", () => {
  // Updated for registration-web.md: the event details are the same for everyone; only
  // the registration area under them differs (login link, button, nothing for an organizer).
  it("shows the same event details to nobody, an attendee and another organizer", async () => {
    const texts: string[] = [];
    const areas: string[] = [];
    for (const [me, own] of [
      [() => json(401, { error: "not_logged_in" }), undefined],
      [() => json(200, ANN), undefined],
      [() => json(200, OLGA), () => json(404, { error: "not_found" })],
    ] as const) {
      mockFetch({
        "GET /auth/me": me,
        [PUBLIC]: () => json(200, publicEvent({ description: "Hello" })),
        [`GET /events/${EVENT_ID}/registrations/me`]: () => json(404, { error: "not_found" }),
        ...(own ? { [`GET /events/${EVENT_ID}`]: own } : {}),
      });
      const { queryClient, unmount } = renderApp(`/event/${EVENT_ID}`);
      await screen.findByRole("heading", { level: 1, name: "Spring meetup" });
      await waitFor(() => expect(main().queryByText("Loading...")).toBeNull());
      expect(queryClient.getQueryData(["public-event", EVENT_ID])).toBeTruthy();
      const area = screen.getByRole("main").querySelector(".registration-area");
      const areaText = area?.textContent ?? "";
      areas.push(areaText);
      texts.push((screen.getByRole("main").textContent ?? "").replace(areaText, ""));
      unmount();
      vi.unstubAllGlobals();
    }
    expect(texts[1]).toBe(texts[0]);
    expect(texts[2]).toBe(texts[0]);
    expect(areas).toEqual(["Log in to register", "Register", ""]);
  });
});

describe("W-E16: dates and seats", () => {
  it.each<[string, Partial<SamplePublicEvent>, string]>([
    ["open", { seats_left: 10 }, "10 of 25 seats left"],
    ["full", { full: true, seats_left: 0 }, "0 of 25 seats left"],
    ["already started", { has_started: true, seats_left: 7 }, "7 of 25 seats left"],
  ])("%s shows the seats left", async (_label, overrides, seats) => {
    await show(publicEvent(overrides));
    expect(detail("Starts")).toBe(formatDateTime("2030-01-01T10:00:00.000Z"));
    expect(detail("Ends")).toBe(formatDateTime("2030-01-01T11:30:00.000Z"));
    expect(detail("Duration")).toBe("1 h 30 min");
    expect(detail("Seats")).toBe(seats);
    expect(main().queryByText(/^Capacity:/)).toBeNull();
  });

  it.each<[string, Partial<SamplePublicEvent>]>([
    ["cancelled", { status: "cancelled", seats_left: 0 }],
    ["ended", { status: "passed", has_started: true, seats_left: 0 }],
  ])("%s shows only the capacity", async (_label, overrides) => {
    await show(publicEvent(overrides));
    expect(main().getByText("Capacity: 25")).toBeTruthy();
    expect(main().queryByText(/seats left/)).toBeNull();
    expect(detail("Starts")).toBe(formatDateTime("2030-01-01T10:00:00.000Z"));
  });
});

describe("W-E20 and W-E21: public view structure", () => {
  // Updated for registration-web.md W-R2: the only link is the login link of the area.
  it("has the Event eyebrow, one h1, the status as text and only the login link", async () => {
    await show(publicEvent());
    expect(main().getByText("Event")).toBeTruthy();
    expect(main().getAllByRole("heading", { level: 1 }).length).toBe(1);
    expect(main().getByText("Open").textContent).toBe("Open");
    expect(main().queryAllByRole("link").map((link) => link.textContent)).toEqual([
      "Log in to register",
    ]);
  });
});

describe("W-E18: not found, loading and errors", () => {
  it("404 shows Event not found and a link home", async () => {
    mockFetch({
      "GET /auth/me": () => json(401, { error: "not_logged_in" }),
      [PUBLIC]: () => json(404, { error: "not_found" }),
    });
    renderApp(`/event/${EVENT_ID}`);
    expect(await screen.findByRole("heading", { level: 1, name: "Event not found" })).toBeTruthy();
    expect(screen.getByText("This link is not valid or the event does not exist.")).toBeTruthy();
    expect(main().getByRole("link", { name: "Go home" }).getAttribute("href")).toBe("/");
  });

  it("shows Loading... while pending", async () => {
    const answer = deferred<Response>();
    const fetch = mockFetch({
      "GET /auth/me": () => json(401, { error: "not_logged_in" }),
      [PUBLIC]: () => answer.promise,
    });
    renderApp(`/event/${EVENT_ID}`);
    await waitFor(() => expect(callsTo(fetch, PUBLIC)).toBe(1));
    expect(main().getByRole("status").textContent).toBe("Loading...");
    await act(async () => answer.resolve(json(200, publicEvent())));
    expect(await screen.findByRole("heading", { level: 1, name: "Spring meetup" })).toBeTruthy();
  });

  it.each([
    ["a 5xx", () => json(500, { error: "internal" })],
    [
      "a network error",
      () => {
        throw new TypeError("Failed to fetch");
      },
    ],
  ])("shows Could not load this event with Retry on %s", async (_label, failure) => {
    let first = true;
    const fetch = mockFetch({
      "GET /auth/me": () => json(401, { error: "not_logged_in" }),
      [PUBLIC]: () => {
        if (first) {
          first = false;
          return failure();
        }
        return json(200, publicEvent());
      },
    });
    renderApp(`/event/${EVENT_ID}`);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Could not load this event" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Spring meetup" })).toBeTruthy();
    expect(callsTo(fetch, PUBLIC)).toBe(2);
  });
});
