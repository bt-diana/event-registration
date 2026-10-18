// Tests first (registration-web.md): the attendee list on /registrations/me without
// `event`. W-R39 empty, W-R18 rows in the API order with their content and the one card
// link to the ticket page (no title link, no "View ticket", no /event link), W-R40
// (cancelled event, ended event, cancelled registration, two rows of one event), W-R41
// (no request before me, for logged-out viewers and organizers; 401 and 403), W-R19
// (cache per account); then loading, error with Retry and W-R22.
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { ME_KEY } from "../auth/session";
import { ANN, OLGA, callsTo, deferred, json, mockFetch, renderApp } from "../auth/test-helpers";
import { formatDateTime } from "../events/format";
import { EVENT_ID, publicEvent } from "../events/test-helpers";
import {
  BEN,
  MY_REGISTRATION,
  MY_REGISTRATIONS,
  myRegistration,
  type SampleMyRegistration,
} from "./test-helpers";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Handler = () => Response | Promise<Response>;

const ME = "GET /auth/me";
const EVENTS = "GET /events";
const PATH = "/registrations/me";
const loggedOut = () => json(401, { error: "not_logged_in" });
const list = (...registrations: SampleMyRegistration[]): Handler => () =>
  json(200, { registrations });

// The four cards of the S3 board, newest registration first (MR9). The starts are not in
// date order, so a client-side sort would show up.
const SPRING = myRegistration({
  id: "a1000000-0000-4000-8000-000000000001",
  event_id: EVENT_ID,
  event_title: "Spring Meetup",
  event_starts_at: "2030-01-01T10:00:00.000Z",
  ticket_code: "K7M2QX9TPA",
});
const AUTUMN = myRegistration({
  id: "a1000000-0000-4000-8000-000000000002",
  event_id: "e2000000-0000-4000-8000-000000000002",
  event_title: "Autumn Fair",
  event_starts_at: "2030-09-20T08:00:00.000Z",
  status: "waitlisted",
  waitlist_position: 3,
  ticket_code: "H4Z8WR5NCD",
});
const OLD_TALK = myRegistration({
  id: "a1000000-0000-4000-8000-000000000003",
  event_id: "e3000000-0000-4000-8000-000000000003",
  event_title: "Old Talk",
  event_starts_at: "2026-03-05T17:00:00.000Z",
  status: "cancelled",
  event_status: "passed",
  ticket_code: "M3N4P5Q6R7",
});
const WINTER = myRegistration({
  id: "a1000000-0000-4000-8000-000000000004",
  event_id: "e4000000-0000-4000-8000-000000000004",
  event_title: "Winter Quiz",
  event_starts_at: "2029-12-12T18:30:00.000Z",
  event_status: "cancelled",
  ticket_code: "S8T9U2V3W4",
});
const ALL = [SPRING, AUTUMN, OLD_TALK, WINTER];

function main() {
  return within(screen.getByRole("main"));
}

function location(): string | null {
  return screen.getByTestId("location").textContent;
}

function rows(): HTMLElement[] {
  return main().queryAllByRole("listitem");
}

function badges(row: HTMLElement): string[] {
  return [...row.querySelectorAll(".badge")].map((badge) => badge.textContent ?? "");
}

function rowOf(title: string): HTMLElement {
  const row = main().getByText(title).closest("li");
  if (!row) throw new Error(`No row for ${title}`);
  return row;
}

const ticketHref = (eventId: string) => `/registrations/me?event=${eventId}`;

// The row's only link (W-R18: the whole card is one link).
function cardLink(row: HTMLElement): HTMLElement {
  const links = within(row).getAllByRole("link");
  expect(links).toHaveLength(1);
  return links[0];
}

// A link whose accessible name holds every part (title, start, status texts).
const named = (...parts: string[]) => (name: string) => parts.every((part) => name.includes(part));

// The title is plain text inside the card link.
function titleOf(row: HTMLElement): string | null {
  return row.querySelector(".registration-card-title")?.textContent ?? null;
}

// No link to an event page anywhere on the list.
function eventPageLinks(): Element[] {
  return [...screen.getByRole("main").querySelectorAll('a[href^="/event/"]')];
}

