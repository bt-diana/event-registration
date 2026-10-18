// Tests first (registration-web.md): W-R13. Then W-R11, W-R12 (the ticket page).
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { ANN, OLGA, callsTo, deferred, json, mockFetch, renderApp } from "../auth/test-helpers";
import { formatDateTime } from "../events/format";
import { EVENT_ID, publicEvent, type SamplePublicEvent } from "../events/test-helpers";
import { MY_REGISTRATION, registration, type SampleRegistration } from "./test-helpers";

afterEach(() => {
  vi.unstubAllGlobals();
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
  it.each<[string, SampleRegistration, string, string | null, string]>([
    ["registered", registration(), "You are registered", null, "Registered"],
    [
      "waitlisted",
      registration({ status: "waitlisted", waitlist_position: 3, ticket_code: "H4Z8WR5NCD" }),
      "You are on the waiting list",
      "Your place: 3",
      "Waiting list",
    ],
    [
      "cancelled",
      registration({ status: "cancelled" }),
      "Registration cancelled",
      "This ticket is no longer valid.",
      "Cancelled",
    ],
  ])("%s: title link, start, status line and the ticket", async (_case, r, h2, line, badge) => {
    const fetch = await ticketPage(ok(publicEvent()), ok(r));
    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual([
      "Your ticket",
    ]);
    expect(main().getByRole("link", { name: "Spring meetup" }).getAttribute("href")).toBe(
      `/event/${EVENT_ID}`,
    );
    expect(main().getByText(formatDateTime("2030-01-01T10:00:00.000Z"))).toBeTruthy();
    expect(main().getByText("Open")).toBeTruthy();
    expect(main().getByRole("heading", { level: 2, name: h2 })).toBeTruthy();
    expect(main().getByText(r.ticket_code)).toBeTruthy();
    expect(main().getByText(badge)).toBeTruthy();
    if (line) expect(main().getByText(line)).toBeTruthy();
    expect(main().queryAllByRole("button")).toEqual([]);
    expect(main().queryByRole("link", { name: "View ticket" })).toBeNull();
    expect(callsTo(fetch, PUBLIC)).toBe(1);
    expect(callsTo(fetch, MY_REGISTRATION)).toBe(1);
  });

  it.each<[string, Partial<SamplePublicEvent>, string]>([
    ["cancelled", { status: "cancelled", seats_left: 0 }, "Cancelled"],
    ["ended", { status: "passed", has_started: true, seats_left: 0 }, "Ended"],
  ])("a ticket on a %s event is still shown with the event status", async (_case, overrides, word) => {
    await ticketPage(ok(publicEvent(overrides)), ok(registration()));
    expect(main().getByText(word)).toBeTruthy();
    expect(main().getByRole("heading", { level: 2, name: "You are registered" })).toBeTruthy();
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
    expect(
      await main().findByRole("heading", { level: 2, name: "You are registered" }),
    ).toBeTruthy();
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
    });
    renderApp(TICKET_PATH);
    await waitFor(() => expect(location()).toBe("/registrations"));
    expect(await main().findByRole("heading", { level: 1, name: "Registrations" })).toBeTruthy();
    expect(screen.queryByText("Could not load your ticket")).toBeNull();
    expect(callsTo(fetch, ME)).toBe(2);
  });
});
