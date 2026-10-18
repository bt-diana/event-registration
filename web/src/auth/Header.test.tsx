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
  // none of them with a tabindex of its own. The icon-only Menu and Close menu buttons count
  // by their aria-label. The backdrop is a div, not focusable (header-responsive.md HR1, D69).
  function tabOrder(): string[] {
    const banner = screen.getByRole("banner");
    return Array.from(banner.querySelectorAll<HTMLElement>("a[href], button")).map((element) => {
      expect(element.hasAttribute("tabindex")).toBe(false);
      return element.getAttribute("aria-label") ?? element.textContent ?? "";
    });
  }

  it("logged out: Tab order logo, Menu, Close menu, All events, then the account links", async () => {
    mockFetch({ [ME]: loggedOut, ...SCREENS });
    renderApp("/event/1");
    await meShown("logged out");
    expect(tabOrder()).toEqual([
      LOGO,
      "Menu",
      "Close menu",
      "All events",
      "Log in",
      "Sign up",
      "For organizers",
    ]);
  });

  // The account link texts belong to W-R14; only their place after the logo is checked here.
  it.each<[State, () => Response]>([
    ["attendee", () => json(200, ANN)],
    ["organizer", () => json(200, OLGA)],
  ])("%s: Tab order logo, Menu, Close menu, All events, the account link, then Log out", async (state, me) => {
    mockFetch({ [ME]: me, ...SCREENS });
    renderApp("/event/1");
    await meShown(state);
    const accountLinks = within(header().getByRole("navigation", { name: "Main" }))
      .getAllByRole("link")
      .map((link) => link.textContent ?? "");
    expect(accountLinks.length).toBeGreaterThan(0);
    expect(tabOrder()).toEqual([LOGO, "Menu", "Close menu", "All events", ...accountLinks, "Log out"]);
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

// The DOM order of the focusable elements; the icon-only Menu and Close menu buttons count by
// their aria-label. The backdrop is a div and not focusable (HR1, D69).
function focusables(): string[] {
  return Array.from(
    screen.getByRole("banner").querySelectorAll<HTMLElement>("a[href], button"),
  ).map((element) => element.getAttribute("aria-label") ?? element.textContent ?? "");
}

// D66, D69: the burger and the drawer it controls (header-responsive.md HR6, HR11-HR17,
// HR21-HR35). Open and closed are read from aria-expanded and data-open, the modal state from
// role, inert and body.style.overflow, never from visibility (jsdom does not read styles.css).
// By the attribute, so HR26 and HR35 still find it after they set display: none on it (a
// hidden element has no accessible name). HR6 checks the role and the name.
function menuButton(): HTMLElement {
  const button = screen
    .getByRole("banner")
    .querySelector<HTMLElement>('button[aria-label="Menu"]');
  if (!button) throw new Error("no Menu button");
  return button;
}

function panel(): HTMLElement {
  const id = menuButton().getAttribute("aria-controls");
  if (!id) throw new Error("the Menu button has no aria-controls");
  const element = document.getElementById(id);
  if (!element) throw new Error(`no element with the id ${id}`);
  return element;
}

function closeButton(): HTMLElement {
  return header().getByRole("button", { name: "Close menu" });
}

function backdrop(): HTMLElement {
  const element = screen.getByRole("banner").querySelector<HTMLElement>(".nav-backdrop");
  if (!element) throw new Error("no .nav-backdrop");
  return element;
}

function allEvents(): HTMLElement {
  return header().getByRole("link", { name: "All events" });
}

function expectMenu(open: boolean) {
  expect(menuButton().getAttribute("aria-expanded")).toBe(String(open));
  expect(panel().getAttribute("data-open")).toBe(String(open));
}

function openMenu() {
  fireEvent.click(menuButton());
  expectMenu(true);
}

// The elements behind the drawer that get inert while it is open (HR33).
function inertTargets(): HTMLElement[] {
  const main = document.querySelector<HTMLElement>("main");
  if (!main) throw new Error("no main");
  return [main, logoLink(), menuButton()];
}

function expectModal(open: boolean) {
  for (const element of inertTargets()) expect(element.hasAttribute("inert")).toBe(open);
  expect(document.querySelectorAll("[inert]")).toHaveLength(open ? 3 : 0);
  expect(document.body.style.overflow === "hidden").toBe(open);
}

describe("HR1: account block order and Tab order with the drawer", () => {
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
    expect(focusables()).toEqual([LOGO, "Menu", "Close menu", "All events", link.textContent, "Log out"]);
  });

  it("logged out: logo, Menu, Close menu, All events, Log in, Sign up, role switch", async () => {
    mockFetch({ [ME]: loggedOut, ...SCREENS });
    renderApp("/event/1");
    await meShown("logged out");
    expect(focusables()).toEqual([
      LOGO,
      "Menu",
      "Close menu",
      "All events",
      "Log in",
      "Sign up",
      "For organizers",
    ]);
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

  it("with the drawer open: the same full name and title", async () => {
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

  it("with the drawer open: the alert follows the button, in the drawer, outside .account-info", async () => {
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
// Reworked tests first for D67-D69: the drawer, the header click and All events.
describe("HR6: the Menu button", () => {
  type MeCase = [string, () => Response | Promise<Response>, string[], string | null];
  const CASES: MeCase[] = [
    ["pending", () => deferred<Response>().promise, [], null],
    ["logged out", loggedOut, ["Menu", "Close menu"], "Account"],
    ["5xx", () => json(500, { error: "internal" }), ["Menu", "Close menu"], "Account"],
    [
      "network error",
      () => {
        throw new TypeError("Failed to fetch");
      },
      ["Menu", "Close menu"],
      "Account",
    ],
    ["attendee", () => json(200, ANN), ["Menu", "Close menu", "Log out"], "Main"],
    ["organizer", () => json(200, OLGA), ["Menu", "Close menu", "Log out"], "Main"],
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
    expect(navs.map((element) => element.getAttribute("aria-label"))).toEqual(
      nav ? ["Site", nav] : [],
    );
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
      expect(header().getAllByRole("button", { name: "Close menu" })).toHaveLength(1);
    },
  );

  it("keeps the name Menu open and closed", async () => {
    mockFetch({ [ME]: () => json(200, ANN), ...SCREENS });
    renderApp("/event/1");
    await meShown("attendee");
    const button = menuButton();
    fireEvent.click(button);
    expectMenu(true);
    expect(menuButton()).toBe(button);
    expect(button.getAttribute("aria-label")).toBe("Menu");
    fireEvent.click(closeButton());
    expectMenu(false);
    expect(button.getAttribute("aria-label")).toBe("Menu");
  });
});

describe("HR11: closed by default", () => {
  it.each(STATES)("%s: closed, no dialog role, no inert, no scroll lock", async (state, me) => {
    mockFetch({ [ME]: me, ...SCREENS });
    renderApp("/event/1");
    await meShown(state);
    expectMenu(false);
    expect(panel().hasAttribute("role")).toBe(false);
    expect(panel().hasAttribute("aria-modal")).toBe(false);
    expectModal(false);
  });

  it("5xx: closed by default", async () => {
    mockFetch({ [ME]: () => json(500, { error: "internal" }), ...SCREENS });
    renderApp("/event/1");
    await meShown("logged out");
    expectMenu(false);
    expect(panel().hasAttribute("role")).toBe(false);
    expectModal(false);
  });
});

describe("HR12: aria-controls points to the drawer, the backdrop before it", () => {
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
    expect(panel().classList.contains("site-header-end")).toBe(true);
    expect(panel().tagName).toBe("DIV");
    expect(panel().contains(header().getByRole("navigation", { name: nav }))).toBe(true);
    expect(panel().getAttribute("aria-label")).toBe("Menu");
    const shade = panel().previousElementSibling as HTMLElement;
    expect(shade).toBe(backdrop());
    expect(shade.tagName).toBe("DIV");
    expect(shade.getAttribute("aria-hidden")).toBe("true");
    expect(shade.hasAttribute("role")).toBe(false);
    expect(shade.hasAttribute("tabindex")).toBe(false);
    openMenu();
    expect(panel().getAttribute("aria-label")).toBe("Menu");
  });
});

describe("HR13: Menu opens, it does not toggle", () => {
  it.each(STATES)("%s: a second click on Menu or on the header row keeps it open", async (state, me) => {
    mockFetch({ [ME]: me, ...SCREENS });
    renderApp("/event/1");
    await meShown(state);
    fireEvent.click(menuButton());
    expectMenu(true);
    for (let click = 0; click < 3; click += 1) {
      fireEvent.click(menuButton());
      expectMenu(true);
      fireEvent.click(screen.getByRole("banner"));
      expectMenu(true);
    }
  });
});

describe("HR14: what is in the drawer", () => {
  // Outside the drawer the banner has only the logo, the Menu button and the backdrop.
  function expectOnlyLogoAndMenuOutside() {
    const banner = screen.getByRole("banner");
    expect(Array.from(banner.children)).toEqual([logoLink(), menuButton(), backdrop(), panel()]);
  }

  // The drawer starts with Close menu, then the Site nav with All events.
  function expectCloseThenSiteNav() {
    const [first, second] = Array.from(panel().children);
    expect(first).toBe(closeButton());
    expect(first.classList.contains("nav-close")).toBe(true);
    expect(second).toBe(header().getByRole("navigation", { name: "Site" }));
  }

  it.each(LOGGED_IN)("%s: Close menu, All events, Main nav, account info, Log out", async (state, me) => {
    mockFetch({ [ME]: me, ...SCREENS });
    renderApp("/event/1");
    await meShown(state);
    const main = header().getByRole("navigation", { name: "Main" });
    expect(panel().contains(main)).toBe(true);
    expect(within(main).getAllByRole("link")).toHaveLength(1);
    expect(panel().contains(accountInfo())).toBe(true);
    expect(panel().contains(header().getByRole("button", { name: "Log out" }))).toBe(true);
    expectCloseThenSiteNav();
    expect(within(panel()).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "All events",
      within(main).getByRole("link").textContent,
    ]);
    expectOnlyLogoAndMenuOutside();
  });

  it("logged out: Close menu, All events, the Account nav with the three links", async () => {
    mockFetch({ [ME]: loggedOut, ...SCREENS });
    renderApp("/event/1");
    await meShown("logged out");
    const nav = header().getByRole("navigation", { name: "Account" });
    expect(panel().contains(nav)).toBe(true);
    expectCloseThenSiteNav();
    expect(within(panel()).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "All events",
      "Log in",
      "Sign up",
      "For organizers",
    ]);
    expectOnlyLogoAndMenuOutside();
  });
});

describe("HR15: Escape closes and gives the focus back to Menu", () => {
  it.each<[string, () => HTMLElement]>([
    ["the drawer link", () => within(panel()).getByRole("link", { name: "My registrations" })],
    ["All events", () => allEvents()],
    ["Log out", () => header().getByRole("button", { name: "Log out" })],
    ["Close menu", () => closeButton()],
    ["the Menu button", () => menuButton()],
    ["the logo", () => logoLink()],
  ])("open, Escape on %s: closed, focus on Menu, no inert left", async (_case, target) => {
    mockFetch({ [ME]: () => json(200, ANN), ...SCREENS });
    renderApp("/event/1");
    await meShown("attendee");
    openMenu();
    const element = target();
    element.focus();
    fireEvent.keyDown(element, { key: "Escape" });
    expectMenu(false);
    expectModal(false);
    expect(document.activeElement).toBe(menuButton());
  });

  it("logged out: Escape on a drawer link closes", async () => {
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

  it("logged out: a drawer link closes it, no inert left, focus not moved to Menu", async () => {
    mockFetch({ [ME]: loggedOut, ...SCREENS });
    renderApp("/event/1");
    await meShown("logged out");
    openMenu();
    fireEvent.click(within(panel()).getByRole("link", { name: "Sign up" }));
    await waitFor(() => expect(currentLocation()).toBe("/signup"));
    expectMenu(false);
    expectModal(false);
    expect(document.activeElement).not.toBe(menuButton());
  });

  it("organizer: My events closes it", async () => {
    mockFetch({ [ME]: () => json(200, OLGA), ...SCREENS });
    renderApp("/event/1");
    await meShown("organizer");
    openMenu();
    fireEvent.click(within(panel()).getByRole("link", { name: "My events" }));
    await waitFor(() => expect(currentLocation()).toBe("/organizer"));
    expectMenu(false);
    expect(document.activeElement).not.toBe(menuButton());
  });

  it("All events closes it", async () => {
    mockFetch({ [ME]: () => json(200, ANN), ...SCREENS });
    renderApp("/event/1");
    await meShown("attendee");
    openMenu();
    fireEvent.click(allEvents());
    await waitFor(() => expect(currentLocation()).toBe("/"));
    expectMenu(false);
    expectModal(false);
    expect(document.activeElement).not.toBe(menuButton());
  });

  it("All events on / closes it (new location key)", async () => {
    mockFetch({ [ME]: loggedOut, ...SCREENS });
    renderApp("/");
    await meShown("logged out");
    openMenu();
    fireEvent.click(allEvents());
    await waitFor(() => expectMenu(false));
    expect(currentLocation()).toBe("/");
  });

  it("the link of the current page closes it (new location key)", async () => {
    mockFetch({ [ME]: () => json(200, OLGA), ...SCREENS });
    renderApp("/organizer");
    await meShown("organizer");
    openMenu();
    fireEvent.click(within(panel()).getByRole("link", { name: "My events" }));
    await waitFor(() => expectMenu(false));
    expect(currentLocation()).toBe("/organizer");
    expect(document.activeElement).not.toBe(menuButton());
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
    expectModal(false);
    expect(document.activeElement).not.toBe(menuButton());
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
  it("a click on Log out keeps the drawer open while pending", async () => {
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

  it("failed log out: the drawer stays open with the alert in it", async () => {
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
    expectModal(true);
    expect(header().getByRole("dialog", { name: "Menu" })).toBe(panel());
    expect(panel().contains(alert)).toBe(true);
    expect(header().getByRole("button", { name: "Log out" })).toBeTruthy();
  });

  it("attendee success: logged-out header with the menu closed, no inert, no scroll lock", async () => {
    mockFetch({
      [ME]: () => json(200, ANN),
      "POST /auth/users/logout": () => json(204),
      ...SCREENS,
    });
    renderApp("/");
    await meShown("attendee");
    openMenu();
    expectModal(true);
    fireEvent.click(header().getByRole("button", { name: "Log out" }));
    expect(await header().findByRole("link", { name: "Log in" })).toBeTruthy();
    expect(currentLocation()).toBe("/");
    expectMenu(false);
    expectModal(false);
    expect(header().queryByRole("dialog")).toBeNull();
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
    expectModal(false);
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

// Tests first (header-responsive.md, D67-D69): HR21-HR35.
describe("HR21: a click on the header row opens the menu", () => {
  it.each(STATES)("%s: a click on the banner itself opens it", async (state, me) => {
    mockFetch({ [ME]: me, ...SCREENS });
    renderApp("/event/1");
    await meShown(state);
    fireEvent.click(screen.getByRole("banner"));
    expectMenu(true);
  });

  it.each(STATES)("%s: a click on Menu opens it", async (state, me) => {
    mockFetch({ [ME]: me, ...SCREENS });
    renderApp("/event/1");
    await meShown(state);
    fireEvent.click(menuButton());
    expectMenu(true);
  });

  it("a click on the Menu icon opens it", async () => {
    mockFetch({ [ME]: () => json(200, ANN), ...SCREENS });
    renderApp("/event/1");
    await meShown("attendee");
    const icon = menuButton().querySelector("svg");
    if (!icon) throw new Error("no icon");
    fireEvent.click(icon);
    expectMenu(true);
  });
});

describe("HR22: the logo navigates and does not open the menu", () => {
  it.each(STATES)("%s from /event/1: goes to /, menu stays closed", async (state, me) => {
    mockFetch({ [ME]: me, ...SCREENS });
    renderApp("/event/1");
    await meShown(state);
    const logo = logoLink();
    logo.focus();
    fireEvent.click(logo);
    expectMenu(false);
    await waitFor(() => expect(currentLocation()).toBe("/"));
    expectMenu(false);
    expectModal(false);
    // An open that was closed again by the navigation would have moved the focus to Close menu.
    expect(document.activeElement).toBe(logo);
  });

  it("a click on the logo icon does not open the menu either", async () => {
    mockFetch({ [ME]: loggedOut, ...SCREENS });
    renderApp("/event/1");
    await meShown("logged out");
    const icon = logoLink().querySelector("img");
    if (!icon) throw new Error("no logo icon");
    logoLink().focus();
    fireEvent.click(icon);
    await waitFor(() => expect(currentLocation()).toBe("/"));
    expectMenu(false);
    expect(document.activeElement).toBe(logoLink());
  });
});

describe("HR23: clicks inside the drawer or on the backdrop never open the menu", () => {
  it("closed: a drawer link navigates and the menu stays closed", async () => {
    mockFetch({ [ME]: loggedOut, ...SCREENS });
    renderApp("/event/1");
    await meShown("logged out");
    const link = within(panel()).getByRole("link", { name: "Sign up" });
    link.focus();
    fireEvent.click(link);
    expectMenu(false);
    await waitFor(() => expect(currentLocation()).toBe("/signup"));
    expectMenu(false);
    expect(document.activeElement).toBe(link);
  });

  it("closed: All events navigates and the menu stays closed", async () => {
    mockFetch({ [ME]: () => json(200, ANN), ...SCREENS });
    renderApp("/event/1");
    await meShown("attendee");
    const link = allEvents();
    link.focus();
    fireEvent.click(link);
    await waitFor(() => expect(currentLocation()).toBe("/"));
    expectMenu(false);
    expect(document.activeElement).toBe(link);
  });

  it("closed: .account-info, the backdrop, Close menu and the drawer itself do nothing", async () => {
    mockFetch({ [ME]: () => json(200, ANN), ...SCREENS });
    renderApp("/event/1");
    await meShown("attendee");
    fireEvent.click(accountInfo());
    expectMenu(false);
    fireEvent.click(backdrop());
    expectMenu(false);
    fireEvent.click(closeButton());
    expectMenu(false);
    fireEvent.click(panel());
    expectMenu(false);
    expectModal(false);
  });

  it("closed: Log out acts and the menu stays closed", async () => {
    const answer = deferred<Response>();
    const fetch = mockFetch({
      [ME]: () => json(200, ANN),
      "POST /auth/users/logout": () => answer.promise,
    });
    renderApp("/");
    await meShown("attendee");
    fireEvent.click(header().getByRole("button", { name: "Log out" }));
    expect(await header().findByRole("button", { name: "Logging out..." })).toBeTruthy();
    expectMenu(false);
    expect(callsTo(fetch, "POST /auth/users/logout")).toBe(1);
    await act(async () => {
      answer.resolve(json(204));
    });
    expect(await header().findByRole("link", { name: "Log in" })).toBeTruthy();
  });

  it("open: .account-info keeps it open", async () => {
    mockFetch({ [ME]: () => json(200, ANN), ...SCREENS });
    renderApp("/event/1");
    await meShown("attendee");
    openMenu();
    fireEvent.click(accountInfo());
    expectMenu(true);
    fireEvent.click(panel());
    expectMenu(true);
  });
});

describe("HR24: Enter and Space on Menu open it once", () => {
  // jsdom turns no key into a click: a keyboard press on a button is a keydown, a click
  // with detail 0 and a keyup in the browser, so that sequence stands in for it.
  function keyboardClick(element: HTMLElement, key: string) {
    fireEvent.keyDown(element, { key });
    fireEvent.click(element, { detail: 0 });
    fireEvent.keyUp(element, { key });
  }

  it.each(["Enter", " "])("%j: open after one press, still open after a second", async (key) => {
    mockFetch({ [ME]: () => json(200, ANN), ...SCREENS });
    renderApp("/event/1");
    await meShown("attendee");
    const button = menuButton();
    button.focus();
    keyboardClick(button, key);
    expectMenu(true);
    keyboardClick(button, key);
    expectMenu(true);
  });

  it("two clicks in a row: open", async () => {
    mockFetch({ [ME]: loggedOut, ...SCREENS });
    renderApp("/event/1");
    await meShown("logged out");
    fireEvent.click(menuButton());
    fireEvent.click(menuButton());
    expectMenu(true);
  });
});

describe("HR25: the header bar is not a second button", () => {
  it.each(STATES)("%s: no tabindex, no role, no aria-* on the banner", async (state, me) => {
    mockFetch({ [ME]: me, ...SCREENS });
    renderApp("/event/1");
    await meShown(state);
    const banner = screen.getByRole("banner");
    expect(banner.tagName).toBe("HEADER");
    expect(banner.hasAttribute("tabindex")).toBe(false);
    expect(banner.hasAttribute("role")).toBe(false);
    expect(banner.getAttributeNames().filter((name) => name.startsWith("aria-"))).toEqual([]);
  });
});

describe("HR26: no header click open while Menu is not displayed", () => {
  it.each(STATES)("%s: Menu display none, a click on the banner keeps it closed", async (state, me) => {
    mockFetch({ [ME]: me, ...SCREENS });
    renderApp("/event/1");
    await meShown(state);
    menuButton().style.display = "none";
    fireEvent.click(screen.getByRole("banner"));
    expectMenu(false);
    expectModal(false);
  });
});

describe("HR27: All events, first in the drawer and in the desktop row, after Close menu", () => {
  it.each(
    STATES.flatMap(([state, me]) =>
      ["/", "/event/1", "/login"].map((path) => [state, path, me] as const),
    ),
  )("%s on %s: one link All events to / in the Site nav", async (state, path, me) => {
    mockFetch({ [ME]: me, ...SCREENS });
    renderApp(path);
    await meShown(state);
    const site = header().getByRole("navigation", { name: "Site" });
    expect(panel().contains(site)).toBe(true);
    expect(panel().children[1]).toBe(site);
    const links = within(site).getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toBe(allEvents());
    expect(links[0].textContent).toBe("All events");
    expect(links[0].getAttribute("href")).toBe("/");
    expect(header().getAllByRole("link", { name: "All events" })).toHaveLength(1);
    const other = header().getByRole("navigation", { name: state === "logged out" ? "Account" : "Main" });
    expect(site.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it.each(["/organizer", "/organizer/events/new"])("organizer on %s: All events to /", async (path) => {
    mockFetch({ [ME]: () => json(200, OLGA), ...SCREENS });
    renderApp(path);
    await meShown("organizer");
    expect(allEvents().getAttribute("href")).toBe("/");
  });
});

describe("HR28: All events aria-current on / only (exact match)", () => {
  it.each(STATES)("%s on /: aria-current is page", async (state, me) => {
    mockFetch({ [ME]: me, ...SCREENS });
    renderApp("/");
    await meShown(state);
    expect(allEvents().getAttribute("aria-current")).toBe("page");
  });

  it("ignores the query string and the hash", async () => {
    mockFetch({ [ME]: loggedOut, ...SCREENS });
    renderApp("/?from=mail#top");
    await meShown("logged out");
    expect(allEvents().getAttribute("aria-current")).toBe("page");
  });

  it.each<[State, string]>([
    ["logged out", "/event/1"],
    ["logged out", "/login"],
    ["attendee", "/event/1"],
    ["organizer", "/event/1"],
    ["organizer", "/organizer"],
  ])("%s on %s: no aria-current", async (state, path) => {
    const me = STATES.find(([name]) => name === state)?.[1] ?? loggedOut;
    mockFetch({ [ME]: me, ...SCREENS });
    renderApp(path);
    await meShown(state);
    expect(allEvents().getAttribute("aria-current")).toBeNull();
  });
});

// Tests first for D73 (header-responsive.md HR1, HR19, HR27, HR28; header-events-link.md HB1,
// HB4, HB9): All events at every width, also above 640 px in the one-row header. jsdom does not
// read styles.css, so the desktop look and the absence of a hiding media query are checked by
// hand; these tests check the DOM the desktop row is made of.
describe("HR27 (D73): All events at every width", () => {
  it("is absent while me is pending: the header shows only the logo", () => {
    mockFetch({ [ME]: () => deferred<Response>().promise, ...SCREENS });
    renderApp("/");
    expect(header().queryByRole("link", { name: "All events" })).toBeNull();
    expect(header().queryByRole("navigation", { name: "Site" })).toBeNull();
    expect(header().getAllByRole("link").map((link) => link.textContent)).toEqual([LOGO]);
  });

  it.each<[string, (me: ReturnType<typeof deferred<Response>>) => void, State]>([
    ["200 attendee", (me) => me.resolve(json(200, ANN)), "attendee"],
    ["200 organizer", (me) => me.resolve(json(200, OLGA)), "organizer"],
    ["401", (me) => me.resolve(loggedOut()), "logged out"],
    ["5xx", (me) => me.resolve(json(500, { error: "internal" })), "logged out"],
    ["network error", (me) => me.reject(new TypeError("Failed to fetch")), "logged out"],
  ])("appears after me answers %s: one link All events to /", async (_case, settle, state) => {
    const me = deferred<Response>();
    mockFetch({ [ME]: () => me.promise, ...SCREENS });
    renderApp("/event/1");
    expect(header().queryByRole("link", { name: "All events" })).toBeNull();
    settle(me);
    await meShown(state);
    const links = header().getAllByRole("link", { name: "All events" });
    expect(links).toHaveLength(1);
    expect(links[0]).toBe(allEvents());
    expect(links[0].textContent).toBe("All events");
    expect(links[0].getAttribute("href")).toBe("/");
    expect(links[0]).not.toBe(logoLink());
    // Nothing in the markup hides it at any width: no hidden, no aria-hidden, no inline style.
    const site = header().getByRole("navigation", { name: "Site" });
    for (const element of [site, links[0]]) {
      expect(element.hasAttribute("hidden")).toBe(false);
      expect(element.hasAttribute("aria-hidden")).toBe(false);
      expect(element.hasAttribute("style")).toBe(false);
    }
    expect(within(site).getAllByRole("link")).toHaveLength(1);
    expect(site.classList.contains("site-nav")).toBe(true);
  });

  // Paths that do not redirect in any state; the other paths are in HR28 above.
  it.each(STATES)("%s: aria-current only on / (HR28)", async (state, me) => {
    for (const [path, current] of [
      ["/", "page"],
      ["/event/1", null],
      ["/event/1?from=/#/", null],
    ] as const) {
      mockFetch({ [ME]: me, ...SCREENS });
      const view = renderApp(path);
      await meShown(state);
      expect(allEvents().getAttribute("aria-current")).toBe(current);
      view.unmount();
    }
  });

  // Desktop is faked like HR26: Menu and Close menu are display: none above 640 px, so the Tab
  // order is the DOM order of what is still displayed (HR1, HB9).
  function desktopTabOrder(): string[] {
    menuButton().style.display = "none";
    closeButton().style.display = "none";
    return Array.from(screen.getByRole("banner").querySelectorAll<HTMLElement>("a[href], button"))
      .filter((element) => getComputedStyle(element).display !== "none")
      .map((element) => {
        expect(element.hasAttribute("tabindex")).toBe(false);
        return element.getAttribute("aria-label") ?? element.textContent ?? "";
      });
  }

  it.each(LOGGED_IN)("%s on desktop: Tab order logo, All events, nav link, Log out", async (state, me) => {
    mockFetch({ [ME]: me, ...SCREENS });
    renderApp("/event/1");
    await meShown(state);
    const link = within(header().getByRole("navigation", { name: "Main" })).getByRole("link");
    expect(desktopTabOrder()).toEqual([LOGO, "All events", link.textContent, "Log out"]);
  });

  it("logged out on desktop: Tab order logo, All events, Log in, Sign up, role switch", async () => {
    mockFetch({ [ME]: loggedOut, ...SCREENS });
    renderApp("/event/1");
    await meShown("logged out");
    expect(desktopTabOrder()).toEqual([LOGO, "All events", "Log in", "Sign up", "For organizers"]);
  });

  // On desktop the row's right group starts with All events: the first displayed child of the
  // drawer element, before the Main or Account nav; no divider sibling (.account-info) after it.
  it.each(STATES)("%s on desktop: All events is the first item of the right group", async (state, me) => {
    mockFetch({ [ME]: me, ...SCREENS });
    renderApp("/event/1");
    await meShown(state);
    closeButton().style.display = "none";
    const shown = Array.from(panel().children).filter(
      (element) => getComputedStyle(element).display !== "none",
    );
    const site = header().getByRole("navigation", { name: "Site" });
    expect(shown[0]).toBe(site);
    expect(site.nextElementSibling?.classList.contains("account-info")).toBe(false);
    const other = header().getByRole("navigation", { name: state === "logged out" ? "Account" : "Main" });
    expect(shown[1].contains(other)).toBe(true);
  });
});

describe("HR29: a dialog only while open", () => {
  it.each(STATES)("%s: no dialog closed, dialog Menu open, none after close", async (state, me) => {
    mockFetch({ [ME]: me, ...SCREENS });
    renderApp("/event/1");
    await meShown(state);
    expect(screen.queryByRole("dialog")).toBeNull();
    openMenu();
    expect(header().getByRole("dialog", { name: "Menu" })).toBe(panel());
    expect(panel().getAttribute("role")).toBe("dialog");
    expect(panel().getAttribute("aria-modal")).toBe("true");
    fireEvent.click(closeButton());
    expectMenu(false);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(panel().hasAttribute("aria-modal")).toBe(false);
  });
});

describe("HR30: Close menu", () => {
  it.each(STATES)("%s: a button type=button, icon only, first in the drawer", async (state, me) => {
    mockFetch({ [ME]: me, ...SCREENS });
    renderApp("/event/1");
    await meShown(state);
    const button = closeButton();
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");
    expect(button.getAttribute("aria-label")).toBe("Close menu");
    expect(button.classList.contains("nav-close")).toBe(true);
    expect(button.textContent).toBe("");
    expect(button.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(panel().firstElementChild).toBe(button);
  });

  it.each(STATES)("%s: open moves the focus to Close menu; Close closes and focuses Menu", async (state, me) => {
    mockFetch({ [ME]: me, ...SCREENS });
    renderApp("/event/1");
    await meShown(state);
    menuButton().focus();
    openMenu();
    expect(document.activeElement).toBe(closeButton());
    fireEvent.click(closeButton());
    expectMenu(false);
    expectModal(false);
    expect(document.activeElement).toBe(menuButton());
  });

  it("the header row click also moves the focus to Close menu", async () => {
    mockFetch({ [ME]: () => json(200, ANN), ...SCREENS });
    renderApp("/event/1");
    await meShown("attendee");
    fireEvent.click(screen.getByRole("banner"));
    expect(document.activeElement).toBe(closeButton());
  });
});

describe("HR31: the focus stays in the open drawer", () => {
  function tab(element: Element, shiftKey = false): boolean {
    return fireEvent.keyDown(element, { key: "Tab", shiftKey });
  }

  it.each<[State, () => Response, () => HTMLElement]>([
    ["logged out", loggedOut, () => header().getByRole("link", { name: "For organizers" })],
    ["attendee", () => json(200, ANN), () => header().getByRole("button", { name: "Log out" })],
    ["organizer", () => json(200, OLGA), () => header().getByRole("button", { name: "Log out" })],
  ])("%s: Tab on the last goes to Close menu, Shift+Tab on Close menu to the last", async (state, me, last) => {
    mockFetch({ [ME]: me, ...SCREENS });
    renderApp("/event/1");
    await meShown(state);
    openMenu();
    expect(document.activeElement).toBe(closeButton());

    expect(tab(closeButton(), true)).toBe(false);
    expect(document.activeElement).toBe(last());

    expect(tab(last())).toBe(false);
    expect(document.activeElement).toBe(closeButton());
  });

  it("Tab inside the drawer is left to the browser away from the ends", async () => {
    mockFetch({ [ME]: () => json(200, ANN), ...SCREENS });
    renderApp("/event/1");
    await meShown("attendee");
    openMenu();
    expect(tab(closeButton())).toBe(true);
    expect(document.activeElement).toBe(closeButton());
    const link = allEvents();
    link.focus();
    expect(tab(link)).toBe(true);
    expect(tab(link, true)).toBe(true);
    expect(document.activeElement).toBe(link);
    const logOut = header().getByRole("button", { name: "Log out" });
    logOut.focus();
    expect(tab(logOut, true)).toBe(true);
    expect(document.activeElement).toBe(logOut);
  });

  it("a disabled Logging out... is skipped: the nav link is the last", async () => {
    const answer = deferred<Response>();
    mockFetch({ [ME]: () => json(200, ANN), "POST /auth/users/logout": () => answer.promise });
    renderApp("/");
    await meShown("attendee");
    openMenu();
    fireEvent.click(header().getByRole("button", { name: "Log out" }));
    expect(await header().findByRole("button", { name: "Logging out..." })).toBeTruthy();
    const link = within(header().getByRole("navigation", { name: "Main" })).getByRole("link");
    closeButton().focus();
    expect(tab(closeButton(), true)).toBe(false);
    expect(document.activeElement).toBe(link);
    expect(tab(link)).toBe(false);
    expect(document.activeElement).toBe(closeButton());
    await act(async () => {
      answer.resolve(json(204));
    });
    expect(await header().findByRole("link", { name: "Log in" })).toBeTruthy();
  });

  it("closed: Tab is not trapped", async () => {
    mockFetch({ [ME]: () => json(200, ANN), ...SCREENS });
    renderApp("/event/1");
    await meShown("attendee");
    const logOut = header().getByRole("button", { name: "Log out" });
    logOut.focus();
    expect(tab(logOut)).toBe(true);
    expect(document.activeElement).toBe(logOut);
  });
});

describe("HR32: a click on the backdrop closes", () => {
  it.each(STATES)("%s: closed, focus on Menu, no inert, no lock", async (state, me) => {
    mockFetch({ [ME]: me, ...SCREENS });
    renderApp("/event/1");
    await meShown(state);
    openMenu();
    fireEvent.click(backdrop());
    expectMenu(false);
    expectModal(false);
    expect(document.activeElement).toBe(menuButton());
  });
});

describe("HR33: the page behind is inert while open", () => {
  it.each(STATES)("%s: inert on main, the logo and Menu; not on the drawer", async (state, me) => {
    mockFetch({ [ME]: me, ...SCREENS });
    renderApp("/event/1");
    await meShown(state);
    openMenu();
    expectModal(true);
    expect(panel().closest("[inert]")).toBeNull();
    expect(screen.getByRole("banner").hasAttribute("inert")).toBe(false);
    expect(screen.getByRole("main").hasAttribute("aria-hidden")).toBe(false);
    fireEvent.keyDown(closeButton(), { key: "Escape" });
    expectModal(false);
  });

  it("unmount while open removes inert", async () => {
    mockFetch({ [ME]: () => json(200, ANN), ...SCREENS });
    const view = renderApp("/event/1");
    await meShown("attendee");
    openMenu();
    const targets = inertTargets();
    view.unmount();
    for (const element of targets) expect(element.hasAttribute("inert")).toBe(false);
  });
});

describe("HR34: the page does not scroll while open", () => {
  afterEach(() => {
    document.body.style.overflow = "";
  });

  it("locks the body and restores the earlier value on close", async () => {
    document.body.style.overflow = "scroll";
    mockFetch({ [ME]: () => json(200, ANN), ...SCREENS });
    renderApp("/event/1");
    await meShown("attendee");
    expect(document.body.style.overflow).toBe("scroll");
    openMenu();
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.click(closeButton());
    expect(document.body.style.overflow).toBe("scroll");
    openMenu();
    fireEvent.click(backdrop());
    expect(document.body.style.overflow).toBe("scroll");
  });

  it("restores the earlier value on unmount", async () => {
    document.body.style.overflow = "auto";
    mockFetch({ [ME]: loggedOut, ...SCREENS });
    const view = renderApp("/event/1");
    await meShown("logged out");
    openMenu();
    expect(document.body.style.overflow).toBe("hidden");
    view.unmount();
    expect(document.body.style.overflow).toBe("auto");
  });
});

describe("HR35: a resize to desktop closes an open menu", () => {
  it.each(STATES)("%s: Menu not displayed and resize: closed, no inert, no lock", async (state, me) => {
    mockFetch({ [ME]: me, ...SCREENS });
    renderApp("/event/1");
    await meShown(state);
    openMenu();
    const focused = document.activeElement;
    menuButton().style.display = "none";
    fireEvent(window, new Event("resize"));
    expectMenu(false);
    expectModal(false);
    expect(document.activeElement).toBe(focused);
    expect(document.activeElement).not.toBe(menuButton());
  });

  it("a resize while Menu is displayed keeps it open", async () => {
    mockFetch({ [ME]: () => json(200, ANN), ...SCREENS });
    renderApp("/event/1");
    await meShown("attendee");
    openMenu();
    fireEvent(window, new Event("resize"));
    expectMenu(true);
    expectModal(true);
  });
});
