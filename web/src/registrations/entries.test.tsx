// Tests first (registration-web.md): W-R15, W-R16, W-R17, the two list routes and their
// redirects. Then the placeholders of the blocked lists (W-R18, W-R20).
import { useEffect } from "react";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useLocation } from "react-router";
import { App } from "../App";
import type { Me } from "../auth/api";
import { ANN, OLGA, callsTo, deferred, json, mockFetch, renderApp, renderWith } from "../auth/test-helpers";

afterEach(() => {
  vi.unstubAllGlobals();
});

const ME = "GET /auth/me";
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
  it("an attendee sees it; only the me request", async () => {
    const fetch = mockFetch({ [ME]: () => json(200, ANN) });
    renderApp("/registrations/me");
    expect(await main().findByRole("heading", { level: 1, name: "My registrations" })).toBeTruthy();
    expect(location()).toBe("/registrations/me");
    expect(fetch.mock.calls).toHaveLength(1);
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
    const fetch = mockFetch({ [ME]: () => json(200, OLGA) });
    renderApp("/registrations/me");
    await waitFor(() => expect(location()).toBe("/registrations"));
    expect(await main().findByRole("heading", { level: 1, name: "Registrations" })).toBeTruthy();
    expect(screen.queryByText(/This page is for/)).toBeNull();
    expect(fetch.mock.calls).toHaveLength(1);
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
    const fetch = mockFetch({ [ME]: () => json(200, OLGA) });
    renderApp("/registrations");
    expect(await main().findByRole("heading", { level: 1, name: "Registrations" })).toBeTruthy();
    expect(location()).toBe("/registrations");
    expect(fetch.mock.calls).toHaveLength(1);
  });

  it.each(["/registrations", "/registrations?event=abc"])(
    "an attendee on %s is redirected to /registrations/me, never the wrong-account message",
    async (path) => {
      const fetch = mockFetch({ [ME]: () => json(200, ANN) });
      renderApp(path);
      await waitFor(() => expect(location()).toBe("/registrations/me"));
      expect(await main().findByRole("heading", { level: 1, name: "My registrations" })).toBeTruthy();
      expect(screen.queryByText(/This page is for/)).toBeNull();
      expect(fetch.mock.calls).toHaveLength(1);
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
    mockFetch({ [ME]: () => me.promise });
    renderApp("/registrations");
    expect(main().getByRole("status").textContent).toBe("Loading...");
    expect(main().queryByRole("heading")).toBeNull();
    expect(location()).toBe("/registrations");
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
    });
    renderApp("/registrations");
    expect(await screen.findByText("Could not check your login")).toBeTruthy();
    expect(location()).toBe("/registrations");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await main().findByRole("heading", { level: 1, name: "Registrations" })).toBeTruthy();
    expect(callsTo(fetch, ME)).toBe(2);
  });
});

describe("W-R18 and W-R20: placeholders until the list routes exist", () => {
  it.each<[string, Me, string]>([
    ["/registrations/me", ANN, "My registrations"],
    ["/registrations/me?event=", ANN, "My registrations"],
    ["/registrations", OLGA, "Registrations"],
  ])("%s: the card with its h1, the placeholder text and no request", async (path, me, h1) => {
    const fetch = mockFetch({ [ME]: () => json(200, me) });
    renderApp(path);
    expect(await main().findByRole("heading", { level: 1, name: h1 })).toBeTruthy();
    expect(main().getByText("The list is not built yet.")).toBeTruthy();
    expect(fetch.mock.calls).toHaveLength(1);
  });

  // Blocked until the API has the attendee list route (registration-web.md question 1).
  it.todo("W-R18: one list request, one row per registration in the API order (question 1)");
  it.todo("W-R18: empty list shows You have no registrations yet. and Go home (question 1)");
  it.todo("W-R18: loading and error with Retry, Could not load your registrations (question 1)");
  it.todo("W-R19: registering invalidates the attendee list (question 1)");
  // Blocked until GET /events/{id}/registrations is built (checkin.md C15-C18, step 26;
  // registration-web.md question 2).
  it.todo(
    "W-R20: event selector and the table of the chosen event from GET /events/{id}/registrations (question 2)",
  );
  it.todo("W-R21: no events, nobody registered, loading, error, event not found (question 2)");
});

describe("W-R17: no redirect loop", () => {
  it.each<[string, Me, string[]]>([
    ["/registrations/me", ANN, ["/registrations/me"]],
    ["/registrations/me", OLGA, ["/registrations/me", "/registrations"]],
    ["/registrations", OLGA, ["/registrations"]],
    ["/registrations", ANN, ["/registrations", "/registrations/me"]],
    ["/registrations?event=abc", ANN, ["/registrations?event=abc", "/registrations/me"]],
  ])("%s as %o ends on the right screen after at most one redirect", async (path, me, trail) => {
    const seen: string[] = [];
    const fetch = mockFetch({ [ME]: () => json(200, me) });
    renderWith(
      <>
        <App />
        <Recorder seen={seen} />
      </>,
      path,
    );
    const h1 = me.role === "user" ? "My registrations" : "Registrations";
    expect(await main().findByRole("heading", { level: 1, name: h1 })).toBeTruthy();
    // Give a loop the chance to show itself.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(seen).toEqual(trail);
    expect(fetch.mock.calls).toHaveLength(1);
    expect(callsTo(fetch, ME)).toBe(1);
  });
});
