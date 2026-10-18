// Tests first (events-public-list-web.md): W-L3, W-L4, W-L8, W-L9.
// Then W-L1, W-L2, W-L5-W-L7, W-L10-W-L13.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import { MemoryRouter, useNavigate } from "react-router";
import { App } from "../App";
import {
  ANN,
  LocationProbe,
  OLGA,
  callsTo,
  deferred,
  json,
  mockFetch,
  renderApp,
} from "../auth/test-helpers";
import { formatDateTime, formatDuration } from "./format";
import { publicListItem, type SamplePublicListItem } from "./test-helpers";

afterEach(() => {
  vi.unstubAllGlobals();
});

const LIST = "GET /public/events";
const ME = "GET /auth/me";
const loggedOut = () => json(401, { error: "not_logged_in" });

function main() {
  return within(screen.getByRole("main"));
}

function location(): string | null {
  return screen.getByTestId("location").textContent;
}

function cards(): HTMLElement[] {
  return main().queryAllByRole("listitem");
}

async function showList(
  events: unknown[],
  me: () => Response | Promise<Response> = loggedOut,
) {
  const fetch = mockFetch({ [ME]: me, [LIST]: () => json(200, { events }) });
  renderApp("/");
  await screen.findByRole("heading", { level: 1, name: "Events" });
  if (events.length > 0) await main().findAllByRole("listitem");
  return fetch;
}

const BADGES = ["Already started", "Full", "Cancelled", "Ended"];

function expectOnlyBadge(card: HTMLElement, label: string) {
  expect(within(card).getByText(label)).toBeTruthy();
  for (const other of BADGES.filter((l) => l !== label)) {
    expect(within(card).queryByText(other)).toBeNull();
  }
  if (!label.endsWith("seats left")) {
    expect(within(card).queryByText(/seats left/)).toBeNull();
  }
}

describe("W-L3: badge, first match wins (W-E17 words)", () => {
  it.each<[string, Partial<SamplePublicListItem>, string]>([
    ["seats left", { capacity: 25, seats_left: 12 }, "12 of 25 seats left"],
    ["all seats left", { capacity: 120, seats_left: 120 }, "120 of 120 seats left"],
    ["one seat left", { capacity: 40, seats_left: 1 }, "1 of 40 seats left"],
    ["full", { full: true, seats_left: 0 }, "Full"],
    ["already started", { has_started: true, seats_left: 10 }, "Already started"],
    ["cancelled", { status: "cancelled", seats_left: 0 }, "Cancelled"],
    ["passed", { status: "passed", has_started: true, seats_left: 0 }, "Ended"],
    // Order cases.
    ["full and started", { full: true, has_started: true, seats_left: 0 }, "Already started"],
    ["cancelled and started", { status: "cancelled", has_started: true }, "Cancelled"],
    ["cancelled and full", { status: "cancelled", full: true, seats_left: 0 }, "Cancelled"],
    ["passed and full", { status: "passed", full: true, seats_left: 0 }, "Ended"],
  ])("%s: %s", async (_case, overrides, label) => {
    await showList([publicListItem(overrides)]);
    const [card] = cards();
    expectOnlyBadge(card, label);
  });

  it("gives each card its own badge", async () => {
    await showList([
      publicListItem({ id: "a", title: "Design Systems Meetup", capacity: 120, seats_left: 120 }),
      publicListItem({ id: "b", title: "Open Studio Night", capacity: 40, seats_left: 1 }),
      publicListItem({ id: "c", title: "Accessible Forms Workshop", full: true, seats_left: 0 }),
      publicListItem({ id: "d", title: "Lightning Talks", has_started: true, seats_left: 5 }),
    ]);
    const [a, b, c, d] = cards();
    expectOnlyBadge(a, "120 of 120 seats left");
    expectOnlyBadge(b, "1 of 40 seats left");
    expectOnlyBadge(c, "Full");
    expectOnlyBadge(d, "Already started");
  });
});

describe("W-L4: empty list", () => {
  it('shows "No upcoming events." and no cards', async () => {
    await showList([]);
    expect(await main().findByText("No upcoming events.")).toBeTruthy();
    expect(cards()).toHaveLength(0);
    expect(main().queryByRole("list")).toBeNull();
  });
});

function Back() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => void navigate(-1)}>
      Back
    </button>
  );
}

