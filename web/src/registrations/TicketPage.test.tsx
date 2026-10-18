// Tests first (registration-web.md): W-R13. Then W-R11, W-R12 (the ticket page).
// cancel-registration-web.md W-CR1, W-CR5: the cancel section on this page.
// The QR cases (W-R25-W-R27) mock qr.ts: jsdom cannot draw on a canvas (W-R37).
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { App } from "../App";
import {
  ANN,
  OLGA,
  backLinks,
  callsTo,
  deferred,
  json,
  mockFetch,
  renderApp,
} from "../auth/test-helpers";
import { formatDateTime } from "../events/format";
import { EVENT_ID, publicEvent, type SamplePublicEvent } from "../events/test-helpers";
import { drawQr } from "./qr";
import { MY_REGISTRATION, registration, type SampleRegistration } from "./test-helpers";

vi.mock("./qr", () => ({ drawQr: vi.fn() }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(drawQr).mockClear();
});

type Handler = () => Response | Promise<Response>;

const ME = "GET /auth/me";
const PUBLIC = `GET /public/events/${EVENT_ID}`;
const TICKET_PATH = `/registrations/me?event=${EVENT_ID}`;
const loggedOut = () => json(401, { error: "not_logged_in" });

function main() {
  return within(screen.getByRole("main"));
}

function location(): string | null {
  return screen.getByTestId("location").textContent;
}

function sequence(...answers: Handler[]): Handler {
  let n = 0;
  return () => answers[Math.min(n++, answers.length - 1)]();
}

async function ticketPage(event: Handler, mine: Handler) {
  const fetch = mockFetch({ [ME]: () => json(200, ANN), [PUBLIC]: event, [MY_REGISTRATION]: mine });
  renderApp(TICKET_PATH);
  await main().findByRole("heading", { level: 1 });
  await waitFor(() => expect(main().queryByText("Loading...")).toBeNull());
  return fetch;
}

const ok = (body: unknown): Handler => () => json(200, body);
const NOT_FOUND: Handler = () => json(404, { error: "not_found" });

