import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { publicListItem } from "../events/test-helpers";
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

describe("W-R14: registrations link per role", () => {
  it.each([
    [ANN, "My registrations", "/registrations/me", "My events"],
    [OLGA, "My events", "/organizer", "My registrations"],
  ])("logged in as %o: %s", async (me, text, href, other) => {
    mockFetch({
      "GET /auth/me": () => json(200, me),
      "GET /public/events": () => json(200, { events: [] }),
      "GET /events": () => json(200, { events: [] }),
    });
    renderApp(me.role === "user" ? "/" : "/organizer");
    expect((await header().findByRole("link", { name: text })).getAttribute("href")).toBe(href);
    expect(header().queryByRole("link", { name: other })).toBeNull();
  });

  it("logged out: no registrations link", async () => {
    mockFetch({
      "GET /auth/me": () => json(401, { error: "not_logged_in" }),
      "GET /public/events": () => json(200, { events: [] }),
    });
    renderApp("/");
    expect(await header().findByRole("link", { name: "Log in" })).toBeTruthy();
    expect(header().queryByRole("link", { name: /registrations/i })).toBeNull();
  });
});

describe("W-E22: organizer look on every screen", () => {
  // /event/1 is an unknown event: both views answer 404.
  const EVENT_ROUTES = {
    "GET /events/1": () => json(404, { error: "not_found" }),
    "GET /public/events/1": () => json(404, { error: "not_found" }),
  };

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

  // D64 replaces D62: the organizer logo opens / like for everyone.
  it.each(["/", "/event/1"])("organizer on %s: logo goes to / with the organizer icon", async (path) => {
    mockFetch({ "GET /auth/me": () => json(200, OLGA), ...EVENT_ROUTES });
    renderApp(path);
    expect(await header().findByText("Olga")).toBeTruthy();
    expect(header().getByText("Organizer")).toBeTruthy();
    expect(logo().getAttribute("href")).toBe("/");
    expect(logoIcon()).toBe("/icon-organizer.svg");
    expect(tabIcon()).toBe("/icon-organizer.svg");
  });

  it.each(["/", "/event/1"])("attendee on %s: logo goes to / with the attendee icon", async (path) => {
    mockFetch({ "GET /auth/me": () => json(200, ANN), ...EVENT_ROUTES });
    renderApp(path);
    expect(await header().findByText("Ann")).toBeTruthy();
    expect(logo().getAttribute("href")).toBe("/");
    expect(logoIcon()).toBe("/icon-attendee.svg");
    expect(tabIcon()).toBe("/icon-attendee.svg");
  });

  it.each(["/", "/event/1"])("logged out on %s: logo goes to / with the attendee icon", async (path) => {
    mockFetch({ "GET /auth/me": () => json(401, { error: "not_logged_in" }), ...EVENT_ROUTES });
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

// Tests first (header-events-link.md, D64): HB2, HB3, HB4, HB5. Then HB1, HB6, HB7, HB8, HB9.
const LOGO = "Event Registration";
// D64 removed the button: this text must not be anywhere in the app (HB4).
const REMOVED = "Watch all events";
const ME = "GET /auth/me";
const LIST = "GET /public/events";
const loggedOut = () => json(401, { error: "not_logged_in" });

// Every request the screens below may make; /event/1 is an unknown event.
const SCREENS = {
  [LIST]: () => json(200, { events: [] }),
  "GET /events": () => json(200, { events: [] }),
  "GET /events/1": () => json(404, { error: "not_found" }),
  "GET /public/events/1": () => json(404, { error: "not_found" }),
};

type State = "logged out" | "attendee" | "organizer";

const STATES: [State, () => Response][] = [
  ["logged out", loggedOut],
  ["attendee", () => json(200, ANN)],
  ["organizer", () => json(200, OLGA)],
];

function logoLink(): HTMLElement {
  return header().getByRole("link", { name: LOGO });
}

function currentLocation(): string | null {
  return screen.getByTestId("location").textContent;
}

// Waits until the header shows the answered me: the account name or the Log in link.
async function meShown(state: State) {
  if (state === "attendee") await header().findByText("Ann");
  else if (state === "organizer") await header().findByText("Olga");
  else await header().findByRole("link", { name: "Log in" });
}

describe("HB2: the logo always opens /", () => {
  it.each(STATES)("%s: href is / on / and on /event/1", async (state, me) => {
    for (const path of ["/", "/event/1"]) {
      mockFetch({ [ME]: me, ...SCREENS });
      const view = renderApp(path);
      await meShown(state);
      expect(logoLink().getAttribute("href")).toBe("/");
      view.unmount();
    }
  });

  it.each(["/organizer", "/organizer/events/new", "/registrations"])(
    "organizer on %s: href is /, not /organizer",
    async (path) => {
      mockFetch({ [ME]: () => json(200, OLGA), ...SCREENS });
      renderApp(path);
      await meShown("organizer");
      expect(logoLink().getAttribute("href")).toBe("/");
    },
  );
});

describe("HB3: shown at once, also while me is pending", () => {
  it("is shown with href / while me is pending, before any account link", () => {
    mockFetch({ [ME]: () => deferred<Response>().promise, ...SCREENS });
    renderApp("/event/1");
    expect(logoLink().getAttribute("href")).toBe("/");
    expect(header().queryByRole("link", { name: "Log in" })).toBeNull();
    expect(header().queryByRole("button", { name: "Log out" })).toBeNull();
  });

  it.each<[string, (me: ReturnType<typeof deferred<Response>>) => void]>([
    ["200 attendee", (me) => me.resolve(json(200, ANN))],
    ["200 organizer", (me) => me.resolve(json(200, OLGA))],
    ["401", (me) => me.resolve(loggedOut())],
    ["5xx", (me) => me.resolve(json(500, { error: "internal" }))],
    ["network error", (me) => me.reject(new TypeError("Failed to fetch"))],
  ])("stays the same element with href / after me answers %s", async (_case, settle) => {
    const me = deferred<Response>();
    mockFetch({ [ME]: () => me.promise, ...SCREENS });
    renderApp("/event/1");
    const before = logoLink();
    await act(async () => {
      settle(me);
    });
    await waitFor(() =>
      expect(
        header().queryByRole("link", { name: "Log in" }) ??
          header().queryByRole("button", { name: "Log out" }),
      ).toBeTruthy(),
    );
    expect(logoLink()).toBe(before);
    expect(logoLink().getAttribute("href")).toBe("/");
    expect(logoLink().getAttribute("aria-current")).toBeNull();
  });
});

describe("HB4: no Watch all events anywhere", () => {
  const LOGGED_OUT_ROUTES = [
    "/",
    "/login",
    "/signup",
    "/organizer/login",
    "/organizer/signup",
    "/event/1",
  ];
  const LOGGED_IN_ROUTES = ["/", "/event/1", "/registrations", "/registrations/me"];

  function expectNoRemovedText() {
    expect(screen.queryByRole("link", { name: REMOVED })).toBeNull();
    expect(screen.queryByRole("button", { name: REMOVED })).toBeNull();
    expect(screen.queryByText(REMOVED)).toBeNull();
    expect(document.querySelector(`[aria-label="${REMOVED}"], [title="${REMOVED}"]`)).toBeNull();
    expect(document.body.innerHTML).not.toContain(REMOVED);
  }

  it("while me is pending", () => {
    mockFetch({ [ME]: () => deferred<Response>().promise, ...SCREENS });
    renderApp("/");
    expectNoRemovedText();
  });

  it.each(LOGGED_OUT_ROUTES)("logged out on %s", async (path) => {
    mockFetch({ [ME]: loggedOut, ...SCREENS });
    renderApp(path);
    await meShown("logged out");
    expectNoRemovedText();
  });

  it.each(
    LOGGED_IN_ROUTES.flatMap((path) => [
      ["attendee", path] as const,
      ["organizer", path] as const,
    ]),
  )("%s on %s", async (state, path) => {
    const me = state === "attendee" ? ANN : OLGA;
    mockFetch({ [ME]: () => json(200, me), ...SCREENS });
    renderApp(path);
    await meShown(state);
    expectNoRemovedText();
  });

  it.each(["/organizer", "/organizer/events/new"])("organizer on %s", async (path) => {
    mockFetch({ [ME]: () => json(200, OLGA), ...SCREENS });
    renderApp(path);
    await meShown("organizer");
    expectNoRemovedText();
  });
});

describe("HB5: logo aria-current on / only (exact match)", () => {
  it.each(STATES)("%s on /: aria-current is page", async (state, me) => {
    mockFetch({ [ME]: me, ...SCREENS });
    renderApp("/");
    await meShown(state);
    expect(logoLink().getAttribute("aria-current")).toBe("page");
  });

  it("on / while me is pending: aria-current is page", () => {
    mockFetch({ [ME]: () => deferred<Response>().promise, ...SCREENS });
    renderApp("/");
    expect(logoLink().getAttribute("aria-current")).toBe("page");
  });

  it("ignores the query string and the hash", async () => {
    mockFetch({ [ME]: loggedOut, ...SCREENS });
    renderApp("/?from=mail#top");
    await meShown("logged out");
    expect(logoLink().getAttribute("aria-current")).toBe("page");
  });

  it.each(["/event/1", "/organizer", "/organizer/events/new", "/registrations"])(
    "organizer on %s: no aria-current",
    async (path) => {
      mockFetch({ [ME]: () => json(200, OLGA), ...SCREENS });
      renderApp(path);
      await meShown("organizer");
      expect(logoLink().getAttribute("aria-current")).toBeNull();
    },
  );

  it.each(["/event/1", "/login", "/signup", "/organizer/login"])(
    "logged out on %s: no aria-current",
    async (path) => {
      mockFetch({ [ME]: loggedOut, ...SCREENS });
      renderApp(path);
      await meShown("logged out");
      expect(logoLink().getAttribute("aria-current")).toBeNull();
    },
  );
});

describe("HB1: one logo link in the banner", () => {
  it("is one <a> named by its text, the icon has empty alt, and it makes no request", async () => {
    const fetch = mockFetch({ [ME]: loggedOut });
    renderApp("/login");
    await meShown("logged out");
    expect(header().getAllByRole("link", { name: LOGO })).toHaveLength(1);
    const link = logoLink();
    expect(link.tagName).toBe("A");
    expect(link.textContent).toBe(LOGO);
    expect(link.hasAttribute("aria-label")).toBe(false);
    expect(link.querySelector("img")?.getAttribute("alt")).toBe("");
    expect(link.closest("header")).toBe(screen.getByRole("banner"));
    expect(header().queryByRole("button", { name: LOGO })).toBeNull();
    expect(fetch.mock.calls).toHaveLength(1);
    expect(callsTo(fetch, ME)).toBe(1);
  });
});

describe("HB6: clicking the logo opens /", () => {
  it.each(STATES)("%s from /event/1: goes to / and stays, me is not refetched", async (state, me) => {
    const fetch = mockFetch({ [ME]: me, ...SCREENS });
    renderApp("/event/1");
    await meShown(state);
    fireEvent.click(logoLink());
    await waitFor(() => expect(currentLocation()).toBe("/"));
    expect(await screen.findByRole("heading", { level: 1, name: "Events" })).toBeTruthy();
    expect(currentLocation()).toBe("/");
    expect(logoLink().getAttribute("aria-current")).toBe("page");
    expect(callsTo(fetch, ME)).toBe(1);
  });

  it("on / already: stays on the page and makes no request", async () => {
    const fetch = mockFetch({ [ME]: loggedOut, ...SCREENS });
    renderApp("/");
    expect(await screen.findByRole("heading", { level: 1, name: "Events" })).toBeTruthy();
    const calls = fetch.mock.calls.length;
    fireEvent.click(logoLink());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(currentLocation()).toBe("/");
    expect(screen.getByRole("heading", { level: 1, name: "Events" })).toBeTruthy();
    expect(fetch.mock.calls).toHaveLength(calls);
  });
});

describe("HB7: log out, log in and the organizer list", () => {
  it("attendee log out: the same logo before and after", async () => {
    mockFetch({
      [ME]: () => json(200, ANN),
      "POST /auth/users/logout": () => json(204),
      ...SCREENS,
    });
    renderApp("/event/1");
    await meShown("attendee");
    const before = logoLink();
    fireEvent.click(header().getByRole("button", { name: "Log out" }));
    expect(await header().findByRole("link", { name: "Log in" })).toBeTruthy();
    expect(logoLink()).toBe(before);
    expect(logoLink().getAttribute("href")).toBe("/");
  });

  it("attendee log in: the same logo before and after", async () => {
    mockFetch({ [ME]: loggedOut, "POST /auth/users/login": () => json(200, ANN), ...SCREENS });
    renderApp("/login");
    await meShown("logged out");
    const before = logoLink();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ann@mail.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret-pass" } });
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    expect(await header().findByText("Ann")).toBeTruthy();
    expect(logoLink()).toBe(before);
    expect(logoLink().getAttribute("href")).toBe("/");
  });

  it("organizer from /organizer: stays on /, Loading... then the list, one list request", async () => {
    const list = deferred<Response>();
    const fetch = mockFetch({
      [ME]: () => json(200, OLGA),
      "GET /events": () => json(200, { events: [] }),
      [LIST]: () => list.promise,
    });
    renderApp("/organizer");
    expect(await screen.findByRole("heading", { level: 1, name: "Your events" })).toBeTruthy();
    fireEvent.click(logoLink());
    await waitFor(() => expect(currentLocation()).toBe("/"));
    expect(within(screen.getByRole("main")).getByRole("status").textContent).toBe("Loading...");
    await act(async () => {
      list.resolve(json(200, { events: [publicListItem()] }));
    });
    expect(await screen.findByRole("link", { name: "Spring meetup" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Events" })).toBeTruthy();
    expect(currentLocation()).toBe("/");
    expect(logoLink().getAttribute("href")).toBe("/");
    expect(logoLink().getAttribute("aria-current")).toBe("page");
    expect(callsTo(fetch, LIST)).toBe(1);
    expect(callsTo(fetch, ME)).toBe(1);

    // "My events" is still in the Main nav and opens /organizer.
    const myEvents = within(header().getByRole("navigation", { name: "Main" })).getByRole("link", {
      name: "My events",
    });
    expect(myEvents.getAttribute("href")).toBe("/organizer");
    fireEvent.click(myEvents);
    await waitFor(() => expect(currentLocation()).toBe("/organizer"));
    expect(await screen.findByRole("heading", { level: 1, name: "Your events" })).toBeTruthy();
  });
});

// The icons, the account block, the account links, Log in / Sign up / role switch and Log out
// are checked by W-E22, W-R14, W-A18 and W-A9 above; this adds the organizer screens.
describe("HB8: look kept, only the logo href changed", () => {
  it.each(["/organizer", "/organizer/events/new"])(
    "organizer on %s: organizer icon, Organizer, href /",
    async (path) => {
      mockFetch({ [ME]: () => json(200, OLGA), ...SCREENS });
      renderApp(path);
      await meShown("organizer");
      expect(logoLink().querySelector("img")?.getAttribute("src")).toBe("/icon-organizer.svg");
      expect(header().getByText("Organizer")).toBeTruthy();
      expect(logoLink().getAttribute("href")).toBe("/");
    },
  );
});

describe("HB9: accessibility", () => {
  // jsdom has no Tab key: the Tab order is the DOM order of the focusable elements,
  // none of them with a tabindex of its own.
  function tabOrder(): string[] {
    const banner = screen.getByRole("banner");
    return Array.from(banner.querySelectorAll<HTMLElement>("a[href], button")).map((element) => {
      expect(element.hasAttribute("tabindex")).toBe(false);
      return element.textContent ?? "";
    });
  }

  it("logged out: Tab order logo, then the account links", async () => {
    mockFetch({ [ME]: loggedOut, ...SCREENS });
    renderApp("/event/1");
    await meShown("logged out");
    expect(tabOrder()).toEqual([LOGO, "Log in", "Sign up", "For organizers"]);
  });

  // The account link texts belong to W-R14; only their place after the logo is checked here.
  it.each<[State, () => Response]>([
    ["attendee", () => json(200, ANN)],
    ["organizer", () => json(200, OLGA)],
  ])("%s: Tab order logo, the account link, then Log out", async (state, me) => {
    mockFetch({ [ME]: me, ...SCREENS });
    renderApp("/event/1");
    await meShown(state);
    const accountLinks = within(header().getByRole("navigation", { name: "Main" }))
      .getAllByRole("link")
      .map((link) => link.textContent ?? "");
    expect(accountLinks.length).toBeGreaterThan(0);
    expect(tabOrder()).toEqual([LOGO, ...accountLinks, "Log out"]);
  });

  // Enter on a focused <a href> follows it natively; jsdom does not, so the click stands in.
  it("the logo takes the focus and opens / when activated", async () => {
    mockFetch({ [ME]: loggedOut, ...SCREENS });
    renderApp("/event/1");
    await meShown("logged out");
    const link = logoLink();
    link.focus();
    expect(document.activeElement).toBe(link);
    fireEvent.click(link);
    await waitFor(() => expect(currentLocation()).toBe("/"));
  });
});
