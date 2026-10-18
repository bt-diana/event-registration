// events-web.md W-E1, W-E3, W-E20 (list), W-E21 (list links).
import { act, fireEvent, screen, within } from "@testing-library/react";
import { OLGA, callsTo, deferred, json, mockFetch, renderApp } from "../auth/test-helpers";
import { formatDateTime } from "./format";
import { organizerEvent } from "./test-helpers";

afterEach(() => {
  vi.unstubAllGlobals();
});

const EVENTS = [
  organizerEvent({
    id: "11111111-1111-4111-8111-111111111111",
    title: "Later meetup",
    starts_at: "2031-05-01T09:00:00.000Z",
    registered: 3,
    capacity: 25,
  }),
  organizerEvent({
    id: "22222222-2222-4222-8222-222222222222",
    title: "Cancelled workshop",
    starts_at: "2030-02-01T09:00:00.000Z",
    status: "cancelled",
    capacity: 30,
  }),
  organizerEvent({
    id: "33333333-3333-4333-8333-333333333333",
    title: "Old studio",
    starts_at: "2020-02-01T09:00:00.000Z",
    status: "passed",
    capacity: 50,
  }),
];

function cellsOf(row: HTMLElement): string[] {
  return within(row)
    .getAllByRole("cell")
    .map((cell) => cell.textContent ?? "");
}

describe("W-E1: events list", () => {
  it("shows one row per event in the API order, with one GET /events", async () => {
    const fetch = mockFetch({
      "GET /auth/me": () => json(200, OLGA),
      "GET /events": () => json(200, { events: EVENTS }),
    });
    renderApp("/organizer");

    expect(await screen.findByRole("table")).toBeTruthy();
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((row) => cellsOf(row))).toEqual([
      ["Later meetup", formatDateTime("2031-05-01T09:00:00.000Z"), "Active", "3 / 25"],
      ["Cancelled workshop", formatDateTime("2030-02-01T09:00:00.000Z"), "Cancelled", "0 / 30"],
      ["Old studio", formatDateTime("2020-02-01T09:00:00.000Z"), "Ended", "0 / 50"],
    ]);
    expect(screen.getByRole("link", { name: "Later meetup" }).getAttribute("href")).toBe(
      "/event/11111111-1111-4111-8111-111111111111",
    );
    expect(callsTo(fetch, "GET /events")).toBe(1);
  });

  it("is a real table with column headers and one h1 (W-E20)", async () => {
    mockFetch({
      "GET /auth/me": () => json(200, OLGA),
      "GET /events": () => json(200, { events: EVENTS }),
    });
    renderApp("/organizer");
    await screen.findByRole("table");

    const headers = screen.getAllByRole("columnheader");
    expect(headers.map((th) => th.textContent)).toEqual([
      "Title",
      "Starts",
      "Status",
      "Registered",
    ]);
    expect(headers.every((th) => th.getAttribute("scope") === "col")).toBe(true);
    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual([
      "Your events",
    ]);
  });

  it("links to Create event (W-E21)", async () => {
    mockFetch({
      "GET /auth/me": () => json(200, OLGA),
      "GET /events": () => json(200, { events: EVENTS }),
    });
    renderApp("/organizer");
    await screen.findByRole("table");
    expect(screen.getByRole("link", { name: "Create event" }).getAttribute("href")).toBe(
      "/organizer/events/new",
    );
  });
});

describe("W-E3: loading and load errors", () => {
  it("shows Loading... while the list is pending", async () => {
    const answer = deferred<Response>();
    mockFetch({
      "GET /auth/me": () => json(200, OLGA),
      "GET /events": () => answer.promise,
    });
    renderApp("/organizer");

    expect(await screen.findByRole("heading", { level: 1, name: "Your events" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Loading...");
    expect(screen.queryByRole("table")).toBeNull();
    await act(async () => answer.resolve(json(200, { events: EVENTS })));
    expect(await screen.findByRole("table")).toBeTruthy();
  });

  it.each([
    ["a 5xx", () => json(500, { error: "internal" })],
    [
      "a network error",
      () => {
        throw new TypeError("Failed to fetch");
      },
    ],
  ])("shows Could not load your events with Retry on %s", async (_label, failure) => {
    let first = true;
    const fetch = mockFetch({
      "GET /auth/me": () => json(200, OLGA),
      "GET /events": () => {
        if (first) {
          first = false;
          return failure();
        }
        return json(200, { events: EVENTS });
      },
    });
    renderApp("/organizer");

    expect(
      await screen.findByRole("heading", { level: 1, name: "Could not load your events" }),
    ).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("table")).toBeTruthy();
    expect(callsTo(fetch, "GET /events")).toBe(2);
  });
});
