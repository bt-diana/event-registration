import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router";
import { RequireRole } from "./guards";
import {
  ANN,
  OLGA,
  callsTo,
  deferred,
  json,
  mockFetch,
  renderApp,
  renderWith,
} from "./test-helpers";

afterEach(() => {
  vi.unstubAllGlobals();
});

function location(): string | null {
  return screen.getByTestId("location").textContent;
}

// An attendee-only screen, as later screens (tickets) will use it.
function AttendeeOnly() {
  return (
    <Routes>
      <Route
        path="/tickets"
        element={
          <RequireRole role="user">
            <h1>My tickets</h1>
          </RequireRole>
        }
      />
    </Routes>
  );
}

describe("W-A2: loading status while me is pending", () => {
  const paths = ["/organizer", "/login", "/signup", "/organizer/login", "/organizer/signup"];

  it.each(paths)("%s shows only Loading..., no form and no redirect", async (path) => {
    const me = deferred<Response>();
    mockFetch({ "GET /auth/me": () => me.promise });
    renderApp(path);

    expect(screen.getByRole("status").textContent).toBe("Loading...");
    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.queryByText(/This page is for/)).toBeNull();
    expect(location()).toBe(path);

    await act(async () => me.resolve(json(401, { error: "not_logged_in" })));
    await waitFor(() => expect(screen.queryByText("Loading...")).toBeNull());
  });

  it("shows the form only once me answers 401", async () => {
    const me = deferred<Response>();
    mockFetch({ "GET /auth/me": () => me.promise });
    renderApp("/login");
    expect(screen.queryByLabelText("Email")).toBeNull();
    await act(async () => me.resolve(json(401, { error: "not_logged_in" })));
    expect(await screen.findByLabelText("Email")).toBeTruthy();
  });

  it("does not flash the login page for a logged-in organizer", async () => {
    const me = deferred<Response>();
    mockFetch({ "GET /auth/me": () => me.promise });
    renderApp("/organizer");
    expect(screen.queryByLabelText("Email")).toBeNull();
    await act(async () => me.resolve(json(200, OLGA)));
    expect(await screen.findByRole("heading", { level: 1, name: "Organizer home" })).toBeTruthy();
    expect(location()).toBe("/organizer");
  });
});

describe("W-A6: wrong-role message", () => {
  it("an attendee on an organizer screen sees the message, no redirect", async () => {
    const fetch = mockFetch({ "GET /auth/me": () => json(200, ANN) });
    renderApp("/organizer");

    expect(
      await screen.findByText("This page is for organizers. You are logged in as ann@mail.com."),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Log in as an organizer" }).getAttribute("href"),
    ).toBe("/organizer/login");
    expect(screen.getByRole("link", { name: "Go home" }).getAttribute("href")).toBe("/");
    expect(screen.queryByRole("heading", { level: 1, name: "Organizer home" })).toBeNull();
    expect(location()).toBe("/organizer");
    expect(callsTo(fetch, "GET /auth/me")).toBe(1);
  });

  it("an organizer on an attendee-only screen sees the message, no redirect", async () => {
    const fetch = mockFetch({ "GET /auth/me": () => json(200, OLGA) });
    renderWith(<AttendeeOnly />, "/tickets");

    expect(
      await screen.findByText("This page is for attendees. You are logged in as olga@mail.com."),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Log in as an attendee" }).getAttribute("href"),
    ).toBe("/login");
    expect(screen.getByRole("link", { name: "Go home" }).getAttribute("href")).toBe("/organizer");
    expect(screen.queryByText("My tickets")).toBeNull();
    expect(location()).toBe("/tickets");
    expect(callsTo(fetch, "GET /auth/me")).toBe(1);
  });
});

