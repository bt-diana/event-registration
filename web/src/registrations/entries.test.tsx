// Tests first (registration-web.md): W-R15, W-R16, W-R17, the two list routes and their
// redirects. The organizer screen loads the organizer's events (W-R20), so its cases
// answer GET /events; the attendee list reads GET /me/registrations (W-R18, W-R41), so the
// attendee cases answer it. The list itself is tested in MyRegistrations.test.tsx.
import { useEffect } from "react";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useLocation } from "react-router";
import { App } from "../App";
import type { Me } from "../auth/api";
import { ANN, OLGA, callsTo, deferred, json, mockFetch, renderApp, renderWith } from "../auth/test-helpers";
import { EVENT_ID, organizerEvent } from "../events/test-helpers";

afterEach(() => {
  vi.unstubAllGlobals();
});

const ME = "GET /auth/me";
const EVENTS = "GET /events";
const LIST = "GET /me/registrations";
const noEvents = () => json(200, { events: [] });
const noRegistrations = () => json(200, { registrations: [] });
const loggedOut = () => json(401, { error: "not_logged_in" });

function main() {
  return within(screen.getByRole("main"));
}

function location(): string | null {
  return screen.getByTestId("location").textContent;
}

// Records every location the app shows, in order.
function Recorder({ seen }: { seen: string[] }) {
  const { pathname, search } = useLocation();
  useEffect(() => {
    seen.push(pathname + search);
  }, [pathname, search, seen]);
  return null;
}

describe("W-R15: /registrations/me is the attendee screen", () => {
  it("an attendee sees it; the me request, then the screen's own list request", async () => {
    const fetch = mockFetch({ [ME]: () => json(200, ANN), [LIST]: noRegistrations });
    renderApp("/registrations/me");
    expect(await main().findByRole("heading", { level: 1, name: "My registrations" })).toBeTruthy();
    expect(location()).toBe("/registrations/me");
    expect(callsTo(fetch, ME)).toBe(1);
    await waitFor(() => expect(callsTo(fetch, LIST)).toBe(1));
    expect(fetch.mock.calls).toHaveLength(2);
  });

  it("logged out: redirect to the attendee login with the path and the query in next", async () => {
    const fetch = mockFetch({ [ME]: loggedOut });
    renderApp("/registrations/me?event=abc");
    await waitFor(() =>
      expect(location()).toBe(`/login?next=${encodeURIComponent("/registrations/me?event=abc")}`),
    );
    expect(await screen.findByLabelText("Email")).toBeTruthy();
    expect(fetch.mock.calls).toHaveLength(1);
  });

  it("an organizer is redirected to /registrations, no wrong-account message", async () => {
    const fetch = mockFetch({ [ME]: () => json(200, OLGA), [EVENTS]: noEvents });
    renderApp("/registrations/me");
    await waitFor(() => expect(location()).toBe("/registrations"));
    expect(await main().findByRole("heading", { level: 1, name: "Registrations" })).toBeTruthy();
    expect(screen.queryByText(/This page is for/)).toBeNull();
    // Only me, then the organizer screen's own events read.
    expect(callsTo(fetch, ME)).toBe(1);
    await waitFor(() => expect(callsTo(fetch, EVENTS)).toBe(1));
    expect(fetch.mock.calls).toHaveLength(2);
  });

  it('shows only "Loading..." while me loads: no redirect, no other request', async () => {
    const me = deferred<Response>();
    const fetch = mockFetch({ [ME]: () => me.promise });
    renderApp("/registrations/me?event=abc");
    expect(main().getByRole("status").textContent).toBe("Loading...");
    expect(main().queryByRole("heading")).toBeNull();
    expect(location()).toBe("/registrations/me?event=abc");
    expect(fetch.mock.calls).toHaveLength(1);
    await act(async () => me.resolve(loggedOut()));
    await waitFor(() => expect(location()).toMatch(/^\/login\?next=/));
  });
});