// me answers each value in turn, then keeps the last one.
function sequence(...answers: Handler[]): Handler {
  let n = 0;
  return () => answers[Math.min(n++, answers.length - 1)]();
}

// An attendee on the list, once the list has answered.
async function attendeeList(answer: Handler, extra: Record<string, Handler> = {}, path = PATH) {
  const fetch = mockFetch({ [ME]: () => json(200, ANN), [MY_REGISTRATIONS]: answer, ...extra });
  const rendered = renderApp(path);
  await waitFor(() => expect(callsTo(fetch, MY_REGISTRATIONS)).toBe(1));
  await waitFor(() => expect(main().queryByText("Loading...")).toBeNull());
  return { fetch, ...rendered };
}

describe("W-R39: empty list", () => {
  it("shows You have no registrations yet. and Go home, after one list request", async () => {
    const { fetch } = await attendeeList(list());
    expect(main().getByRole("heading", { level: 1, name: "My registrations" })).toBeTruthy();
    expect(main().getByText("You have no registrations yet.")).toBeTruthy();
    expect(main().getByRole("link", { name: "Go home" }).getAttribute("href")).toBe("/");
    expect(main().queryByRole("list")).toBeNull();
    expect(callsTo(fetch, MY_REGISTRATIONS)).toBe(1);
    expect(main().queryByText("The list is not built yet.")).toBeNull();
  });
});

