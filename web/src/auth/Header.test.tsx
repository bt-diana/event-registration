import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useNavigate } from "react-router";
import { App } from "../App";
import { publicListItem } from "../events/test-helpers";
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
  // none of them with a tabindex of its own. The icon-only Menu button counts by its aria-label.
  function tabOrder(): string[] {
    const banner = screen.getByRole("banner");
    return Array.from(banner.querySelectorAll<HTMLElement>("a[href], button")).map((element) => {
      expect(element.hasAttribute("tabindex")).toBe(false);
      return element.getAttribute("aria-label") ?? element.textContent ?? "";
    });
  }

  it("logged out: Tab order logo, Menu, then the account links", async () => {
    mockFetch({ [ME]: loggedOut, ...SCREENS });
    renderApp("/event/1");
    await meShown("logged out");
    expect(tabOrder()).toEqual([LOGO, "Menu", "Log in", "Sign up", "For organizers"]);
  });

  // The account link texts belong to W-R14; only their place after the logo is checked here.
  it.each<[State, () => Response]>([
    ["attendee", () => json(200, ANN)],
    ["organizer", () => json(200, OLGA)],
  ])("%s: Tab order logo, Menu, the account link, then Log out", async (state, me) => {
    mockFetch({ [ME]: me, ...SCREENS });
    renderApp("/event/1");
    await meShown(state);
    const accountLinks = within(header().getByRole("navigation", { name: "Main" }))
      .getAllByRole("link")
      .map((link) => link.textContent ?? "");
    expect(accountLinks.length).toBeGreaterThan(0);
    expect(tabOrder()).toEqual([LOGO, "Menu", ...accountLinks, "Log out"]);
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

// Tests first (header-responsive.md, D65): HR1, HR2, HR3, HR4, HR6. Then HR5.
const ROLE_LABEL: Record<"attendee" | "organizer", string> = {
  attendee: "Attendee",
  organizer: "Organizer",
};
const LOGGED_IN: ["attendee" | "organizer", () => Response][] = [
  ["attendee", () => json(200, ANN)],
  ["organizer", () => json(200, OLGA)],
];

// The account block of a logged-in person: the parent of the Main nav.
function accountBlock(): HTMLElement {
  const block = header().getByRole("navigation", { name: "Main" }).parentElement;
  if (!block) throw new Error("no account block");
  return block;
}

function accountInfo(): HTMLElement {
  const info = accountBlock().querySelector<HTMLElement>(":scope > .account-info");
  if (!info) throw new Error("no .account-info");
  return info;
}

// The DOM order of the focusable elements; the icon-only Menu button counts by its aria-label.
function focusables(): string[] {
  return Array.from(
    screen.getByRole("banner").querySelectorAll<HTMLElement>("a[href], button"),
  ).map((element) => element.getAttribute("aria-label") ?? element.textContent ?? "");
}

// D66: the burger and the panel it controls (header-responsive.md HR6, HR11-HR17).
// Open and closed are read from aria-expanded and data-open, never from visibility
// (jsdom does not read styles.css).
function menuButton(): HTMLElement {
  return header().getByRole("button", { name: "Menu" });
}

function panel(): HTMLElement {
  const id = menuButton().getAttribute("aria-controls");
  if (!id) throw new Error("the Menu button has no aria-controls");
  const element = document.getElementById(id);
  if (!element) throw new Error(`no element with the id ${id}`);
  return element;
}

function expectMenu(open: boolean) {
  expect(menuButton().getAttribute("aria-expanded")).toBe(String(open));
  expect(panel().getAttribute("data-open")).toBe(String(open));
}

function openMenu() {
  fireEvent.click(menuButton());
  expectMenu(true);
}

describe("HR1: account block order: nav link, account info, Log out", () => {
  it.each(LOGGED_IN)("%s: DOM order and Tab order", async (state, me) => {
    mockFetch({ [ME]: me, ...SCREENS });
    renderApp("/event/1");
    await meShown(state);
    const children = Array.from(accountBlock().children);
    expect(children).toHaveLength(3);
    expect(children[0]).toBe(header().getByRole("navigation", { name: "Main" }));
    expect(children[1].classList.contains("account-info")).toBe(true);
    expect(children[2]).toBe(header().getByRole("button", { name: "Log out" }));
    expect(panel().contains(accountBlock())).toBe(true);
    const link = within(header().getByRole("navigation", { name: "Main" })).getByRole("link");
    expect(focusables()).toEqual([LOGO, "Menu", link.textContent, "Log out"]);
  });
});

describe("HR2: name and role are the only children of .account-info", () => {
  it.each(LOGGED_IN)("%s: name first, then the role label", async (state, me) => {
    mockFetch({ [ME]: me, ...SCREENS });
    renderApp("/event/1");
    await meShown(state);
    const children = Array.from(accountInfo().children);
    expect(children).toHaveLength(2);
    const [name, role] = children;
    expect(name.textContent).toBe(state === "attendee" ? ANN.name : OLGA.name);
    expect(role.textContent).toBe(ROLE_LABEL[state]);
    expect(accountInfo().textContent).toBe(name.textContent + ROLE_LABEL[state]);
    expect(["A", "BUTTON"]).not.toContain(role.tagName);
    expect(role.getAttribute("role")).toBeNull();
    expect(within(accountInfo()).queryByRole("link")).toBeNull();
    expect(within(accountInfo()).queryByRole("button")).toBeNull();
  });
});

describe("HR3: the full name in the text and in title", () => {
  const LONG_NAME = `${"Alexandra ".repeat(7)}Konstantin`;
  const LONG_WORD = "Konstantinopoulou".repeat(3).slice(0, 40);

  it.each([
    ["80 characters", LONG_NAME],
    ["one word of 40 characters", LONG_WORD],
    ["a short name", "Ann"],
  ])("%s", async (_case, name) => {
    mockFetch({ [ME]: () => json(200, { ...ANN, name }), ...SCREENS });
    renderApp("/event/1");
    await header().findByRole("button", { name: "Log out" });
    const nameElement = accountInfo().children[0];
    expect(nameElement.getAttribute("title")).toBe(name);
    expect(nameElement.textContent).toBe(name);
  });

  it("with the panel open: the same full name and title", async () => {
    mockFetch({ [ME]: () => json(200, { ...ANN, name: LONG_NAME }), ...SCREENS });
    renderApp("/event/1");
    await header().findByRole("button", { name: "Log out" });
    openMenu();
    const nameElement = accountInfo().children[0];
    expect(panel().contains(nameElement)).toBe(true);
    expect(nameElement.getAttribute("title")).toBe(LONG_NAME);
    expect(nameElement.textContent).toBe(LONG_NAME);
  });

  it("the test names have the lengths of the spec", () => {
    expect(LONG_NAME).toHaveLength(80);
    expect(LONG_WORD).toHaveLength(40);
    expect(LONG_WORD).not.toContain(" ");
  });
});

describe("HR4: the log-out error after Log out, outside .account-info", () => {
  it("failed log out: the alert follows the button and is not in .account-info", async () => {
    mockFetch({
      [ME]: () => json(200, ANN),
      "POST /auth/users/logout": () => {
        throw new TypeError("Failed to fetch");
      },
    });
    renderApp("/");
    fireEvent.click(await header().findByRole("button", { name: "Log out" }));
    const alert = await header().findByRole("alert");
    expect(alert.textContent).toBe("Could not log out. Try again.");
    const button = header().getByRole("button", { name: "Log out" });
    expect(button.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(accountInfo().contains(alert)).toBe(false);
    expect(alert.closest(".account-info")).toBeNull();
    expect(accountInfo().children[0].textContent).toBe("Ann");
  });

  it("with the panel open: the alert follows the button, in the panel, outside .account-info", async () => {
    mockFetch({
      [ME]: () => json(200, ANN),
      "POST /auth/users/logout": () => {
        throw new TypeError("Failed to fetch");
      },
    });
    renderApp("/");
    await header().findByRole("button", { name: "Log out" });
    openMenu();
    fireEvent.click(header().getByRole("button", { name: "Log out" }));
    const alert = await header().findByRole("alert");
    const button = header().getByRole("button", { name: "Log out" });
    expect(button.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(alert.closest(".account-info")).toBeNull();
    expect(panel().contains(alert)).toBe(true);
  });

  it("pending log out: Logging out..., disabled, still after .account-info", async () => {
    const answer = deferred<Response>();
    mockFetch({ [ME]: () => json(200, ANN), "POST /auth/users/logout": () => answer.promise });
    renderApp("/");
    fireEvent.click(await header().findByRole("button", { name: "Log out" }));
    const button = (await header().findByRole("button", {
      name: "Logging out...",
    })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(accountBlock().children[2]).toBe(button);
    expect(accountInfo().children[0].textContent).toBe("Ann");
    await act(async () => {
      answer.resolve(json(204));
    });
    expect(await header().findByRole("link", { name: "Log in" })).toBeTruthy();
  });
});

// Tests first (header-responsive.md, D66): HR6, HR11-HR17 and the Menu button in HR1 and HB9.
describe("HR6: the Menu button", () => {
  type MeCase = [string, () => Response | Promise<Response>, string[], string | null];
  const CASES: MeCase[] = [
    ["pending", () => deferred<Response>().promise, [], null],
    ["logged out", loggedOut, ["Menu"], "Account"],
    ["5xx", () => json(500, { error: "internal" }), ["Menu"], "Account"],
    [
      "network error",
      () => {
        throw new TypeError("Failed to fetch");
      },
      ["Menu"],
      "Account",
    ],
    ["attendee", () => json(200, ANN), ["Menu", "Log out"], "Main"],
    ["organizer", () => json(200, OLGA), ["Menu", "Log out"], "Main"],
  ];

  async function settled(state: string) {
    if (state === "attendee") await meShown("attendee");
    else if (state === "organizer") await meShown("organizer");
    else if (state !== "pending") await meShown("logged out");
  }

  it.each(CASES)("%s: buttons and landmarks", async (state, me, buttons, nav) => {
    mockFetch({ [ME]: me, ...SCREENS });
    renderApp("/event/1");
    await settled(state);
    expect(screen.getAllByRole("banner")).toHaveLength(1);
    expect(
      header()
        .queryAllByRole("button")
        .map((button) => button.getAttribute("aria-label") ?? button.textContent),
    ).toEqual(buttons);
    expect(screen.getByRole("banner").querySelectorAll("button")).toHaveLength(buttons.length);
    const navs = header().queryAllByRole("navigation");
    expect(navs.map((element) => element.getAttribute("aria-label"))).toEqual(nav ? [nav] : []);
    expect(logoLink().getAttribute("href")).toBe("/");
    if (state === "pending") {
      expect(header().queryByRole("button", { name: "Menu" })).toBeNull();
      expect(document.querySelector("[aria-expanded]")).toBeNull();
    }
  });

  it.each(CASES.filter(([state]) => state !== "pending"))(
    "%s: one icon-only <button type=button> named Menu, right after the logo",
    async (state, me) => {
      mockFetch({ [ME]: me, ...SCREENS });
      renderApp("/event/1");
      await settled(state);
      expect(header().getAllByRole("button", { name: "Menu" })).toHaveLength(1);
      const button = menuButton();
      expect(button.tagName).toBe("BUTTON");
      expect(button.getAttribute("type")).toBe("button");
      expect(button.getAttribute("aria-label")).toBe("Menu");
      expect(button.textContent).toBe("");
      const icon = button.querySelector("svg");
      expect(icon?.getAttribute("aria-hidden")).toBe("true");
      expect(logoLink().nextElementSibling).toBe(button);
    },
  );

  it("keeps the name Menu open and closed", async () => {
    mockFetch({ [ME]: () => json(200, ANN), ...SCREENS });
    renderApp("/event/1");
    await meShown("attendee");
    const button = menuButton();
    fireEvent.click(button);
    expect(menuButton()).toBe(button);
    expect(button.getAttribute("aria-label")).toBe("Menu");
    fireEvent.click(button);
    expect(button.getAttribute("aria-label")).toBe("Menu");
  });
});

describe("HR11: closed by default", () => {
  it.each(STATES)("%s: aria-expanded false and data-open false", async (state, me) => {
    mockFetch({ [ME]: me, ...SCREENS });
    renderApp("/event/1");
    await meShown(state);
    expectMenu(false);
  });

  it("5xx: closed by default", async () => {
    mockFetch({ [ME]: () => json(500, { error: "internal" }), ...SCREENS });
    renderApp("/event/1");
    await meShown("logged out");
    expectMenu(false);
  });
});

describe("HR12: aria-controls points to the panel", () => {
  it.each<[State, () => Response, string]>([
    ["logged out", loggedOut, "Account"],
    ["attendee", () => json(200, ANN), "Main"],
    ["organizer", () => json(200, OLGA), "Main"],
  ])("%s: one element with that id, in the banner, holding the nav", async (state, me, nav) => {
    mockFetch({ [ME]: me, ...SCREENS });
    renderApp("/event/1");
    await meShown(state);
    const id = menuButton().getAttribute("aria-controls");
    expect(id).toBeTruthy();
    expect(document.querySelectorAll(`[id="${id}"]`)).toHaveLength(1);
    expect(screen.getByRole("banner").contains(panel())).toBe(true);
    expect(panel()).not.toBe(menuButton());
    expect(panel().contains(header().getByRole("navigation", { name: nav }))).toBe(true);
  });
});

describe("HR13: a click toggles the menu", () => {
  it.each(STATES)("%s: open, closed, three times", async (state, me) => {
    mockFetch({ [ME]: me, ...SCREENS });
    renderApp("/event/1");
    await meShown(state);
    for (let cycle = 0; cycle < 3; cycle += 1) {
      fireEvent.click(menuButton());
      expectMenu(true);
      fireEvent.click(menuButton());
      expectMenu(false);
    }
  });
});

describe("HR14: what is in the panel", () => {
  // Outside the panel the banner has only the logo and the Menu button.
  function expectOnlyLogoAndMenuOutside() {
    const banner = screen.getByRole("banner");
    expect(Array.from(banner.children)).toEqual([logoLink(), menuButton(), panel()]);
  }

  it.each(LOGGED_IN)("%s: Main nav, account info, Log out", async (state, me) => {
    mockFetch({ [ME]: me, ...SCREENS });
    renderApp("/event/1");
    await meShown(state);
    const main = header().getByRole("navigation", { name: "Main" });
    expect(panel().contains(main)).toBe(true);
    expect(within(main).getAllByRole("link")).toHaveLength(1);
    expect(panel().contains(accountInfo())).toBe(true);
    expect(panel().contains(header().getByRole("button", { name: "Log out" }))).toBe(true);
    expectOnlyLogoAndMenuOutside();
  });

  it("logged out: the Account nav with the three links", async () => {
    mockFetch({ [ME]: loggedOut, ...SCREENS });
    renderApp("/event/1");
    await meShown("logged out");
    const nav = header().getByRole("navigation", { name: "Account" });
    expect(panel().contains(nav)).toBe(true);
    expect(within(panel()).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Log in",
      "Sign up",
      "For organizers",
    ]);
    expectOnlyLogoAndMenuOutside();
  });
});

describe("HR15: Escape closes and gives the focus back to Menu", () => {
  it.each<[string, () => HTMLElement]>([
    ["the panel link", () => within(panel()).getByRole("link", { name: "My registrations" })],
    ["Log out", () => header().getByRole("button", { name: "Log out" })],
    ["the Menu button", () => menuButton()],
    ["the logo", () => logoLink()],
  ])("open, Escape on %s: closed, focus on Menu", async (_case, target) => {
    mockFetch({ [ME]: () => json(200, ANN), ...SCREENS });
    renderApp("/event/1");
    await meShown("attendee");
    openMenu();
    const element = target();
    element.focus();
    fireEvent.keyDown(element, { key: "Escape" });
    expectMenu(false);
    expect(document.activeElement).toBe(menuButton());
  });

  it("logged out: Escape on a panel link closes", async () => {
    mockFetch({ [ME]: loggedOut, ...SCREENS });
    renderApp("/event/1");
    await meShown("logged out");
    openMenu();
    const link = within(panel()).getByRole("link", { name: "Sign up" });
    link.focus();
    fireEvent.keyDown(link, { key: "Escape" });
    expectMenu(false);
    expect(document.activeElement).toBe(menuButton());
  });

  it("closed: Escape does nothing and the focus stays", async () => {
    mockFetch({ [ME]: () => json(200, ANN), ...SCREENS });
    renderApp("/event/1");
    await meShown("attendee");
    const logo = logoLink();
    logo.focus();
    fireEvent.keyDown(logo, { key: "Escape" });
    expectMenu(false);
    expect(document.activeElement).toBe(logo);
  });

  it("open: another key does not close", async () => {
    mockFetch({ [ME]: () => json(200, ANN), ...SCREENS });
    renderApp("/event/1");
    await meShown("attendee");
    openMenu();
    const logOut = header().getByRole("button", { name: "Log out" });
    logOut.focus();
    fireEvent.keyDown(logOut, { key: "a" });
    expectMenu(true);
    expect(document.activeElement).toBe(logOut);
  });
});

describe("HR16: the menu closes on navigation", () => {
  // Back and Forward of the browser, from outside the header.
  function HistoryButtons() {
    const navigate = useNavigate();
    return (
      <div>
        <button type="button" onClick={() => navigate(-1)}>
          test back
        </button>
        <button type="button" onClick={() => navigate(1)}>
          test forward
        </button>
      </div>
    );
  }

  it("logged out: a panel link closes it", async () => {
    mockFetch({ [ME]: loggedOut, ...SCREENS });
    renderApp("/event/1");
    await meShown("logged out");
    openMenu();
    fireEvent.click(within(panel()).getByRole("link", { name: "Sign up" }));
    await waitFor(() => expect(currentLocation()).toBe("/signup"));
    expectMenu(false);
  });

  it("organizer: My events closes it", async () => {
    mockFetch({ [ME]: () => json(200, OLGA), ...SCREENS });
    renderApp("/event/1");
    await meShown("organizer");
    openMenu();
    fireEvent.click(within(panel()).getByRole("link", { name: "My events" }));
    await waitFor(() => expect(currentLocation()).toBe("/organizer"));
    expectMenu(false);
  });

  it("the logo closes it", async () => {
    mockFetch({ [ME]: () => json(200, ANN), ...SCREENS });
    renderApp("/event/1");
    await meShown("attendee");
    openMenu();
    fireEvent.click(logoLink());
    await waitFor(() => expect(currentLocation()).toBe("/"));
    expectMenu(false);
  });

  it("the link of the current page closes it (new location key)", async () => {
    mockFetch({ [ME]: () => json(200, OLGA), ...SCREENS });
    renderApp("/organizer");
    await meShown("organizer");
    openMenu();
    fireEvent.click(within(panel()).getByRole("link", { name: "My events" }));
    await waitFor(() => expectMenu(false));
    expect(currentLocation()).toBe("/organizer");
  });

  it("Back and Forward close it", async () => {
    mockFetch({ [ME]: loggedOut, ...SCREENS });
    renderWith(
      <>
        <App />
        <HistoryButtons />
      </>,
      "/event/1",
    );
    await meShown("logged out");
    openMenu();
    fireEvent.click(within(panel()).getByRole("link", { name: "Sign up" }));
    await waitFor(() => expect(currentLocation()).toBe("/signup"));
    openMenu();
    fireEvent.click(screen.getByRole("button", { name: "test back" }));
    await waitFor(() => expect(currentLocation()).toBe("/event/1"));
    expectMenu(false);
    openMenu();
    fireEvent.click(screen.getByRole("button", { name: "test forward" }));
    await waitFor(() => expect(currentLocation()).toBe("/signup"));
    expectMenu(false);
  });

  it("stays open on a re-render without navigation and on a click on .account-info", async () => {
    mockFetch({ [ME]: () => json(200, ANN), ...SCREENS });
    const { queryClient } = renderApp("/event/1");
    await meShown("attendee");
    openMenu();
    fireEvent.click(accountInfo());
    expectMenu(true);
    act(() => {
      queryClient.setQueryData(["me"], { ...ANN, name: "Ann Lee" });
    });
    expect(await header().findByText("Ann Lee")).toBeTruthy();
    expectMenu(true);
    expect(currentLocation()).toBe("/event/1");
  });
});

describe("HR17: Log out and the menu", () => {
  it("a click on Log out keeps the panel open while pending", async () => {
    const answer = deferred<Response>();
    mockFetch({ [ME]: () => json(200, ANN), "POST /auth/users/logout": () => answer.promise });
    renderApp("/");
    await meShown("attendee");
    openMenu();
    fireEvent.click(header().getByRole("button", { name: "Log out" }));
    expect(await header().findByRole("button", { name: "Logging out..." })).toBeTruthy();
    expectMenu(true);
    await act(async () => {
      answer.resolve(json(204));
    });
    expect(await header().findByRole("link", { name: "Log in" })).toBeTruthy();
  });

  it("failed log out: the panel stays open with the alert in it", async () => {
    mockFetch({
      [ME]: () => json(200, ANN),
      "POST /auth/users/logout": () => json(500, { error: "internal" }),
    });
    renderApp("/");
    await meShown("attendee");
    openMenu();
    fireEvent.click(header().getByRole("button", { name: "Log out" }));
    const alert = await header().findByRole("alert");
    expect(alert.textContent).toBe("Could not log out. Try again.");
    expectMenu(true);
    expect(panel().contains(alert)).toBe(true);
    expect(header().getByRole("button", { name: "Log out" })).toBeTruthy();
  });

  it("attendee success: logged-out header with the menu closed", async () => {
    mockFetch({
      [ME]: () => json(200, ANN),
      "POST /auth/users/logout": () => json(204),
      ...SCREENS,
    });
    renderApp("/");
    await meShown("attendee");
    openMenu();
    fireEvent.click(header().getByRole("button", { name: "Log out" }));
    expect(await header().findByRole("link", { name: "Log in" })).toBeTruthy();
    expect(currentLocation()).toBe("/");
    expectMenu(false);
  });

  it("organizer success: redirected by the guard, menu closed", async () => {
    mockFetch({
      [ME]: () => json(200, OLGA),
      "POST /auth/organizers/logout": () => json(204),
      ...SCREENS,
    });
    renderApp("/organizer");
    await meShown("organizer");
    openMenu();
    fireEvent.click(header().getByRole("button", { name: "Log out" }));
    await waitFor(() =>
      expect(currentLocation()).toBe("/organizer/login?next=%2Forganizer"),
    );
    expect(await header().findByRole("link", { name: "Log in" })).toBeTruthy();
    expectMenu(false);
  });

  it("log in: the menu starts closed for the logged-in header", async () => {
    mockFetch({ [ME]: loggedOut, "POST /auth/users/login": () => json(200, ANN), ...SCREENS });
    renderApp("/login");
    await meShown("logged out");
    openMenu();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ann@mail.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret-pass" } });
    fireEvent.click(within(screen.getByRole("main")).getByRole("button", { name: "Log in" }));
    expect(await header().findByText("Ann")).toBeTruthy();
    expectMenu(false);
  });
});

describe("HR5: logged out: three links in order, no account info", () => {
  it.each([
    ["/event/1", "For organizers"],
    ["/organizer/login", "For attendees"],
  ])("on %s: Log in, Sign up, %s", async (path, roleSwitch) => {
    mockFetch({ [ME]: loggedOut, ...SCREENS });
    renderApp(path);
    await meShown("logged out");
    const nav = header().getByRole("navigation", { name: "Account" });
    expect(within(nav).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Log in",
      "Sign up",
      roleSwitch,
    ]);
    expect(nav.children).toHaveLength(3);
    expect(screen.getByRole("banner").querySelector(".account-info")).toBeNull();
  });

  it("while me is pending: no account links and no account info", () => {
    mockFetch({ [ME]: () => deferred<Response>().promise, ...SCREENS });
    renderApp("/event/1");
    expect(focusables()).toEqual([LOGO]);
    expect(screen.getByRole("banner").querySelector(".account-info")).toBeNull();
  });
});