describe("W-R11: the ticket page", () => {
  it.each<[string, SampleRegistration, string | null, string]>([
    ["registered", registration(), null, "Registered"],
    [
      "waitlisted",
      registration({ status: "waitlisted", waitlist_position: 3, ticket_code: "H4Z8WR5NCD" }),
      "Your place: 3",
      "Waiting list",
    ],
    [
      "cancelled",
      registration({ status: "cancelled" }),
      "This ticket is no longer valid.",
      "Cancelled",
    ],
  ])("%s: title, start, the registration badge and the ticket", async (_case, r, line, badge) => {
    const fetch = await ticketPage(ok(publicEvent()), ok(r));
    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual([
      "Your ticket",
    ]);
    // D72: the event name is plain text, not a link.
    expect(main().getByText("Spring meetup").closest("a")).toBeNull();
    expect(main().queryByRole("link", { name: "Spring meetup" })).toBeNull();
    expect(main().getByText(formatDateTime("2030-01-01T10:00:00.000Z"))).toBeTruthy();
    // W-R38: no ticket heading, no event status line; the registration badge only.
    expect(main().queryByRole("heading", { level: 2 })).toBeNull();
    expect(main().queryByText("Open")).toBeNull();
    expect(main().getByText(r.ticket_code)).toBeTruthy();
    expect(main().getByText(badge)).toBeTruthy();
    if (line) expect(main().getByText(line)).toBeTruthy();
    // cancel-registration-web.md W-CR1 (supersedes "no button", W-R11): one "Cancel
    // registration" button for a registered or waiting ticket, none for a cancelled one.
    expect(main().queryAllByRole("button").map((b) => b.textContent)).toEqual(
      r.status === "cancelled" ? [] : ["Cancel registration"],
    );
    expect(main().queryByRole("link", { name: "View ticket" })).toBeNull();
    expect(callsTo(fetch, PUBLIC)).toBe(1);
    expect(callsTo(fetch, MY_REGISTRATION)).toBe(1);
  });

  it.each<[string, Partial<SamplePublicEvent>, string]>([
    ["cancelled", { status: "cancelled", seats_left: 0 }, "Cancelled"],
    ["ended", { status: "passed", has_started: true, seats_left: 0 }, "Ended"],
  ])("a ticket on a %s event shows the registration status, not the event status", async (_case, overrides, word) => {
    await ticketPage(ok(publicEvent(overrides)), ok(registration()));
    expect(main().queryByText(word)).toBeNull();
    expect(main().getByText("Registered")).toBeTruthy();
    expect(main().getByText("K7M2QX9TPA")).toBeTruthy();
  });

  it("W-R38: the registration badge is right under the h1, as on the event page", async () => {
    await ticketPage(ok(publicEvent()), ok(registration()));
    const h1 = main().getByRole("heading", { level: 1 });
    const line = h1.nextElementSibling!;
    expect(line.classList.contains("event-status")).toBe(true);
    expect(line.textContent).toBe("Registered");
    expect(main().getByText("Registered").closest(".ticket-flat")).toBeNull();
    expect(main().queryByText("Status")).toBeNull();
  });

  it("W-R38: the code and the QR are in the main card, not in an inner panel", async () => {
    await ticketPage(ok(publicEvent()), ok(registration()));
    const card = main().getByRole("heading", { level: 1 }).closest("section")!;
    expect(card.classList.contains("ticket-page")).toBe(true);
    expect(card.querySelector(".ticket")).toBeNull();
    expect(card.contains(main().getByText("K7M2QX9TPA"))).toBe(true);
    expect(card.contains(main().getByRole("img", { name: "QR code for ticket K7M2QX9TPA" }))).toBe(
      true,
    );
  });

  it("starts both reads together", async () => {
    const event = deferred<Response>();
    const mine = deferred<Response>();
    const fetch = mockFetch({
      [ME]: () => json(200, ANN),
      [PUBLIC]: () => event.promise,
      [MY_REGISTRATION]: () => mine.promise,
    });
    renderApp(TICKET_PATH);
    await waitFor(() => expect(callsTo(fetch, PUBLIC)).toBe(1));
    await waitFor(() => expect(callsTo(fetch, MY_REGISTRATION)).toBe(1));
    expect(main().getByRole("status").textContent).toBe("Loading...");
  });
});

describe("W-R12: the other states of the ticket page", () => {
  it.each<[string, Handler]>([
    ["no registration", NOT_FOUND],
    ["a registration", ok(registration())],
  ])("event 404 with %s: Event not found and a link home", async (_case, mine) => {
    await ticketPage(NOT_FOUND, mine);
    expect(main().getByRole("heading", { level: 1, name: "Event not found" })).toBeTruthy();
    expect(main().getByRole("link", { name: "Go home" }).getAttribute("href")).toBe("/");
  });

  it("no registration: You have no ticket for this event. and a link to the event", async () => {
    await ticketPage(ok(publicEvent()), NOT_FOUND);
    expect(main().getByText("You have no ticket for this event.")).toBeTruthy();
    expect(main().getByRole("link", { name: "Go to the event" }).getAttribute("href")).toBe(
      `/event/${EVENT_ID}`,
    );
  });

  it('shows "Loading..." until both have answered', async () => {
    const mine = deferred<Response>();
    mockFetch({
      [ME]: () => json(200, ANN),
      [PUBLIC]: () => json(200, publicEvent()),
      [MY_REGISTRATION]: () => mine.promise,
    });
    renderApp(TICKET_PATH);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(main().getByRole("status").textContent).toBe("Loading...");
    expect(main().queryByRole("link", { name: "Spring meetup" })).toBeNull();
  });

  it.each<[string, "event" | "mine"]>([
    ["the event read", "event"],
    ["the registration read", "mine"],
  ])("an error in %s: Could not load your ticket, Retry refetches only it", async (_case, which) => {
    let n = 0;
    const failOnce = (answer: Handler): Handler => () =>
      n++ === 0 ? json(500, { error: "internal" }) : answer();
    const event = which === "event" ? failOnce(ok(publicEvent())) : ok(publicEvent());
    const mine = which === "mine" ? failOnce(ok(registration())) : ok(registration());
    const fetch = await ticketPage(event, mine);
    expect(main().getByRole("alert").textContent).toBe("Could not load your ticket");
    fireEvent.click(main().getByRole("button", { name: "Retry" }));
    expect(await main().findByText("Registered")).toBeTruthy();
    expect(callsTo(fetch, PUBLIC)).toBe(which === "event" ? 2 : 1);
    expect(callsTo(fetch, MY_REGISTRATION)).toBe(which === "mine" ? 2 : 1);
  });
});