describe("W-A3: me fails", () => {
  it.each([
    ["a 5xx", () => json(500, { error: "internal" })],
    [
      "a network error",
      () => {
        throw new TypeError("Failed to fetch");
      },
    ],
  ])("shows Could not check your login with Retry on %s", async (_label, failure) => {
    let first = true;
    const fetch = mockFetch({
      "GET /auth/me": () => {
        if (first) {
          first = false;
          return failure();
        }
        return json(401, { error: "not_logged_in" });
      },
    });
    renderApp("/organizer/login");

    expect(await screen.findByText("Could not check your login")).toBeTruthy();
    expect(screen.queryByLabelText("Email")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByLabelText("Email")).toBeTruthy();
    expect(callsTo(fetch, "GET /auth/me")).toBe(2);
  });

  it("does not redirect a guarded screen to the login page on error", async () => {
    mockFetch({ "GET /auth/me": () => json(503) });
    renderApp("/organizer");
    expect(await screen.findByText("Could not check your login")).toBeTruthy();
    expect(location()).toBe("/organizer");
  });
});

describe("W-A4: logged out on a guarded screen", () => {
  it("redirects to the organizer login with the path and query in next", async () => {
    mockFetch({ "GET /auth/me": () => json(401, { error: "not_logged_in" }) });
    renderApp("/organizer?tab=2");
    expect(await screen.findByLabelText("Email")).toBeTruthy();
    expect(location()).toBe(`/organizer/login?next=${encodeURIComponent("/organizer?tab=2")}`);
    expect(screen.getByText("Organizer")).toBeTruthy();
  });

  it("redirects to the attendee login for an attendee screen", async () => {
    mockFetch({ "GET /auth/me": () => json(401, { error: "not_logged_in" }) });
    renderWith(<AttendeeOnly />, "/tickets");
    await waitFor(() => expect(location()).toBe("/login?next=%2Ftickets"));
  });

  it("comes back to next after login (W-A5)", async () => {
    mockFetch({
      "GET /auth/me": () => json(401, { error: "not_logged_in" }),
      "POST /auth/organizers/login": () => json(200, OLGA),
    });
    renderApp("/organizer?tab=2");
    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "olga@mail.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "whatever" } });
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Organizer home" })).toBeTruthy();
    expect(location()).toBe("/organizer?tab=2");
  });
});

describe("W-A5 and W-A7: auth pages for a logged-in person", () => {
  it.each([
    ["/login", ANN, "/"],
    ["/signup", ANN, "/"],
    ["/organizer/login", OLGA, "/organizer"],
    ["/organizer/signup", OLGA, "/organizer"],
    ["/login?next=%2Ftickets%3Fx%3D1", ANN, "/tickets?x=1"],
    ["/login?next=%2F%2Fevil.com", ANN, "/"],
    ["/login?next=https%3A%2F%2Fevil.com", ANN, "/"],
    ["/organizer/login?next=%2F%5Cevil.com", OLGA, "/organizer"],
  ])("%s redirects a logged-in %s to the safe next or home", async (path, me, target) => {
    mockFetch({ "GET /auth/me": () => json(200, me) });
    renderApp(path);
    await waitFor(() => expect(location()).toBe(target));
    expect(screen.queryByLabelText("Password")).toBeNull();
  });

  it.each([
    ["/login", OLGA],
    ["/signup", OLGA],
    ["/organizer/login", ANN],
    ["/organizer/signup", ANN],
  ])("%s shows the form to a person of the other role", async (path, me) => {
    mockFetch({ "GET /auth/me": () => json(200, me) });
    renderApp(path);
    expect(await screen.findByLabelText("Email")).toBeTruthy();
    expect(location()).toBe(path);
  });

  it("logging in as the other role replaces the session and goes home", async () => {
    mockFetch({
      "GET /auth/me": () => json(200, ANN),
      "POST /auth/organizers/login": () => json(200, OLGA),
    });
    renderApp("/organizer/login");
    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "olga@mail.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "whatever" } });
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    await waitFor(() => expect(location()).toBe("/organizer"));
    expect(screen.getByText("Olga")).toBeTruthy();
  });
});