describe("W-R16: /registrations is the organizer screen", () => {
  it("an organizer sees it", async () => {
    const fetch = mockFetch({ [ME]: () => json(200, OLGA), [EVENTS]: noEvents });
    renderApp("/registrations");
    expect(await main().findByRole("heading", { level: 1, name: "Registrations" })).toBeTruthy();
    expect(location()).toBe("/registrations");
    expect(callsTo(fetch, ME)).toBe(1);
  });

  it.each(["/registrations", "/registrations?event=abc"])(
    "an attendee on %s is redirected to /registrations/me, never the wrong-account message",
    async (path) => {
      const fetch = mockFetch({ [ME]: () => json(200, ANN), [LIST]: noRegistrations });
      renderApp(path);
      await waitFor(() => expect(location()).toBe("/registrations/me"));
      expect(await main().findByRole("heading", { level: 1, name: "My registrations" })).toBeTruthy();
      expect(screen.queryByText(/This page is for/)).toBeNull();
      // Only me for the redirect; the attendee screen then reads its list once.
      expect(callsTo(fetch, ME)).toBe(1);
      await waitFor(() => expect(callsTo(fetch, LIST)).toBe(1));
      expect(fetch.mock.calls).toHaveLength(2);
    },
  );

  it("logged out: redirect to the organizer login with next", async () => {
    mockFetch({ [ME]: loggedOut });
    renderApp("/registrations");
    await waitFor(() => expect(location()).toBe("/organizer/login?next=%2Fregistrations"));
    expect(await screen.findByLabelText("Email")).toBeTruthy();
  });

  it('shows only "Loading..." while me loads, no redirect', async () => {
    const me = deferred<Response>();
    const fetch = mockFetch({ [ME]: () => me.promise, [EVENTS]: noEvents });
    renderApp("/registrations");
    expect(main().getByRole("status").textContent).toBe("Loading...");
    expect(main().queryByRole("heading")).toBeNull();
    expect(location()).toBe("/registrations");
    expect(callsTo(fetch, EVENTS)).toBe(0);
    await act(async () => me.resolve(json(200, OLGA)));
    expect(await main().findByRole("heading", { level: 1, name: "Registrations" })).toBeTruthy();
  });

  it.each([
    ["5xx", () => json(500, { error: "internal" })],
    [
      "network error",
      () => {
        throw new TypeError("Failed to fetch");
      },
    ],
  ])("me %s: Could not check your login with Retry, no redirect", async (_case, failure) => {
    let first = true;
    const fetch = mockFetch({
      [ME]: () => {
        if (first) {
          first = false;
          return failure();
        }
        return json(200, OLGA);
      },
      [EVENTS]: noEvents,
    });
    renderApp("/registrations");
    expect(await screen.findByText("Could not check your login")).toBeTruthy();
    expect(location()).toBe("/registrations");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await main().findByRole("heading", { level: 1, name: "Registrations" })).toBeTruthy();
    expect(callsTo(fetch, ME)).toBe(2);
  });
});

describe("W-R18: the attendee list, not the placeholder", () => {
  it.each(["/registrations/me", "/registrations/me?event="])(
    "%s: the h1, the list request and no placeholder text",
    async (path) => {
      const fetch = mockFetch({ [ME]: () => json(200, ANN), [LIST]: noRegistrations });
      renderApp(path);
      expect(await main().findByRole("heading", { level: 1, name: "My registrations" })).toBeTruthy();
      expect(await main().findByText("You have no registrations yet.")).toBeTruthy();
      expect(main().queryByText("The list is not built yet.")).toBeNull();
      expect(callsTo(fetch, LIST)).toBe(1);
    },
  );
  // The rows, states and request rules are in MyRegistrations.test.tsx; W-R20 and W-R21
  // (the organizer list) are in OrganizerRegistrations.test.tsx.
});

it("W-R20: the organizer screen is not the placeholder any more", async () => {
  mockFetch({ [ME]: () => json(200, OLGA), [EVENTS]: noEvents });
  renderApp("/registrations");
  expect(await main().findByText("You have no events yet.")).toBeTruthy();
  expect(main().queryByText("The list is not built yet.")).toBeNull();
});

