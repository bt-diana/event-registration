import { act, screen } from "@testing-library/react";
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
    expect(screen.queryByText("Loading...")).toBeNull();
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
