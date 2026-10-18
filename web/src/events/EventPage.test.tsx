// events-web.md W-E10 (organizer view), W-E12, W-E20, W-E21 (organizer view links).
import { act, fireEvent, screen, within } from "@testing-library/react";
import { OLGA, callsTo, deferred, json, mockFetch, renderApp } from "../auth/test-helpers";
import { formatDateTime } from "./format";
import { EVENT_ID, organizerEvent } from "./test-helpers";

afterEach(() => {
  vi.unstubAllGlobals();
});

const OWN = `GET /events/${EVENT_ID}`;
const PUBLIC = `GET /public/events/${EVENT_ID}`;

function main() {
  return within(screen.getByRole("main"));
}

// The value next to a dt label in the details list.
function detail(label: string): string | null {
  const dt = main().getByText(label, { selector: "dt" });
  return dt.nextElementSibling?.textContent ?? null;
}

describe("W-E10: organizer view", () => {
  it("shows all the numbers, the status and the dates", async () => {
    mockFetch({
      "GET /auth/me": () => json(200, OLGA),
      [OWN]: () => json(200, organizerEvent({ registered: 3, seats_left: 22 })),
    });
    renderApp(`/event/${EVENT_ID}`);

    expect(await screen.findByRole("heading", { level: 1, name: "Spring meetup" })).toBeTruthy();
    expect(main().getByText("Active")).toBeTruthy();
    expect(detail("Starts")).toBe(formatDateTime("2030-01-01T10:00:00.000Z"));
    expect(detail("Ends")).toBe(formatDateTime("2030-01-01T11:30:00.000Z"));
    expect(detail("Duration")).toBe("1 h 30 min");
    expect(detail("Capacity")).toBe("25");
    expect(detail("Registered")).toBe("3");
    expect(detail("Seats left")).toBe("22");
    expect(detail("Created")).toBe(formatDateTime("2026-10-18T10:00:00.000Z"));
  });

  it.each([
    ["cancelled", "Cancelled"],
    ["passed", "Ended"],
  ] as const)("shows the real numbers for a %s event", async (status, label) => {
    mockFetch({
      "GET /auth/me": () => json(200, OLGA),
      [OWN]: () => json(200, organizerEvent({ status, registered: 3, seats_left: 22 })),
    });
    renderApp(`/event/${EVENT_ID}`);

    expect(await main().findByText(label)).toBeTruthy();
    expect(detail("Registered")).toBe("3");
    expect(detail("Seats left")).toBe("22");
  });

  it("is read only: no buttons", async () => {
    mockFetch({
      "GET /auth/me": () => json(200, OLGA),
      [OWN]: () => json(200, organizerEvent()),
    });
    renderApp(`/event/${EVENT_ID}`);
    await screen.findByRole("heading", { level: 1, name: "Spring meetup" });
    expect(main().queryAllByRole("button")).toEqual([]);
  });
});

describe("W-E20 and W-E21: organizer view structure and links", () => {
  it("has one h1, Back to events and the share link as text", async () => {
    mockFetch({
      "GET /auth/me": () => json(200, OLGA),
      [OWN]: () => json(200, organizerEvent()),
    });
    renderApp(`/event/${EVENT_ID}`);
    await screen.findByRole("heading", { level: 1, name: "Spring meetup" });

    expect(main().getAllByRole("heading", { level: 1 }).length).toBe(1);
    expect(main().getByRole("link", { name: "Back to events" }).getAttribute("href")).toBe(
      "/organizer",
    );
    const share = main().getByRole("link", { name: `/event/${EVENT_ID}` });
    expect(share.getAttribute("href")).toBe(`/event/${EVENT_ID}`);
    expect(main().getAllByRole("link").length).toBe(2);
  });
});

describe("W-E12: loading and load errors", () => {
  it("shows Loading... while the owner call is pending", async () => {
    const answer = deferred<Response>();
    mockFetch({
      "GET /auth/me": () => json(200, OLGA),
      [OWN]: () => answer.promise,
    });
    renderApp(`/event/${EVENT_ID}`);

    expect(await main().findByRole("status")).toBeTruthy();
    expect(main().getByRole("status").textContent).toBe("Loading...");
    await act(async () => answer.resolve(json(200, organizerEvent())));
    expect(await screen.findByRole("heading", { level: 1, name: "Spring meetup" })).toBeTruthy();
  });

  it.each([
    ["a 5xx", () => json(503)],
    [
      "a network error",
      () => {
        throw new TypeError("Failed to fetch");
      },
    ],
  ])("shows Could not load this event with Retry on %s, no public fallback", async (_l, failure) => {
    let first = true;
    const fetch = mockFetch({
      "GET /auth/me": () => json(200, OLGA),
      [OWN]: () => {
        if (first) {
          first = false;
          return failure();
        }
        return json(200, organizerEvent());
      },
    });
    renderApp(`/event/${EVENT_ID}`);

    expect(
      await screen.findByRole("heading", { level: 1, name: "Could not load this event" }),
    ).toBeTruthy();
    expect(callsTo(fetch, PUBLIC)).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Spring meetup" })).toBeTruthy();
    expect(callsTo(fetch, OWN)).toBe(2);
  });
});