describe("W-R28: /registrations/scan is an organizer screen", () => {
  it("an organizer sees it", async () => {
    mockFetch({ [ME]: () => json(200, OLGA), [EVENTS]: noEvents });
    renderApp("/registrations/scan");
    expect(await main().findByRole("heading", { level: 1, name: "Check in" })).toBeTruthy();
    expect(location()).toBe("/registrations/scan");
  });

  it("an attendee is redirected to /registrations/me: only me, then the list request", async () => {
    const fetch = mockFetch({ [ME]: () => json(200, ANN), [LIST]: noRegistrations });
    renderApp("/registrations/scan?event=abc");
    await waitFor(() => expect(location()).toBe("/registrations/me"));
    expect(await main().findByRole("heading", { level: 1, name: "My registrations" })).toBeTruthy();
    expect(screen.queryByText(/This page is for/)).toBeNull();
    expect(callsTo(fetch, ME)).toBe(1);
    await waitFor(() => expect(callsTo(fetch, LIST)).toBe(1));
    expect(fetch.mock.calls).toHaveLength(2);
  });

  it("logged out: redirect to the organizer login with next", async () => {
    mockFetch({ [ME]: loggedOut });
    renderApp("/registrations/scan");
    await waitFor(() =>
      expect(location()).toBe("/organizer/login?next=%2Fregistrations%2Fscan"),
    );
  });

  it('shows only "Loading..." while me loads: no camera button, no other request', async () => {
    const me = deferred<Response>();
    const fetch = mockFetch({ [ME]: () => me.promise, [EVENTS]: noEvents });
    renderApp("/registrations/scan");
    expect(main().getByRole("status").textContent).toBe("Loading...");
    expect(main().queryByRole("button")).toBeNull();
    expect(fetch.mock.calls).toHaveLength(1);
    await act(async () => me.resolve(json(200, OLGA)));
    expect(await main().findByRole("heading", { level: 1, name: "Check in" })).toBeTruthy();
  });

  it("/registrations links to it with Check in attendees, keeping the chosen event", async () => {
    mockFetch({
      [ME]: () => json(200, OLGA),
      [EVENTS]: () => json(200, { events: [organizerEvent()] }),
      [`GET /events/${EVENT_ID}/registrations`]: () => json(200, { registrations: [] }),
      // The arrivals counter of both screens (checkin-web.md W-C3).
      [`GET /events/${EVENT_ID}/arrivals`]: () =>
        json(200, { capacity: 25, registered: 0, arrived: 0 }),
    });
    renderApp("/registrations");
    const link = await main().findByRole("link", { name: "Check in attendees" });
    expect(link.getAttribute("href")).toBe(`/registrations/scan?event=${EVENT_ID}`);
    fireEvent.click(link);
    expect(await main().findByRole("heading", { level: 1, name: "Check in" })).toBeTruthy();
  });
});

describe("W-R17: no redirect loop", () => {
  it.each<[string, Me, string[]]>([
    ["/registrations/me", ANN, ["/registrations/me"]],
    ["/registrations/me", OLGA, ["/registrations/me", "/registrations"]],
    ["/registrations", OLGA, ["/registrations"]],
    ["/registrations", ANN, ["/registrations", "/registrations/me"]],
    ["/registrations?event=abc", ANN, ["/registrations?event=abc", "/registrations/me"]],
    ["/registrations/scan", OLGA, ["/registrations/scan"]],
    ["/registrations/scan", ANN, ["/registrations/scan", "/registrations/me"]],
  ])("%s as %o ends on the right screen after at most one redirect", async (path, me, trail) => {
    const seen: string[] = [];
    const fetch = mockFetch({ [ME]: () => json(200, me), [EVENTS]: noEvents, [LIST]: noRegistrations });
    renderWith(
      <>
        <App />
        <Recorder seen={seen} />
      </>,
      path,
    );
    const h1 =
      me.role === "user" ? "My registrations" : path === "/registrations/scan" ? "Check in" : "Registrations";
    expect(await main().findByRole("heading", { level: 1, name: h1 })).toBeTruthy();
    // Give a loop the chance to show itself.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(seen).toEqual(trail);
    // The redirect itself makes no request but me; the screen it lands on then makes its
    // own: the organizer screens read their events, the attendee list reads GET
    // /me/registrations (W-R41).
    expect(callsTo(fetch, ME)).toBe(1);
    await waitFor(() => expect(fetch.mock.calls).toHaveLength(2));
    expect(callsTo(fetch, me.role === "organizer" ? EVENTS : LIST)).toBe(1);
  });
});