describe("W-R13: 401 or 403 on the ticket page goes to the guard", () => {
  it("401 re-checks me and redirects to the login with next, no text of its own", async () => {
    const fetch = mockFetch({
      [ME]: sequence(() => json(200, ANN), loggedOut),
      [PUBLIC]: () => json(200, publicEvent()),
      [MY_REGISTRATION]: loggedOut,
    });
    renderApp(TICKET_PATH);
    await waitFor(() =>
      expect(location()).toBe(`/login?next=${encodeURIComponent(TICKET_PATH)}`),
    );
    expect(screen.queryByText("Could not load your ticket")).toBeNull();
    expect(callsTo(fetch, ME)).toBe(2);
  });

  it("403 re-checks me; an organizer is sent to /registrations", async () => {
    const fetch = mockFetch({
      [ME]: sequence(() => json(200, ANN), () => json(200, OLGA)),
      [PUBLIC]: () => json(200, publicEvent()),
      [MY_REGISTRATION]: () => json(403, { error: "wrong_role" }),
      // The organizer screen reads the organizer's events (W-R20).
      "GET /events": () => json(200, { events: [] }),
    });
    renderApp(TICKET_PATH);
    await waitFor(() => expect(location()).toBe("/registrations"));
    expect(await main().findByRole("heading", { level: 1, name: "Registrations" })).toBeTruthy();
    expect(screen.queryByText("Could not load your ticket")).toBeNull();
    expect(callsTo(fetch, ME)).toBe(2);
  });
});