describe("W-L8: an organizer is redirected to /organizer", () => {
  it("redirects without a list request and without showing the list", async () => {
    const fetch = mockFetch({
      [ME]: () => json(200, OLGA),
      [LIST]: () => json(200, { events: [publicListItem()] }),
      "GET /events": () => json(200, { events: [] }),
    });
    renderApp("/");
    await waitFor(() => expect(location()).toBe("/organizer"));
    expect(await screen.findByRole("heading", { level: 1, name: "Your events" })).toBeTruthy();
    expect(callsTo(fetch, LIST)).toBe(0);
    expect(screen.queryByText("Spring meetup")).toBeNull();
  });

  it("replaces / in the history, so Back does not return to it", async () => {
    mockFetch({
      [ME]: () => json(200, OLGA),
      [LIST]: () => json(200, { events: [] }),
      "GET /events": () => json(200, { events: [] }),
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/organizer/events/new", "/"]} initialIndex={1}>
          <App />
          <Back />
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(location()).toBe("/organizer"));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(location()).toBe("/organizer/events/new"));
  });
});

describe("W-L9: waits for me", () => {
  it('shows "Loading..." only while me loads: no list request, no redirect', async () => {
    const me = deferred<Response>();
    const fetch = mockFetch({
      [ME]: () => me.promise,
      [LIST]: () => json(200, { events: [publicListItem()] }),
    });
    renderApp("/");
    expect(main().getByRole("status").textContent).toBe("Loading...");
    expect(main().queryByRole("heading")).toBeNull();
    expect(cards()).toHaveLength(0);
    expect(callsTo(fetch, LIST)).toBe(0);
    expect(location()).toBe("/");

    await act(async () => {
      me.resolve(loggedOut());
    });
    expect(await main().findByRole("link", { name: "Spring meetup" })).toBeTruthy();
    expect(callsTo(fetch, LIST)).toBe(1);
  });

  it("me 401 means logged out: the list is shown", async () => {
    const fetch = await showList([publicListItem()], loggedOut);
    expect(main().getByRole("link", { name: "Spring meetup" })).toBeTruthy();
    expect(callsTo(fetch, LIST)).toBe(1);
  });

  it.each<[string, () => Response | Promise<Response>]>([
    ["5xx", () => json(500, { error: "internal" })],
    [
      "network error",
      () => {
        throw new TypeError("Failed to fetch");
      },
    ],
  ])("me %s: treated as logged out, the list is shown", async (_case, me) => {
    const fetch = await showList([publicListItem()], me);
    expect(main().getByRole("link", { name: "Spring meetup" })).toBeTruthy();
    expect(callsTo(fetch, LIST)).toBe(1);
    expect(location()).toBe("/");
  });
});

describe("W-L1: heading and cards in the API order", () => {
  it("shows one h1 Events and one card per event, not sorted by the client", async () => {
    const fetch = await showList([
      publicListItem({ id: "late", title: "Late", starts_at: "2031-05-01T10:00:00.000Z" }),
      publicListItem({ id: "early", title: "Early", starts_at: "2030-01-01T10:00:00.000Z" }),
      publicListItem({ id: "mid", title: "Middle", starts_at: "2030-06-01T10:00:00.000Z" }),
    ]);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const titles = cards().map((card) => within(card).getByRole("link").textContent);
    expect(titles).toEqual(["Late", "Early", "Middle"]);
    expect(callsTo(fetch, LIST)).toBe(1);
  });

  it("has no role word and no eyebrow in the content (RE1)", async () => {
    await showList([publicListItem()], () => json(200, ANN));
    expect(main().queryByText("Attendee")).toBeNull();
    expect(main().queryByText("Organizer")).toBeNull();
    expect(screen.getByRole("main").querySelector(".eyebrow")).toBeNull();
    expect(screen.getByRole("main").textContent?.startsWith("Events")).toBe(true);
  });
});

describe("W-L2, W-L11: card content", () => {
  it("shows the title link, start, duration and badge; no description, no end", async () => {
    const item = publicListItem({
      id: "e1",
      title: "Design Systems Meetup",
      starts_at: "2030-01-01T10:00:00.000Z",
      ends_at: "2030-01-01T11:30:00.000Z",
      duration_minutes: 90,
    });
    await showList([{ ...item, description: "A long description" }]);
    const [card] = cards();
    const links = within(card).getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0].textContent).toBe("Design Systems Meetup");
    expect(links[0].getAttribute("href")).toBe("/event/e1");
    // Browser time zone with the zone name (W-E19).
    expect(within(card).getByText(formatDateTime(item.starts_at))).toBeTruthy();
    expect(within(card).getByText(formatDuration(90))).toBeTruthy();
    expect(within(card).getByText("1 h 30 min")).toBeTruthy();
    expect(within(card).getByText("25 of 25 seats left")).toBeTruthy();
    expect(card.textContent).not.toContain(formatDateTime(item.ends_at));
    expect(card.textContent).not.toContain("A long description");
  });
});

