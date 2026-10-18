import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { ANN, OLGA, callsTo, deferred, json, mockFetch, renderApp } from "./test-helpers";

afterEach(() => {
  vi.unstubAllGlobals();
});

function header() {
  return within(screen.getByRole("banner"));
}

function hrefOf(name: string): string | null {
  return header().getByRole("link", { name }).getAttribute("href");
}

describe("W-A18: header", () => {
  it.each(["/", "/login", "/signup"])("logged out on %s: Log in, Sign up, For organizers", async (path) => {
    mockFetch({ "GET /auth/me": () => json(401, { error: "not_logged_in" }) });
    renderApp(path);
    expect(await header().findByRole("link", { name: "Log in" })).toBeTruthy();
    expect(hrefOf("Log in")).toBe("/login");
    expect(hrefOf("Sign up")).toBe("/signup");
    expect(hrefOf("For organizers")).toBe("/organizer/login");
    expect(header().queryByRole("link", { name: "For attendees" })).toBeNull();
  });

  it.each(["/organizer/login", "/organizer/signup"])(
    "logged out on %s: the role link reads For attendees and goes to /login",
    async (path) => {
      mockFetch({ "GET /auth/me": () => json(401, { error: "not_logged_in" }) });
      renderApp(path);
      expect(await header().findByRole("link", { name: "For attendees" })).toBeTruthy();
      expect(hrefOf("For attendees")).toBe("/login");
      expect(header().queryByRole("link", { name: "For organizers" })).toBeNull();
    },
  );

  it("shows no account links while me is loading", () => {
    mockFetch({ "GET /auth/me": () => deferred<Response>().promise });
    renderApp("/");
    expect(header().getByRole("link", { name: "Event Registration" })).toBeTruthy();
    expect(header().queryByRole("link", { name: "Log in" })).toBeNull();
    expect(header().queryByRole("button", { name: "Log out" })).toBeNull();
  });

  it.each([
    [ANN, "Attendee"],
    [OLGA, "Organizer"],
  ])("logged in as %o: name, role and Log out", async (me, roleName) => {
    mockFetch({ "GET /auth/me": () => json(200, me) });
    renderApp("/");
    expect(await header().findByText(me.name)).toBeTruthy();
    expect(header().getByText(roleName)).toBeTruthy();
    expect(header().getByRole("button", { name: "Log out" })).toBeTruthy();
    expect(header().queryByRole("link", { name: "Log in" })).toBeNull();
  });
});

describe("W-E22: organizer look on every screen", () => {
  function logo() {
    return header().getByRole("link", { name: "Event Registration" });
  }

  function logoIcon(): string | null {
    return logo().querySelector("img")?.getAttribute("src") ?? null;
  }

  function tabIcon(): string | null {
    return document.querySelector('link[rel="icon"]')?.getAttribute("href") ?? null;
  }

  beforeEach(() => {
    const link = document.createElement("link");
    link.rel = "icon";
    link.href = "/icon-attendee.svg";
    document.head.appendChild(link);
  });

  afterEach(() => {
    document.head.querySelectorAll('link[rel="icon"]').forEach((link) => link.remove());
  });

  it.each(["/", "/event/1"])("organizer on %s: logo goes to /organizer with the organizer icon", async (path) => {
    mockFetch({ "GET /auth/me": () => json(200, OLGA) });
    renderApp(path);
    expect(await header().findByText("Olga")).toBeTruthy();
    expect(header().getByText("Organizer")).toBeTruthy();
    expect(logo().getAttribute("href")).toBe("/organizer");
    expect(logoIcon()).toBe("/icon-organizer.svg");
    expect(tabIcon()).toBe("/icon-organizer.svg");
  });

  it.each(["/", "/event/1"])("attendee on %s: logo goes to / with the attendee icon", async (path) => {
    mockFetch({ "GET /auth/me": () => json(200, ANN) });
    renderApp(path);
    expect(await header().findByText("Ann")).toBeTruthy();
    expect(logo().getAttribute("href")).toBe("/");
    expect(logoIcon()).toBe("/icon-attendee.svg");
    expect(tabIcon()).toBe("/icon-attendee.svg");
  });

  it.each(["/", "/event/1"])("logged out on %s: logo goes to / with the attendee icon", async (path) => {
    mockFetch({ "GET /auth/me": () => json(401, { error: "not_logged_in" }) });
    renderApp(path);
    expect(await header().findByRole("link", { name: "Log in" })).toBeTruthy();
    expect(logo().getAttribute("href")).toBe("/");
    expect(logoIcon()).toBe("/icon-attendee.svg");
    expect(tabIcon()).toBe("/icon-attendee.svg");
  });
});

describe("W-A9: log out", () => {
  it("attendee: POST /auth/users/logout, me set to logged out, other queries removed", async () => {
    const fetch = mockFetch({
      "GET /auth/me": () => json(200, ANN),
      "POST /auth/users/logout": () => json(204),
    });
    const { queryClient } = renderApp("/");
    queryClient.setQueryData(["events"], [{ id: "e1" }]);
    fireEvent.click(await header().findByRole("button", { name: "Log out" }));

    expect(await header().findByRole("link", { name: "Log in" })).toBeTruthy();
    expect(queryClient.getQueryData(["me"])).toBeNull();
    expect(queryClient.getQueryCache().find({ queryKey: ["events"] })).toBeUndefined();
    expect(callsTo(fetch, "POST /auth/users/logout")).toBe(1);
    expect(callsTo(fetch, "GET /auth/me")).toBe(1);
  });

  it("organizer: POST /auth/organizers/logout, then the guard sends to the login page", async () => {
    const fetch = mockFetch({
      "GET /auth/me": () => json(200, OLGA),
      "POST /auth/organizers/logout": () => json(204),
      "GET /events": () => json(200, { events: [] }),
    });
    renderApp("/organizer");
    fireEvent.click(await header().findByRole("button", { name: "Log out" }));
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe("/organizer/login?next=%2Forganizer"),
    );
    expect(callsTo(fetch, "POST /auth/organizers/logout")).toBe(1);
    expect(callsTo(fetch, "GET /auth/me")).toBe(1);
  });

  it("shows Logging out... while pending and sends once (W-A12)", async () => {
    const answer = deferred<Response>();
    const fetch = mockFetch({
      "GET /auth/me": () => json(200, ANN),
      "POST /auth/users/logout": () => answer.promise,
    });
    renderApp("/");
    fireEvent.click(await header().findByRole("button", { name: "Log out" }));
    const button = (await header().findByRole("button", {
      name: "Logging out...",
    })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(callsTo(fetch, "POST /auth/users/logout")).toBe(1);
    answer.resolve(json(204));
    expect(await header().findByRole("link", { name: "Log in" })).toBeTruthy();
  });

  it("a network failure keeps the person logged in with a message", async () => {
    mockFetch({
      "GET /auth/me": () => json(200, ANN),
      "POST /auth/users/logout": () => {
        throw new TypeError("Failed to fetch");
      },
    });
    const { queryClient } = renderApp("/");
    fireEvent.click(await header().findByRole("button", { name: "Log out" }));
    const alert = await header().findByText("Could not log out. Try again.");
    expect(alert.getAttribute("role")).toBe("alert");
    expect(header().getByText("Ann")).toBeTruthy();
    expect(header().getByRole("button", { name: "Log out" })).toBeTruthy();
    expect(queryClient.getQueryData(["me"])).toEqual(ANN);
  });
});