describe("W-R25: the QR on the ticket page", () => {
  const QR = "QR code for ticket K7M2QX9TPA";

  it("a registered ticket: Check-in code, the QR canvas drawn from the code, the hints", async () => {
    await ticketPage(ok(publicEvent()), ok(registration()));
    expect(main().getByRole("heading", { level: 3, name: "Check-in code" })).toBeTruthy();
    const qr = main().getByRole("img", { name: QR });
    expect(qr.tagName).toBe("CANVAS");
    expect(drawQr).toHaveBeenCalledWith("K7M2QX9TPA", qr);
    expect(main().getByText("Show this QR code at the entrance.")).toBeTruthy();
    expect(main().getByText("If the scan does not work, show the ticket code.")).toBeTruthy();
    // The code stays selectable text (W-R22, W-R26).
    expect(main().getByText("K7M2QX9TPA").tagName).not.toBe("CANVAS");
  });

  it("a registered ticket on an ended event still shows the QR", async () => {
    await ticketPage(
      ok(publicEvent({ status: "passed", has_started: true, seats_left: 0 })),
      ok(registration()),
    );
    expect(main().getByRole("img", { name: QR })).toBeTruthy();
  });

  it.each<[string, Partial<SamplePublicEvent>, SampleRegistration]>([
    [
      "waitlisted",
      { full: true, seats_left: 0 },
      registration({ status: "waitlisted", waitlist_position: 1 }),
    ],
    ["a cancelled ticket", {}, registration({ status: "cancelled" })],
    ["a cancelled event", { status: "cancelled", seats_left: 0 }, registration()],
  ])("%s: no QR, the code text stays", async (_case, event, r) => {
    await ticketPage(ok(publicEvent(event)), ok(r));
    expect(main().getByText(r.ticket_code)).toBeTruthy();
    expect(main().queryByRole("img")).toBeNull();
    expect(main().queryByRole("heading", { name: "Check-in code" })).toBeNull();
    expect(drawQr).not.toHaveBeenCalled();
  });

  // User request 18-10: a checked-in ticket has nothing that can be used for entry, no QR
  // and no ticket code. The rule keys on checked_in_at only (any event status, also a
  // cancelled registration). W-R42: the badge of a registered one reads "Checked in" instead
  // of "Registered" and the separate "Checked in" line is gone (it would repeat the badge);
  // a cancelled registration keeps its own badge, so it shows no "Checked in" at all.
  it.each<[string, Partial<SamplePublicEvent>, SampleRegistration, string]>([
    ["registered", {}, registration({ checked_in_at: "2030-01-01T09:55:00.000Z" }), "Checked in"],
    [
      "registered, cancelled event",
      { status: "cancelled", seats_left: 0 },
      registration({ checked_in_at: "2030-01-01T09:55:00.000Z" }),
      "Checked in",
    ],
    [
      "registered, ended event",
      { status: "passed", has_started: true, seats_left: 0 },
      registration({ checked_in_at: "2030-01-01T09:55:00.000Z" }),
      "Checked in",
    ],
    [
      "cancelled registration",
      {},
      registration({ status: "cancelled", checked_in_at: "2030-01-01T09:55:00.000Z" }),
      "Cancelled",
    ],
  ])('a checked-in ticket (%s): only the badge, no code, no QR, no hint, no time', async (_case, event, r, badge) => {
    await ticketPage(ok(publicEvent(event)), ok(r));
    // What stays: the h1, the badge (right under the h1), the event title and start.
    const h1 = main().getByRole("heading", { level: 1, name: "Your ticket" });
    const line = h1.nextElementSibling!;
    expect(line.classList.contains("event-status")).toBe(true);
    expect(line.textContent).toBe(badge);
    expect(main().getAllByText(badge)).toHaveLength(1);
    // W-R42: no "Registered" and no separate "Checked in" line.
    expect(main().queryByText("Registered")).toBeNull();
    expect(screen.getByRole("main").querySelector(".ticket-checked-in")).toBeNull();
    expect(main().queryAllByText("Checked in")).toHaveLength(badge === "Checked in" ? 1 : 0);
    expect(main().getByText("Spring meetup")).toBeTruthy();
    expect(main().getByText(formatDateTime("2030-01-01T10:00:00.000Z"))).toBeTruthy();
    // No ticket code at all: no label, no text, no aria-label with it.
    expect(main().queryByText("Ticket code")).toBeNull();
    expect(main().queryByText(r.ticket_code)).toBeNull();
    expect(screen.getByRole("main").textContent).not.toContain(r.ticket_code);
    expect(screen.getByRole("main").querySelector(`[aria-label*="${r.ticket_code}"]`)).toBeNull();
    // No QR component.
    expect(main().queryByRole("img")).toBeNull();
    expect(screen.getByRole("main").querySelector("canvas")).toBeNull();
    expect(main().queryByRole("heading", { level: 3, name: "Check-in code" })).toBeNull();
    expect(main().queryByText("Show this QR code at the entrance.")).toBeNull();
    expect(main().queryByText("If the scan does not work, show the ticket code.")).toBeNull();
    expect(drawQr).not.toHaveBeenCalled();
    expect(main().queryByText(formatDateTime("2030-01-01T09:55:00.000Z"))).toBeNull();
  });

  it("not checked in: the code, the QR and the hints are all there, no Checked in", async () => {
    await ticketPage(ok(publicEvent()), ok(registration({ checked_in_at: null })));
    expect(main().getByText("Ticket code")).toBeTruthy();
    expect(main().getByText("K7M2QX9TPA")).toBeTruthy();
    expect(main().getByRole("img", { name: QR })).toBeTruthy();
    expect(main().getByRole("heading", { level: 3, name: "Check-in code" })).toBeTruthy();
    expect(main().getByText("Show this QR code at the entrance.")).toBeTruthy();
    expect(main().getByText("If the scan does not work, show the ticket code.")).toBeTruthy();
    expect(drawQr).toHaveBeenCalledTimes(1);
    expect(main().queryByText("Checked in")).toBeNull();
    // W-R42: the badge under the h1 still says "Registered".
    const h1 = main().getByRole("heading", { level: 1, name: "Your ticket" });
    expect(h1.nextElementSibling!.textContent).toBe("Registered");
  });
});

