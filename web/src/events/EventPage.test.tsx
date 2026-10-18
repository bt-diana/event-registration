// events-web.md W-E10 (organizer view), W-E12, W-E20, W-E21 (organizer view links).
// email-reminders-web.md W-EM16, W-EM23: the M7 section only in the owner view.
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { OLGA, backLinks, callsTo, deferred, json, mockFetch, renderApp } from "../auth/test-helpers";
import { formatDateTime } from "./format";
import { EVENT_ID, organizerEvent, publicEvent } from "./test-helpers";

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

  // email-reminders-web.md (M7 assumptions) supersedes "read only" for the owner view: an
  // active event in the future has the reschedule and cancel controls (W-EM16), nothing else.
  // capacity-web.md W-CP1 adds "Save capacity" before them.
  it("has only the capacity and M7 buttons, and only for an active event in the future", async () => {
    mockFetch({
      "GET /auth/me": () => json(200, OLGA),
      [OWN]: () => json(200, organizerEvent()),
    });
    renderApp(`/event/${EVENT_ID}`);
    await screen.findByRole("heading", { level: 1, name: "Spring meetup" });
    expect(main().queryAllByRole("button").map((button) => button.textContent)).toEqual([
      "Save capacity",
      "Reschedule",
      "Cancel event",
    ]);
  });

  it.each(["cancelled", "passed"] as const)("is read only for a %s event: no buttons", async (status) => {
    mockFetch({
      "GET /auth/me": () => json(200, OLGA),
      [OWN]: () => json(200, organizerEvent({ status })),
    });
    renderApp(`/event/${EVENT_ID}`);
    await screen.findByRole("heading", { level: 1, name: "Spring meetup" });
    expect(main().queryAllByRole("button")).toEqual([]);
  });
});

describe("email-reminders-web.md W-EM16, W-EM23: the M7 section on the event page", () => {
  const RESCHEDULE = `POST /events/${EVENT_ID}/reschedule`;

  it("appears in the owner view only; the public view of the same event has none", async () => {
    mockFetch({
      "GET /auth/me": () => json(200, OLGA),
      [OWN]: () => json(200, organizerEvent()),
    });
    const { unmount } = renderApp(`/event/${EVENT_ID}`);
    await screen.findByRole("heading", { level: 1, name: "Spring meetup" });
    expect(main().getByRole("region", { name: "Change the event" })).toBeTruthy();
    unmount();
    vi.unstubAllGlobals();

    mockFetch({
      "GET /auth/me": () => json(401, { error: "not_logged_in" }),
      [PUBLIC]: () => json(200, publicEvent()),
    });
    renderApp(`/event/${EVENT_ID}`);
    await screen.findByRole("heading", { level: 1, name: "Spring meetup" });
    expect(main().queryByRole("region", { name: "Change the event" })).toBeNull();
    expect(main().queryByLabelText("New start")).toBeNull();
  });

  it("a 404 when the event is read again after a 409 falls back to the public view", async () => {
    let reads = 0;
    const fetch = mockFetch({
      "GET /auth/me": () => json(200, OLGA),
      [OWN]: () => (reads++ === 0 ? json(200, organizerEvent()) : json(404, { error: "not_found" })),
      [PUBLIC]: () => json(200, publicEvent()),
      [RESCHEDULE]: () => json(409, { error: "event_cancelled" }),
    });
    renderApp(`/event/${EVENT_ID}`);
    await screen.findByRole("heading", { level: 1, name: "Spring meetup" });
    fireEvent.change(main().getByLabelText("New start"), {
      target: { value: "2030-02-01T18:30" },
    });
    fireEvent.click(main().getByRole("button", { name: "Reschedule" }));
    await waitFor(() => expect(callsTo(fetch, PUBLIC)).toBe(1));
    expect(await main().findByText("Event", { selector: ".eyebrow" })).toBeTruthy();
    expect(main().queryByRole("region", { name: "Change the event" })).toBeNull();
    expect(main().queryByRole("link", { name: "Registrations" })).toBeNull();
    expect(callsTo(fetch, OWN)).toBe(2);
  });
});

