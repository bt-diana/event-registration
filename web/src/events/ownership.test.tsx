// Tests first (events-web.md): W-E2, W-E10, W-E11, W-E13, W-E14.
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
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
import { EVENT_ID, organizerEvent, publicEvent } from "./test-helpers";

afterEach(() => {
  vi.unstubAllGlobals();
});

const LOGGED_OUT = () => json(401, { error: "not_logged_in" });
const NOT_FOUND = () => json(404, { error: "not_found" });
const OWN = `GET /events/${EVENT_ID}`;

function main() {
  return within(screen.getByRole("main"));
}
const PUBLIC = `GET /public/events/${EVENT_ID}`;

function location(): string | null {
  return screen.getByTestId("location").textContent;
}

// me answers each value in turn, then keeps the last one.
function meSequence(...answers: Array<() => Response>) {
  let n = 0;
  return () => answers[Math.min(n++, answers.length - 1)]();
}

describe("W-E2: empty events list", () => {
  it("shows the empty text and a Create event link, no table, one GET /events", async () => {
    const fetch = mockFetch({
      "GET /auth/me": () => json(200, OLGA),
      "GET /events": () => json(200, { events: [] }),
    });
    renderApp("/organizer");

    expect(await screen.findByText("You have no events yet.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Create event" }).getAttribute("href")).toBe(
      "/organizer/events/new",
    );
    expect(screen.queryByRole("table")).toBeNull();
    expect(callsTo(fetch, "GET /events")).toBe(1);
  });
});

describe("W-E10 and W-E11: one link, the view follows the viewer", () => {
  it("the owner sees the organizer view and no public request is made", async () => {
    const fetch = mockFetch({
      "GET /auth/me": () => json(200, OLGA),
      [OWN]: () => json(200, organizerEvent({ registered: 3, seats_left: 22 })),
    });
    renderApp(`/event/${EVENT_ID}`);

    expect(await screen.findByRole("heading", { level: 1, name: "Spring meetup" })).toBeTruthy();
    expect(screen.getByText("Registered")).toBeTruthy();
    expect(screen.getByText("Seats left")).toBeTruthy();
    expect(screen.getByText("22")).toBeTruthy();
    expect(main().getByRole("link", { name: "Events" }).getAttribute("href")).toBe("/organizer");
    expect(backLinks()).toHaveLength(1);
    expect(callsTo(fetch, OWN)).toBe(1);
    expect(callsTo(fetch, PUBLIC)).toBe(0);
  });

  it("another organizer's event (404) falls back to the public view, no owner data", async () => {
    const fetch = mockFetch({
      "GET /auth/me": () => json(200, OLGA),
      [OWN]: NOT_FOUND,
      [PUBLIC]: () => json(200, publicEvent({ title: "Other meetup" })),
    });
    renderApp(`/event/${EVENT_ID}`);

    expect(await screen.findByRole("heading", { level: 1, name: "Other meetup" })).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.getByText("25 of 25 seats left")).toBeTruthy();
    expect(screen.queryByText("Registered")).toBeNull();
    // The public view's back link goes to the public list, never to /organizer (DA38).
    expect(main().getByRole("link", { name: "Events" }).getAttribute("href")).toBe("/");
    expect(backLinks()).toHaveLength(1);
    expect(screen.queryByText("Event not found")).toBeNull();
    expect(screen.queryByText(/someone else|another organizer|not yours/i)).toBeNull();
    expect(callsTo(fetch, OWN)).toBe(1);
    expect(callsTo(fetch, PUBLIC)).toBe(1);
  });

  it("an organizer gets Event not found when the public call is 404 too", async () => {
    mockFetch({
      "GET /auth/me": () => json(200, OLGA),
      [OWN]: NOT_FOUND,
      [PUBLIC]: NOT_FOUND,
    });
    renderApp(`/event/${EVENT_ID}`);

    expect(await screen.findByRole("heading", { level: 1, name: "Event not found" })).toBeTruthy();
    expect(screen.getByText("This link is not valid or the event does not exist.")).toBeTruthy();
  });

  it.each([
    ["logged out", LOGGED_OUT],
    ["an attendee", () => json(200, ANN)],
    ["me failed", () => json(500, { error: "internal" })],
  ])("%s gets the public view and no organizer request", async (_label, me) => {
    const fetch = mockFetch({
      "GET /auth/me": me,
      [PUBLIC]: () => json(200, publicEvent()),
    });
    renderApp(`/event/${EVENT_ID}`);

    expect(await screen.findByRole("heading", { level: 1, name: "Spring meetup" })).toBeTruthy();
    expect(screen.getByText("Event")).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy();
    // The public view's back link goes to the public list, never to /organizer (DA38).
    expect(main().getByRole("link", { name: "Events" }).getAttribute("href")).toBe("/");
    expect(backLinks()).toHaveLength(1);
    expect(callsTo(fetch, OWN)).toBe(0);
    expect(callsTo(fetch, PUBLIC)).toBe(1);
  });
});

