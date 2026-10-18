import { screen, within } from "@testing-library/react";
import { ANN, OLGA, json, mockFetch, renderApp } from "./auth/test-helpers";

afterEach(() => {
  vi.unstubAllGlobals();
});

function loggedOut() {
  mockFetch({ "GET /auth/me": () => json(401, { error: "not_logged_in" }) });
}

describe("App", () => {
  it("shows the logged-out header with its links", async () => {
    loggedOut();
    renderApp("/");
    expect(screen.getByRole("link", { name: "Event Registration" })).toBeTruthy();
    expect((await screen.findByRole("link", { name: "Log in" })).getAttribute("href")).toBe(
      "/login",
    );
    expect(screen.getByRole("link", { name: "Sign up" }).getAttribute("href")).toBe("/signup");
    expect(screen.getByRole("link", { name: "For organizers" }).getAttribute("href")).toBe(
      "/organizer/login",
    );
  });

  it("shows the public events list at /", async () => {
    mockFetch({
      "GET /auth/me": () => json(401, { error: "not_logged_in" }),
      "GET /public/events": () => json(200, { events: [] }),
    });
    renderApp("/");
    expect(await screen.findByRole("heading", { level: 1, name: "Events" })).toBeTruthy();
  });

  it("shows the events list at /organizer to an organizer", async () => {
    mockFetch({
      "GET /auth/me": () => json(200, OLGA),
      "GET /events": () => json(200, { events: [] }),
    });
    renderApp("/organizer");
    expect(await screen.findByRole("heading", { level: 1, name: "Your events" })).toBeTruthy();
  });

  it("shows the attendee login page at /login", async () => {
    loggedOut();
    renderApp("/login");
    expect(await screen.findByRole("heading", { level: 1, name: "Log in" })).toBeTruthy();
    expect(screen.getByText("Use the email you registered with.")).toBeTruthy();
    expect(screen.getByText("Attendee")).toBeTruthy();
    expect(screen.getByLabelText("Email").getAttribute("type")).toBe("email");
    expect(screen.getByLabelText("Email").getAttribute("autocomplete")).toBe("email");
    expect(screen.queryByLabelText("Name")).toBeNull();
    expect(screen.getByLabelText("Password").getAttribute("autocomplete")).toBe(
      "current-password",
    );
  });

  it("shows the attendee sign-up page at /signup", async () => {
    loggedOut();
    renderApp("/signup");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Create your account" }),
    ).toBeTruthy();
    expect(screen.getByText("Register for events and keep your tickets in one place.")).toBeTruthy();
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getByLabelText("Name").getAttribute("autocomplete")).toBe("name");
    expect(screen.getByLabelText("Password").getAttribute("autocomplete")).toBe("new-password");
    expect(screen.getByText("8 to 128 characters")).toBeTruthy();
  });

  it("shows the organizer login page at /organizer/login", async () => {
    loggedOut();
    renderApp("/organizer/login");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Organizer log in" }),
    ).toBeTruthy();
    expect(screen.getByText("Manage your events and check people in.")).toBeTruthy();
    expect(screen.getByText("No organizer account?", { exact: false })).toBeTruthy();
    expect(
      within(screen.getByRole("main")).getByRole("link", { name: "Sign up" }).getAttribute("href"),
    ).toBe("/organizer/signup");
    expect(screen.getByText("Organizer")).toBeTruthy();
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
  });

  it("shows the organizer sign-up page at /organizer/signup", async () => {
    loggedOut();
    renderApp("/organizer/signup");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Create an organizer account" }),
    ).toBeTruthy();
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getByLabelText("Name")).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
  });
});

describe("design-alignment.md DA47: no back link on top-level and auth screens", () => {
  function backLinks() {
    return within(screen.getByRole("main")).queryAllByRole("link", { name: /^Back to/ });
  }

  it.each(["/", "/login", "/signup", "/organizer/login", "/organizer/signup"])(
    "%s, logged out",
    async (path) => {
      mockFetch({
        "GET /auth/me": () => json(401, { error: "not_logged_in" }),
        "GET /public/events": () => json(200, { events: [] }),
      });
      renderApp(path);
      await screen.findByRole("heading", { level: 1 });
      expect(backLinks()).toHaveLength(0);
    },
  );

  it("/organizer for an organizer", async () => {
    mockFetch({
      "GET /auth/me": () => json(200, OLGA),
      "GET /events": () => json(200, { events: [] }),
    });
    renderApp("/organizer");
    await screen.findByRole("heading", { level: 1, name: "Your events" });
    expect(backLinks()).toHaveLength(0);
  });

  it("the wrong-account card", async () => {
    mockFetch({ "GET /auth/me": () => json(200, ANN) });
    renderApp("/organizer");
    await screen.findByRole("heading", { level: 1, name: "Switch account" });
    expect(backLinks()).toHaveLength(0);
  });

  it("Could not check your login", async () => {
    mockFetch({ "GET /auth/me": () => json(500, { error: "internal" }) });
    renderApp("/organizer");
    await screen.findByRole("heading", { level: 1, name: "Could not check your login" });
    expect(backLinks()).toHaveLength(0);
  });
});