// capacity-web.md W-CP1, W-CP11 (test first): the "Capacity" section of the owner view.
describe("capacity-web.md W-CP1, W-CP11: the capacity section on the event page", () => {
  const CAPACITY = `POST /events/${EVENT_ID}/capacity`;

  it("sits after the Registrations link and before Change the event", async () => {
    mockFetch({
      "GET /auth/me": () => json(200, OLGA),
      [OWN]: () => json(200, organizerEvent()),
    });
    renderApp(`/event/${EVENT_ID}`);
    await screen.findByRole("heading", { level: 1, name: "Spring meetup" });
    const region = main().getByRole("region", { name: "Capacity" });
    const registrations = main().getByRole("link", { name: "Registrations" });
    const schedule = main().getByRole("region", { name: "Change the event" });
    expect(registrations.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(region.compareDocumentPosition(schedule) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(region.closest("section.card")).toBeTruthy();
  });

  it("is not in the public view of the same event", async () => {
    mockFetch({
      "GET /auth/me": () => json(401, { error: "not_logged_in" }),
      [PUBLIC]: () => json(200, publicEvent()),
    });
    renderApp(`/event/${EVENT_ID}`);
    await screen.findByRole("heading", { level: 1, name: "Spring meetup" });
    expect(main().queryByRole("region", { name: "Capacity" })).toBeNull();
    expect(main().queryByLabelText("Capacity (seats)")).toBeNull();
  });

  it.each(["cancelled", "passed"] as const)("is not there for a %s event", async (status) => {
    mockFetch({
      "GET /auth/me": () => json(200, OLGA),
      [OWN]: () => json(200, organizerEvent({ status })),
    });
    renderApp(`/event/${EVENT_ID}`);
    await screen.findByRole("heading", { level: 1, name: "Spring meetup" });
    expect(main().queryByRole("region", { name: "Capacity" })).toBeNull();
    expect(detail("Capacity")).toBe("25");
  });

  it("the details show the numbers of the cached answer, with no second read", async () => {
    const fetch = mockFetch({
      "GET /auth/me": () => json(200, OLGA),
      [OWN]: () => json(200, organizerEvent({ capacity: 2, registered: 2, seats_left: 0 })),
      [CAPACITY]: () => json(200, organizerEvent({ capacity: 4, registered: 4, seats_left: 0 })),
    });
    renderApp(`/event/${EVENT_ID}`);
    await screen.findByRole("heading", { level: 1, name: "Spring meetup" });
    fireEvent.change(main().getByLabelText("Capacity (seats)"), { target: { value: "4" } });
    fireEvent.click(main().getByRole("button", { name: "Save capacity" }));
    await main().findByText("Capacity saved. Seats left: 0.");
    expect(detail("Capacity")).toBe("4");
    expect(detail("Registered")).toBe("4");
    expect(detail("Seats left")).toBe("0");
    expect(callsTo(fetch, OWN)).toBe(1);
  });
});

describe("W-E20 and W-E21: organizer view structure and links", () => {
  it("has one h1, the Events back link and the share link as text", async () => {
    mockFetch({
      "GET /auth/me": () => json(200, OLGA),
      [OWN]: () => json(200, organizerEvent()),
    });
    renderApp(`/event/${EVENT_ID}`);
    await screen.findByRole("heading", { level: 1, name: "Spring meetup" });

    expect(main().getAllByRole("heading", { level: 1 }).length).toBe(1);
    const back = main().getByRole("link", { name: "Events" });
    expect(back.getAttribute("href")).toBe("/organizer");
    expect(back.textContent).toBe("← Events");
    expect(backLinks()).toEqual([back]);
    const share = main().getByRole("link", { name: `/event/${EVENT_ID}` });
    expect(share.getAttribute("href")).toBe(`/event/${EVENT_ID}`);
    expect(main().getAllByRole("link").length).toBe(3);
  });

  it("links to the registrations of this event", async () => {
    mockFetch({
      "GET /auth/me": () => json(200, OLGA),
      [OWN]: () => json(200, organizerEvent()),
    });
    renderApp(`/event/${EVENT_ID}`);
    await screen.findByRole("heading", { level: 1, name: "Spring meetup" });

    expect(main().getByRole("link", { name: "Registrations" }).getAttribute("href")).toBe(
      `/registrations?event=${EVENT_ID}`,
    );
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

describe("design-alignment.md DA39: the load error has a back link (test first)", () => {
  it("organizer, the owner view fails: the Events back link goes to /organizer, Retry stays", async () => {
    mockFetch({
      "GET /auth/me": () => json(200, OLGA),
      [OWN]: () => json(500, { error: "internal" }),
    });
    renderApp(`/event/${EVENT_ID}`);
    const heading = await screen.findByRole("heading", { level: 1, name: "Could not load this event" });
    const back = main().getByRole("link", { name: "Events" });
    expect(back.getAttribute("href")).toBe("/organizer");
    expect(back.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(backLinks()).toEqual([back]);
    expect(main().getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});
