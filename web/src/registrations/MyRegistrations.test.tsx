// Tests first (registration-web.md): the attendee list on /registrations/me without
// `event`. W-R39 empty, W-R18 rows in the API order with their content and links, W-R40
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
  const row = main().getByRole("link", { name: title }).closest("li");
  if (!row) throw new Error(`No row for ${title}`);
  return row;
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
    expect(rows().map((row) => within(row).getAllByRole("link")[0].textContent)).toEqual([
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

  it("a row: the title links to the event, the start, the status badge, View ticket", async () => {
    await attendeeList(list(...ALL));
    const row = rowOf("Spring Meetup");
    const title = within(row).getByRole("link", { name: "Spring Meetup" });
    expect(title.getAttribute("href")).toBe(`/event/${EVENT_ID}`);
    const start = within(row).getByText(formatDateTime(SPRING.event_starts_at));
    const badge = within(row).getByText("Registered");
    const ticket = within(row).getByRole("link", { name: "View ticket" });
    expect(ticket.getAttribute("href")).toBe(`/registrations/me?event=${EVENT_ID}`);
    expect(badges(row)).toEqual(["Registered"]);
    // In this order in the row.
    for (const [before, after] of [
      [title, start],
      [start, badge],
      [badge, ticket],
    ]) {
      expect(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
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

  it("a cancelled registration has no place and no not-valid line, and its links work", async () => {
    await attendeeList(list(...ALL));
    const row = rowOf("Old Talk");
    expect(within(row).queryByText(/place/i)).toBeNull();
    expect(within(row).queryByText("This ticket is no longer valid.")).toBeNull();
    expect(within(row).getByRole("link", { name: "Old Talk" }).getAttribute("href")).toBe(
      `/event/${OLD_TALK.event_id}`,
    );
    expect(within(row).getByRole("link", { name: "View ticket" }).getAttribute("href")).toBe(
      `/registrations/me?event=${OLD_TALK.event_id}`,
    );
  });

  it("View ticket is on every row, whatever the statuses", async () => {
    await attendeeList(list(...ALL));
    for (const row of rows()) {
      expect(within(row).getAllByRole("link", { name: "View ticket" })).toHaveLength(1);
    }
  });

  it("two rows of one event (cancelled, then a new one) are two rows with the same links", async () => {
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
      expect(within(row).getByRole("link", { name: "Spring Meetup" }).getAttribute("href")).toBe(
        `/event/${EVENT_ID}`,
      );
      expect(within(row).getByRole("link", { name: "View ticket" }).getAttribute("href")).toBe(
        `/registrations/me?event=${EVENT_ID}`,
      );
    }
    // The rows are keyed by the registration id, not by the event (no duplicate key).
    expect(error.mock.calls.some((call) => String(call[0]).includes("same key"))).toBe(false);
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
    expect(await main().findByRole("link", { name: "Spring Meetup" })).toBeTruthy();
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
    expect(await main().findByRole("link", { name: "Ben's Event" })).toBeTruthy();
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
    fireEvent.click(main().getByRole("link", { name: "Spring Meetup" }));
    expect(await main().findByRole("heading", { level: 1, name: "Spring Meetup" })).toBeTruthy();
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
    expect(await main().findByRole("link", { name: "Spring Meetup" })).toBeTruthy();
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
    expect(await main().findByRole("link", { name: "Spring Meetup" })).toBeTruthy();
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