describe("W-L5: loading and load error", () => {
  it('shows "Loading..." while the list loads', async () => {
    mockFetch({ [ME]: loggedOut, [LIST]: () => deferred<Response>().promise });
    renderApp("/");
    expect(await screen.findByRole("heading", { level: 1, name: "Events" })).toBeTruthy();
    expect(main().getByRole("status").textContent).toBe("Loading...");
    expect(cards()).toHaveLength(0);
  });

  it.each<[string, () => Response | Promise<Response>]>([
    ["5xx", () => json(500, { error: "internal" })],
    [
      "network error",
      () => {
        throw new TypeError("Failed to fetch");
      },
    ],
  ])("%s: an alert and Retry that refetches only the list", async (_case, failure) => {
    let calls = 0;
    const fetch = mockFetch({
      [ME]: loggedOut,
      [LIST]: () => {
        calls += 1;
        return calls === 1 ? failure() : json(200, { events: [publicListItem()] });
      },
    });
    renderApp("/");
    expect((await main().findByRole("alert")).textContent).toContain("Could not load events");
    expect(cards()).toHaveLength(0);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);

    fireEvent.click(main().getByRole("button", { name: "Retry" }));
    expect(await main().findByRole("link", { name: "Spring meetup" })).toBeTruthy();
    expect(main().queryByRole("alert")).toBeNull();
    expect(callsTo(fetch, LIST)).toBe(2);
    expect(callsTo(fetch, ME)).toBe(1);
  });
});

describe("W-L6, W-L7: logged out and attendee", () => {
  it("logged out: no login link in the content, the card opens /event/:id", async () => {
    mockFetch({
      [ME]: loggedOut,
      [LIST]: () => json(200, { events: [publicListItem({ id: "e1" })] }),
      "GET /public/events/e1": () => json(200, { ...publicListItem({ id: "e1" }), description: "" }),
    });
    renderApp("/");
    const link = await main().findByRole("link", { name: "Spring meetup" });
    expect(main().queryByRole("link", { name: /log in/i })).toBeNull();
    fireEvent.click(link);
    await waitFor(() => expect(location()).toBe("/event/e1"));
  });

  it("attendee: the same list, only the me and list requests", async () => {
    const fetch = await showList([publicListItem()], () => json(200, ANN));
    expect(main().getByRole("link", { name: "Spring meetup" })).toBeTruthy();
    expect(fetch.mock.calls).toHaveLength(2);
    expect(callsTo(fetch, ME)).toBe(1);
    expect(callsTo(fetch, LIST)).toBe(1);
  });
});

describe("W-L10: 401 or 403 from the list", () => {
  it.each([401, 403])("%s re-checks me and shows no error text", async (status) => {
    const fetch = mockFetch({
      [ME]: () => json(200, ANN),
      [LIST]: () => json(status, { error: "not_logged_in" }),
    });
    renderApp("/");
    await waitFor(() => expect(callsTo(fetch, ME)).toBe(2));
    expect(main().queryByRole("alert")).toBeNull();
    expect(main().queryByText(/Could not load events/)).toBeNull();
    expect(main().queryByRole("button", { name: "Retry" })).toBeNull();
  });
});

describe("W-L12: accessibility", () => {
  it("is a list of cards, not a table; the badge is text", async () => {
    await showList([publicListItem({ full: true, seats_left: 0 })]);
    expect(main().getByRole("list").tagName).toBe("UL");
    expect(cards()[0].tagName).toBe("LI");
    expect(main().queryByRole("table")).toBeNull();
    expect(within(cards()[0]).getByText("Full")).toBeTruthy();
  });
});

describe("W-L13: no refetch on window focus", () => {
  it("does not refetch the list when the window gets focus", async () => {
    const fetch = await showList([publicListItem()]);
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(callsTo(fetch, LIST)).toBe(1);
    focusManager.setFocused(undefined);
  });
});