describe("W-R26: the QR is accessible", () => {
  it("the canvas has role img and the label with the code, and the code stays visible", async () => {
    await ticketPage(ok(publicEvent()), ok(registration({ ticket_code: "H4Z8WR5NCD" })));
    const qr = main().getByRole("img", { name: "QR code for ticket H4Z8WR5NCD" });
    expect(qr.getAttribute("role")).toBe("img");
    expect(main().getByText("H4Z8WR5NCD")).toBeTruthy();
  });
});

describe("W-R27: no network for the QR", () => {
  it("drawing and re-rendering the QR makes no fetch", async () => {
    const fetch = mockFetch({
      [ME]: () => json(200, ANN),
      [PUBLIC]: () => json(200, publicEvent()),
      [MY_REGISTRATION]: () => json(200, registration()),
    });
    const { rerender, queryClient } = renderApp(TICKET_PATH);
    await main().findByRole("img", { name: "QR code for ticket K7M2QX9TPA" });
    const before = fetch.mock.calls.length;
    expect(drawQr).toHaveBeenCalledTimes(1);
    // The same tree again: the router and the cache keep their state.
    rerender(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[TICKET_PATH]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(main().getByRole("img", { name: "QR code for ticket K7M2QX9TPA" })).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetch.mock.calls.length).toBe(before);
  });
});