describe("W-E13: 401 or 403 from an organizer call goes to the guard", () => {
  it("401 on the list re-checks me and redirects to the login with next", async () => {
    const fetch = mockFetch({
      "GET /auth/me": meSequence(() => json(200, OLGA), LOGGED_OUT),
      "GET /events": LOGGED_OUT,
    });
    renderApp("/organizer");

    await waitFor(() => expect(location()).toBe("/organizer/login?next=%2Forganizer"));
    expect(screen.queryByText("Could not load your events")).toBeNull();
    expect(callsTo(fetch, "GET /auth/me")).toBe(2);
  });

  it("403 on the list re-checks me and shows the wrong-account message", async () => {
    mockFetch({
      "GET /auth/me": meSequence(() => json(200, OLGA), () => json(200, ANN)),
      "GET /events": () => json(403, { error: "wrong_role" }),
    });
    renderApp("/organizer");

    expect(
      await screen.findByText("This page is for organizers. You are logged in as ann@mail.com."),
    ).toBeTruthy();
    expect(screen.queryByText("Could not load your events")).toBeNull();
    expect(location()).toBe("/organizer");
  });

  it("401 on create redirects to the login and shows no form error", async () => {
    const fetch = mockFetch({
      "GET /auth/me": meSequence(() => json(200, OLGA), LOGGED_OUT),
      "POST /events": LOGGED_OUT,
    });
    renderApp("/organizer/events/new");

    fireEvent.change(await screen.findByLabelText("Title"), { target: { value: "Meetup" } });
    fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "2030-01-01T10:00" } });
    fireEvent.change(screen.getByLabelText("Duration (minutes)"), { target: { value: "90" } });
    fireEvent.change(screen.getByLabelText("Capacity (seats)"), { target: { value: "25" } });
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() =>
      expect(location()).toBe("/organizer/login?next=%2Forganizer%2Fevents%2Fnew"),
    );
    expect(screen.queryByText("Something went wrong. Try again.")).toBeNull();
    expect(screen.queryByText("Some fields are not valid. Check them and try again.")).toBeNull();
    expect(callsTo(fetch, "POST /events")).toBe(1);
  });

  it("401 on the owner call re-checks me and then shows the public view", async () => {
    const fetch = mockFetch({
      "GET /auth/me": meSequence(() => json(200, OLGA), LOGGED_OUT),
      [OWN]: LOGGED_OUT,
      [PUBLIC]: () => json(200, publicEvent()),
    });
    renderApp(`/event/${EVENT_ID}`);

    expect(await screen.findByRole("heading", { level: 1, name: "Spring meetup" })).toBeTruthy();
    expect(screen.queryByText("Could not load this event")).toBeNull();
    expect(callsTo(fetch, "GET /auth/me")).toBe(2);
    expect(callsTo(fetch, PUBLIC)).toBe(1);
  });
});

describe("W-E14: guards and no early event requests", () => {
  it.each(["/organizer", "/organizer/events/new"])(
    "%s makes no event request while me loads, and none when logged out",
    async (path) => {
      const me = deferred<Response>();
      const fetch = mockFetch({ "GET /auth/me": () => me.promise });
      renderApp(path);

      expect(screen.getByRole("status").textContent).toBe("Loading...");
      expect(callsTo(fetch, "GET /events")).toBe(0);

      await act(async () => me.resolve(LOGGED_OUT()));
      await waitFor(() =>
        expect(location()).toBe(`/organizer/login?next=${encodeURIComponent(path)}`),
      );
      expect(fetch.mock.calls.length).toBe(1);
    },
  );

  it.each(["/organizer", "/organizer/events/new"])(
    "%s shows the wrong-account message to an attendee and makes no event request",
    async (path) => {
      const fetch = mockFetch({ "GET /auth/me": () => json(200, ANN) });
      renderApp(path);
      expect(
        await screen.findByText("This page is for organizers. You are logged in as ann@mail.com."),
      ).toBeTruthy();
      expect(fetch.mock.calls.length).toBe(1);
    },
  );

  it("/event/:id shows Loading... until me answers, then makes only its own request", async () => {
    const me = deferred<Response>();
    const fetch = mockFetch({
      "GET /auth/me": () => me.promise,
      [PUBLIC]: () => json(200, publicEvent()),
    });
    renderApp(`/event/${EVENT_ID}`);

    expect(screen.getByRole("status").textContent).toBe("Loading...");
    expect(callsTo(fetch, OWN)).toBe(0);
    expect(callsTo(fetch, PUBLIC)).toBe(0);

    await act(async () => me.resolve(LOGGED_OUT()));
    expect(await screen.findByRole("heading", { level: 1, name: "Spring meetup" })).toBeTruthy();
    expect(callsTo(fetch, OWN)).toBe(0);
    expect(callsTo(fetch, PUBLIC)).toBe(1);
  });
});