describe("W-R18: one row per registration, in the API order", () => {
  it("one GET /me/registrations with no query and no body; rows as the API sends them", async () => {
    const { fetch } = await attendeeList(list(...ALL));
    expect(rows()).toHaveLength(4);
    expect(rows().map(titleOf)).toEqual([
      "Spring Meetup",
      "Autumn Fair",
      "Old Talk",
      "Winter Quiz",
    ]);
    expect(callsTo(fetch, ME)).toBe(1);
    expect(callsTo(fetch, MY_REGISTRATIONS)).toBe(1);
    expect(fetch.mock.calls).toHaveLength(2);
    const call = fetch.mock.calls.find(([input]) => String(input).startsWith("/me/"));
    expect(String(call?.[0])).toBe("/me/registrations");
    expect(call?.[1]?.method ?? "GET").toBe("GET");
    expect(call?.[1]?.body).toBeUndefined();
  });

  it("also without a value for event (?event=)", async () => {
    await attendeeList(list(SPRING), {}, `${PATH}?event=`);
    expect(main().getByRole("heading", { level: 1, name: "My registrations" })).toBeTruthy();
    expect(rows()).toHaveLength(1);
  });

  it("a row is one card link to the ticket page: plain title, the start, the status badge", async () => {
    await attendeeList(list(...ALL));
    const row = rowOf("Spring Meetup");
    const link = cardLink(row);
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe(ticketHref(EVENT_ID));
    // The whole card is the link: the li holds only the anchor.
    expect([...row.children]).toEqual([link]);
    const title = within(link).getByText("Spring Meetup");
    expect(title.closest("a")).toBe(link);
    expect(title.tagName).not.toBe("A");
    const start = within(link).getByText(formatDateTime(SPRING.event_starts_at));
    const badge = within(link).getByText("Registered");
    expect(badges(row)).toEqual(["Registered"]);
    // In this order in the card.
    for (const [before, after] of [
      [title, start],
      [start, badge],
    ]) {
      expect(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("the card link's accessible name holds the title, the start and the status text", async () => {
    await attendeeList(list(...ALL));
    for (const [item, status] of [
      [SPRING, ["Registered"]],
      [AUTUMN, ["Waiting list: place 3"]],
      [OLD_TALK, ["Cancelled", "Ended"]],
      [WINTER, ["Registered", "Event cancelled"]],
    ] as const) {
      const row = rowOf(item.event_title);
      const name = named(item.event_title, formatDateTime(item.event_starts_at), ...status);
      expect(within(row).getByRole("link", { name })).toBe(cardLink(row));
    }
  });

  it("nothing interactive inside the card link; the badges are plain spans", async () => {
    await attendeeList(list(...ALL));
    for (const row of rows()) {
      const link = cardLink(row);
      expect(link.querySelectorAll("a, button, input, select, textarea, [tabindex]")).toHaveLength(0);
      const inside = [...link.querySelectorAll(".badge")];
      expect(inside.length).toBeGreaterThan(0);
      expect(inside.every((badge) => badge.tagName === "SPAN")).toBe(true);
    }
  });

  it('no "View ticket" and no link to /event/{id} anywhere on the list', async () => {
    await attendeeList(list(...ALL));
    expect(main().queryByText("View ticket")).toBeNull();
    expect(main().queryByRole("link", { name: "View ticket" })).toBeNull();
    expect(eventPageLinks()).toEqual([]);
    expect(main().getAllByRole("link")).toHaveLength(ALL.length);
  });

  it("a waiting row reads Waiting list: place 3", async () => {
    await attendeeList(list(...ALL));
    expect(badges(rowOf("Autumn Fair"))).toEqual(["Waiting list: place 3"]);
  });

  it("no ticket code on the list", async () => {
    await attendeeList(list(...ALL));
    for (const item of ALL) expect(main().queryByText(item.ticket_code)).toBeNull();
    expect(main().queryByText("Ticket code")).toBeNull();
  });
});

describe("W-R40: event status and cancelled rows", () => {
  it.each<[string, Partial<SampleMyRegistration>, string[]]>([
    ["registered, active event", {}, ["Registered"]],
    ["registered, cancelled event", { event_status: "cancelled" }, ["Registered", "Event cancelled"]],
    ["registered, ended event", { event_status: "passed" }, ["Registered", "Ended"]],
    [
      "waitlisted, ended event",
      { status: "waitlisted", waitlist_position: 1, event_status: "passed" },
      ["Waiting list: place 1", "Ended"],
    ],
    ["cancelled, active event", { status: "cancelled" }, ["Cancelled"]],
    ["cancelled, ended event", { status: "cancelled", event_status: "passed" }, ["Cancelled", "Ended"]],
    [
      "cancelled, cancelled event",
      { status: "cancelled", event_status: "cancelled" },
      ["Cancelled", "Event cancelled"],
    ],
  ])("%s: the row's badges", async (_case, overrides, expected) => {
    await attendeeList(list(myRegistration({ event_title: "Spring Meetup", ...overrides })));
    expect(badges(rowOf("Spring Meetup"))).toEqual(expected);
  });

  it("the S3 cards: Winter Quiz is Registered + Event cancelled, Old Talk Cancelled + Ended", async () => {
    await attendeeList(list(...ALL));
    expect(badges(rowOf("Winter Quiz"))).toEqual(["Registered", "Event cancelled"]);
    expect(badges(rowOf("Old Talk"))).toEqual(["Cancelled", "Ended"]);
  });

  it("a cancelled registration has no place and no not-valid line, and its card link works", async () => {
    await attendeeList(list(...ALL));
    const row = rowOf("Old Talk");
    expect(within(row).queryByText(/place/i)).toBeNull();
    expect(within(row).queryByText("This ticket is no longer valid.")).toBeNull();
    expect(cardLink(row).getAttribute("href")).toBe(ticketHref(OLD_TALK.event_id));
    expect(eventPageLinks()).toEqual([]);
  });

  it("the card link to the ticket page is on every row, whatever the statuses", async () => {
    await attendeeList(list(...ALL));
    expect(rows().map((row) => cardLink(row).getAttribute("href"))).toEqual(
      ALL.map((item) => ticketHref(item.event_id)),
    );
  });

  it("two rows of one event (cancelled, then a new one) are two rows with the same link target", async () => {
    const error = vi.spyOn(console, "error");
    const again = myRegistration({
      id: "b2000000-0000-4000-8000-000000000002",
      event_title: "Spring Meetup",
      ticket_code: "Z9Y8X7W6V5",
    });
    const old = myRegistration({
      id: "b1000000-0000-4000-8000-000000000001",
      event_title: "Spring Meetup",
      status: "cancelled",
      ticket_code: "K7M2QX9TPA",
    });
    await attendeeList(list(again, old));
    expect(rows()).toHaveLength(2);
    expect(rows().map(badges)).toEqual([["Registered"], ["Cancelled"]]);
    for (const row of rows()) {
      expect(cardLink(row).getAttribute("href")).toBe(ticketHref(EVENT_ID));
    }
    // Told apart by the status in the link name (W-R22).
    expect(main().getByRole("link", { name: named("Spring Meetup", "Registered") })).toBe(
      cardLink(rows()[0]),
    );
    expect(main().getByRole("link", { name: named("Spring Meetup", "Cancelled") })).toBe(
      cardLink(rows()[1]),
    );
    // The rows are keyed by the registration id, not by the event (no duplicate key).
    expect(error.mock.calls.some((call) => String(call[0]).includes("same key"))).toBe(false);
  });
});

// Tests first (registration-web.md W-R42): a registered row that is checked in reads
// "Checked in" instead of "Registered"; the event badge (W-R40) still follows it; a
// cancelled row never reads "Checked in" (mocked data, the table CHECK forbids it).
describe("W-R42: the Checked in badge on the list", () => {
  const AT = "2030-01-01T09:55:00.000Z";

  it('a checked-in row shows "Checked in", no "Registered", and the link name holds it', async () => {
    const used = { ...SPRING, checked_in_at: AT };
    await attendeeList(list(used));
    const row = rowOf("Spring Meetup");
    expect(badges(row)).toEqual(["Checked in"]);
    expect(within(row).queryByText("Registered")).toBeNull();
    const name = named("Spring Meetup", formatDateTime(SPRING.event_starts_at), "Checked in");
    expect(within(row).getByRole("link", { name })).toBe(cardLink(row));
    expect(cardLink(row).getAttribute("href")).toBe(ticketHref(EVENT_ID));
  });

  it("not checked in: the row still reads Registered", async () => {
    await attendeeList(list({ ...SPRING, checked_in_at: null }));
    expect(badges(rowOf("Spring Meetup"))).toEqual(["Registered"]);
    expect(main().queryByText("Checked in")).toBeNull();
  });

  it("a checked-in row of a cancelled event: Checked in, then Event cancelled", async () => {
    await attendeeList(list({ ...WINTER, checked_in_at: AT }));
    const row = rowOf("Winter Quiz");
    expect(badges(row)).toEqual(["Checked in", "Event cancelled"]);
    const start = formatDateTime(WINTER.event_starts_at);
    const name = named("Winter Quiz", start, "Checked in", "Event cancelled");
    expect(within(row).getByRole("link", { name })).toBe(cardLink(row));
  });

  it.each<[string, Partial<SampleMyRegistration>, string[]]>([
    ["cancelled", { status: "cancelled" }, ["Cancelled"]],
    ["waitlisted", { status: "waitlisted", waitlist_position: 3 }, ["Waiting list: place 3"]],
  ])("a %s row with checked_in_at set keeps its own badge", async (_case, overrides, expected) => {
    await attendeeList(
      list(myRegistration({ event_title: "Spring Meetup", checked_in_at: AT, ...overrides })),
    );
    expect(badges(rowOf("Spring Meetup"))).toEqual(expected);
    expect(main().queryByText("Checked in")).toBeNull();
  });
});

describe("W-R41: request and 401 rules", () => {
  it("no list request while me loads; one once me is a known attendee", async () => {
    const me = deferred<Response>();
    const fetch = mockFetch({ [ME]: () => me.promise, [MY_REGISTRATIONS]: list(SPRING) });
    renderApp(PATH);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(main().getByRole("status").textContent).toBe("Loading...");
    expect(callsTo(fetch, MY_REGISTRATIONS)).toBe(0);
    await act(async () => me.resolve(json(200, ANN)));
    expect(await main().findByRole("link", { name: named("Spring Meetup") })).toBeTruthy();
    expect(callsTo(fetch, MY_REGISTRATIONS)).toBe(1);
  });

  it("logged out: no list request, redirect to the login", async () => {
    const fetch = mockFetch({ [ME]: loggedOut, [MY_REGISTRATIONS]: list(SPRING) });
    renderApp(PATH);
    await waitFor(() => expect(location()).toBe("/login?next=%2Fregistrations%2Fme"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(callsTo(fetch, MY_REGISTRATIONS)).toBe(0);
  });

  it("an organizer: no list request, redirect to /registrations", async () => {
    const fetch = mockFetch({
      [ME]: () => json(200, OLGA),
      [EVENTS]: () => json(200, { events: [] }),
      [MY_REGISTRATIONS]: list(SPRING),
    });
    renderApp(PATH);
    await waitFor(() => expect(location()).toBe("/registrations"));
    expect(await main().findByRole("heading", { level: 1, name: "Registrations" })).toBeTruthy();
    expect(callsTo(fetch, MY_REGISTRATIONS)).toBe(0);
  });

  it("401: me is checked again, no text of its own, then the login with next", async () => {
    const fetch = mockFetch({
      [ME]: sequence(() => json(200, ANN), loggedOut),
      [MY_REGISTRATIONS]: loggedOut,
    });
    renderApp(PATH);
    await waitFor(() => expect(location()).toBe("/login?next=%2Fregistrations%2Fme"));
    expect(screen.queryByText("Could not load your registrations")).toBeNull();
    expect(callsTo(fetch, ME)).toBe(2);
    expect(callsTo(fetch, MY_REGISTRATIONS)).toBe(1);
  });

  it("401: while me is read again the screen shows only Loading...", async () => {
    const second = deferred<Response>();
    const fetch = mockFetch({
      [ME]: sequence(() => json(200, ANN), () => second.promise),
      [MY_REGISTRATIONS]: loggedOut,
    });
    renderApp(PATH);
    await waitFor(() => expect(callsTo(fetch, ME)).toBe(2));
    expect(main().getByRole("status").textContent).toBe("Loading...");
    expect(main().queryByRole("alert")).toBeNull();
    expect(main().queryByRole("button", { name: "Retry" })).toBeNull();
    await act(async () => second.resolve(loggedOut()));
    await waitFor(() => expect(location()).toBe("/login?next=%2Fregistrations%2Fme"));
  });

  it("403: me is checked again; an organizer goes to /registrations", async () => {
    const fetch = mockFetch({
      [ME]: sequence(() => json(200, ANN), () => json(200, OLGA)),
      [MY_REGISTRATIONS]: () => json(403, { error: "wrong_role" }),
      [EVENTS]: () => json(200, { events: [] }),
    });
    renderApp(PATH);
    await waitFor(() => expect(location()).toBe("/registrations"));
    expect(screen.queryByText("Could not load your registrations")).toBeNull();
    expect(callsTo(fetch, ME)).toBe(2);
    expect(callsTo(fetch, MY_REGISTRATIONS)).toBe(1);
  });
});

describe("W-R19: the list is cached per account", () => {
  it("account A, then B in the same tab: no row of A, the list is read again", async () => {
    const ben = deferred<Response>();
    let n = 0;
    const { fetch, queryClient } = await attendeeList(() =>
      n++ === 0 ? json(200, { registrations: ALL }) : ben.promise,
    );
    expect(rows()).toHaveLength(4);

    act(() => {
      queryClient.setQueryData(ME_KEY, BEN);
    });
    await waitFor(() => expect(callsTo(fetch, MY_REGISTRATIONS)).toBe(2));
    for (const item of ALL) expect(main().queryByText(item.event_title)).toBeNull();
    expect(main().getByRole("status").textContent).toBe("Loading...");

    const bens = myRegistration({ id: "c1000000-0000-4000-8000-000000000001", event_title: "Ben's Event" });
    await act(async () => ben.resolve(json(200, { registrations: [bens] })));
    expect(await main().findByRole("link", { name: named("Ben's Event") })).toBeTruthy();
    expect(rows()).toHaveLength(1);
    for (const item of ALL) expect(main().queryByText(item.event_title)).toBeNull();
    // The web sends no user id: the same path, no query, no body, for both accounts.
    const calls = fetch.mock.calls.filter(([input]) => String(input).startsWith("/me/"));
    expect(calls.map(([input]) => String(input))).toEqual(["/me/registrations", "/me/registrations"]);
    expect(calls.every(([, init]) => init?.body === undefined)).toBe(true);
    expect(queryClient.getQueryData(["registrations", BEN.id])).toEqual([bens]);
  });

  it("opening the screen again reads the list again (staleTime 0)", async () => {
    const { fetch } = await attendeeList(list(SPRING), {
      [`GET /public/events/${EVENT_ID}`]: () => json(200, publicEvent({ title: "Spring Meetup" })),
      [MY_REGISTRATION]: () => json(200, SPRING),
    });
    // A click on the card opens the ticket page, not the event page.
    fireEvent.click(cardLink(rowOf("Spring Meetup")));
    expect(await main().findByRole("heading", { level: 1, name: "Your ticket" })).toBeTruthy();
    expect(location()).toBe(ticketHref(EVENT_ID));
    fireEvent.click(within(screen.getByRole("banner")).getByRole("link", { name: "My registrations" }));
    expect(await main().findByRole("heading", { level: 1, name: "My registrations" })).toBeTruthy();
    await waitFor(() => expect(callsTo(fetch, MY_REGISTRATIONS)).toBe(2));
  });
});

describe("W-R39: loading and error", () => {
  it('loading: "Loading..." until the answer comes, no rows and no empty text', async () => {
    const answer = deferred<Response>();
    const fetch = mockFetch({ [ME]: () => json(200, ANN), [MY_REGISTRATIONS]: () => answer.promise });
    renderApp(PATH);
    await waitFor(() => expect(callsTo(fetch, MY_REGISTRATIONS)).toBe(1));
    expect(main().getByRole("heading", { level: 1, name: "My registrations" })).toBeTruthy();
    expect(main().getByRole("status").textContent).toBe("Loading...");
    expect(rows()).toEqual([]);
    expect(main().queryByText("You have no registrations yet.")).toBeNull();
    await act(async () => answer.resolve(json(200, { registrations: [SPRING] })));
    expect(await main().findByRole("link", { name: named("Spring Meetup") })).toBeTruthy();
    expect(main().queryByRole("status")).toBeNull();
  });

  it.each<[string, Handler]>([
    ["5xx", () => json(500, { error: "internal" })],
    [
      "network error",
      () => {
        throw new TypeError("Failed to fetch");
      },
    ],
  ])("%s: Could not load your registrations and Retry, which reads only the list", async (_case, failure) => {
    let n = 0;
    const { fetch } = await attendeeList(() => (n++ === 0 ? failure() : json(200, { registrations: [SPRING] })));
    expect(main().getByRole("alert").textContent).toBe("Could not load your registrations");
    expect(rows()).toEqual([]);
    expect(main().queryByText("You have no registrations yet.")).toBeNull();
    fireEvent.click(main().getByRole("button", { name: "Retry" }));
    expect(await main().findByRole("link", { name: named("Spring Meetup") })).toBeTruthy();
    expect(main().queryByRole("alert")).toBeNull();
    expect(callsTo(fetch, MY_REGISTRATIONS)).toBe(2);
    expect(callsTo(fetch, ME)).toBe(1);
  });
});

describe("W-R22: accessibility", () => {
  it("one h1, a ul with one li per registration, no role eyebrow, links with text", async () => {
    await attendeeList(list(...ALL));
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const ul = main().getByRole("list");
    expect(ul.tagName).toBe("UL");
    expect(within(ul).getAllByRole("listitem")).toHaveLength(4);
    expect(main().queryByText(/Attendee|Organizer/)).toBeNull();
    for (const link of main().getAllByRole("link")) {
      expect(link.textContent?.trim()).not.toBe("");
    }
  });
});

// cancel-registration-web.md W-CR9 (regression): after a cancel the list row reads
// "Cancelled" on its next read and keeps its link to the ticket page (W-R40). The list
// itself has no cancel control.
describe("W-CR9: the list after a cancel", () => {
  it("the row from GET /me/registrations shows Cancelled, keeps its link, has no button", async () => {
    await attendeeList(list(myRegistration({ ...SPRING, status: "cancelled" })));
    const row = rowOf("Spring Meetup");
    expect(badges(row)).toEqual(["Cancelled"]);
    expect(cardLink(row).getAttribute("href")).toBe(ticketHref(EVENT_ID));
    expect(main().queryByRole("button", { name: /cancel/i })).toBeNull();
  });
});