describe("design-alignment.md DA40-DA43: the ticket page back link", () => {
  it.each<[string, SampleRegistration]>([
    ["registered", registration()],
    ["waitlisted", registration({ status: "waitlisted", waitlist_position: 3 })],
    ["cancelled", registration({ status: "cancelled" })],
    ["checked in", registration({ checked_in_at: "2030-01-01T09:55:00.000Z" })],
  ])("%s: the Event back link goes to the event, above the h1", async (_case, mine) => {
    await ticketPage(ok(publicEvent()), ok(mine));
    expect(backLinks()).toHaveLength(1);
    const link = main().getByRole("link", { name: "Event" });
    expect(link.textContent).toBe("← Event");
    expect(link.getAttribute("href")).toBe(`/event/${EVENT_ID}`);
    const heading = main().getByRole("heading", { level: 1, name: "Your ticket" });
    expect(link.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The event name under the h1 is plain text (D72).
    expect(main().getByText("Spring meetup").closest("a")).toBeNull();
  });

  it("the load error has the same link; Retry stays", async () => {
    await ticketPage(() => json(500, { error: "internal" }), ok(registration()));
    expect(main().getByRole("alert").textContent).toBe("Could not load your ticket");
    expect(backLinks()).toHaveLength(1);
    expect(main().getByRole("link", { name: "Event" }).getAttribute("href")).toBe(
      `/event/${EVENT_ID}`,
    );
    expect(main().getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("no ticket: only Go to the event, no back link", async () => {
    await ticketPage(ok(publicEvent()), NOT_FOUND);
    expect(main().getByRole("link", { name: "Go to the event" })).toBeTruthy();
    expect(backLinks()).toHaveLength(0);
  });

  it("event not found: only Go home, no back link", async () => {
    await ticketPage(NOT_FOUND, NOT_FOUND);
    expect(main().getByRole("link", { name: "Go home" })).toBeTruthy();
    expect(backLinks()).toHaveLength(0);
  });

  it("loading: no back link", async () => {
    const mine = deferred<Response>();
    mockFetch({
      [ME]: () => json(200, ANN),
      [PUBLIC]: () => json(200, publicEvent()),
      [MY_REGISTRATION]: () => mine.promise,
    });
    renderApp(TICKET_PATH);
    await main().findByRole("heading", { level: 1, name: "Your ticket" });
    expect(main().getByRole("status").textContent).toBe("Loading...");
    expect(backLinks()).toHaveLength(0);
  });
});

describe("email-reminders-web.md W-EM14: no email line on the ticket page", () => {
  it("a registered ticket has no email, reminder or server log text and no emails link", async () => {
    const fetch = await ticketPage(ok(publicEvent()), ok(registration()));
    const text = screen.getByRole("main").textContent ?? "";
    expect(text).not.toMatch(/email|reminder|server log/i);
    expect(main().queryByRole("link", { name: /emails/i })).toBeNull();
    expect(fetch.mock.calls.filter(([input]) => String(input).includes("/emails"))).toEqual([]);
  });
});

// email-reminders-web.md W-EM30 (test first): a cancelled event adds one plain line under
// the event name, before Starts, for every ticket status; it reads no more than before.
describe("W-EM30: a cancelled event on the ticket page", () => {
  const LINE = "This event has been cancelled.";
  const CANCELLED_EVENT: Partial<SamplePublicEvent> = { status: "cancelled", seats_left: 0 };

  it.each<[string, SampleRegistration]>([
    ["a cancelled ticket", registration({ status: "cancelled" })],
    ["a checked-in ticket", registration({ checked_in_at: "2030-01-01T09:55:00.000Z" })],
    ["a registered ticket", registration()],
    ["a waiting ticket", registration({ status: "waitlisted", waitlist_position: 2 })],
  ])("%s: the line under the event name and before Starts", async (_case, r) => {
    const fetch = await ticketPage(ok(publicEvent(CANCELLED_EVENT)), ok(r));
    const line = main().getByText(LINE);
    expect(line.tagName).toBe("P");
    expect(line.classList.contains("ticket-event-note")).toBe(true);
    expect(line.getAttribute("role")).toBeNull();
    const name = main().getByText("Spring meetup");
    const starts = main().getByText("Starts", { selector: "dt" });
    expect(name.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(line.compareDocumentPosition(starts) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(main().getAllByText(LINE)).toHaveLength(1);
    // No new request: the public event the page already reads.
    expect(fetch.mock.calls.map(([input, init]) => `${init?.method ?? "GET"} ${String(input)}`)).toEqual([
      ME,
      PUBLIC,
      MY_REGISTRATION,
    ]);
  });

  it("the cancelled ticket keeps its badge, the code as text and the note", async () => {
    await ticketPage(ok(publicEvent(CANCELLED_EVENT)), ok(registration({ status: "cancelled" })));
    expect(main().getByText(LINE)).toBeTruthy();
    expect(main().getByText("Cancelled", { selector: ".badge" })).toBeTruthy();
    expect(main().getByText("K7M2QX9TPA")).toBeTruthy();
    expect(main().getByText("This ticket is no longer valid.")).toBeTruthy();
    expect(main().queryByRole("img")).toBeNull();
  });

  it.each<[string, Partial<SamplePublicEvent>]>([
    ["an active event", {}],
    ["an ended event", { status: "passed", has_started: true, seats_left: 0 }],
  ])("%s: no line", async (_case, event) => {
    await ticketPage(ok(publicEvent(event)), ok(registration()));
    expect(main().queryByText(LINE)).toBeNull();
    expect(screen.getByRole("main").querySelector(".ticket-event-note")).toBeNull();
  });
});

// W-EM31: the moved start shows by itself; there is no "Rescheduled" badge or line.
describe("W-EM31: a moved start on the ticket page", () => {
  it("shows the new start and no Rescheduled word", async () => {
    await ticketPage(
      ok(publicEvent({ starts_at: "2030-02-01T17:30:00.000Z", ends_at: "2030-02-01T19:00:00.000Z" })),
      ok(registration()),
    );
    expect(main().getByText(formatDateTime("2030-02-01T17:30:00.000Z"))).toBeTruthy();
    expect(screen.getByRole("main").textContent).not.toMatch(/rescheduled/i);
  });
});

// cancel-registration-web.md W-CR1: the section only for an active ticket on an active event
// that has not started. Otherwise no button, no disabled button and no hint; no extra read.
describe("W-CR1: when the ticket page has the Cancel registration section", () => {
  const CHECKED_IN = "2030-01-01T09:55:00.000Z";

  it.each<[string, Partial<SamplePublicEvent>, SampleRegistration]>([
    ["registered, open event", {}, registration()],
    ["registered, full event", { full: true, seats_left: 0 }, registration()],
    [
      "waitlisted, full event",
      { full: true, seats_left: 0 },
      registration({ status: "waitlisted", waitlist_position: 1 }),
    ],
  ])("%s: the button", async (_case, event, r) => {
    const fetch = await ticketPage(ok(publicEvent(event)), ok(r));
    expect(main().getByRole("button", { name: "Cancel registration" })).toBeTruthy();
    expect(fetch.mock.calls).toHaveLength(3);
  });

  it.each<[string, Partial<SamplePublicEvent>, SampleRegistration]>([
    ["a cancelled ticket", {}, registration({ status: "cancelled" })],
    ["a checked-in ticket", {}, registration({ checked_in_at: CHECKED_IN })],
    ["a cancelled event", { status: "cancelled", seats_left: 0 }, registration()],
    ["an ended event", { status: "passed", has_started: true, seats_left: 0 }, registration()],
    ["a started event", { has_started: true }, registration()],
    [
      "a started event, waiting ticket",
      { has_started: true, full: true, seats_left: 0 },
      registration({ status: "waitlisted", waitlist_position: 1 }),
    ],
  ])("%s: no button at all, no hint", async (_case, event, r) => {
    const fetch = await ticketPage(ok(publicEvent(event)), ok(r));
    expect(main().queryAllByRole("button")).toEqual([]);
    expect(main().queryByRole("group")).toBeNull();
    expect(screen.getByRole("main").textContent).not.toMatch(/cancel registration|can no longer be cancelled/i);
    expect(fetch.mock.calls).toHaveLength(3);
  });

  it("loading and no-ticket states have no section", async () => {
    const mine = deferred<Response>();
    mockFetch({
      [ME]: () => json(200, ANN),
      [PUBLIC]: () => json(200, publicEvent()),
      [MY_REGISTRATION]: () => mine.promise,
    });
    renderApp(TICKET_PATH);
    await main().findByRole("heading", { level: 1, name: "Your ticket" });
    expect(main().queryByRole("button", { name: "Cancel registration" })).toBeNull();
    mine.resolve(json(404, { error: "not_found" }));
    expect(await main().findByText("You have no ticket for this event.")).toBeTruthy();
    expect(main().queryByRole("button", { name: "Cancel registration" })).toBeNull();
  });
});

describe("W-CR5: the ticket page after a cancel", () => {
  it("a mocked 200: badge Cancelled, no QR, the message", async () => {
    const fetch = mockFetch({
      [ME]: () => json(200, ANN),
      [PUBLIC]: () => json(200, publicEvent()),
      [MY_REGISTRATION]: () => json(200, registration()),
      [`POST /events/${EVENT_ID}/registrations/me/cancel`]: () =>
        json(200, registration({ status: "cancelled" })),
    });
    renderApp(TICKET_PATH);
    fireEvent.click(await main().findByRole("button", { name: "Cancel registration" }));
    fireEvent.click(main().getByRole("button", { name: "Yes, cancel registration" }));
    expect((await main().findByRole("status")).textContent).toBe(
      "Registration cancelled. Your seat is free for someone else.",
    );
    expect(main().getByText("Cancelled", { selector: ".badge" })).toBeTruthy();
    expect(main().getByText("This ticket is no longer valid.")).toBeTruthy();
    expect(main().queryByRole("img")).toBeNull();
    expect(main().queryAllByRole("button")).toEqual([]);
    expect(callsTo(fetch, MY_REGISTRATION)).toBe(1);
  });
});
