// Tests first (checkin-web.md): W-C6 nothing runs by itself, W-C8 one arrivals request
// per visit, W-C9 401, 403 and 404, W-C11 a check-in is counted once and only from the
// server, W-C13 a refetch keeps the numbers, W-C15 cache by account. Then W-C1, W-C2,
// W-C3, W-C4, W-C5, W-C10, W-C12, W-C14, W-C18. The counter is read through the real
// screens (renderApp) with one QueryClient kept across navigation; fetch is mocked and
// its call counts prove the request numbers. The five reads of one code (W-C11) and the
// camera states (W-C3) are in ScanScreen.test.tsx, which mocks the camera.
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { ANN, OLGA, callsTo, deferred, json, mockFetch, renderApp } from "../auth/test-helpers";
import { EVENT_ID, organizerEvent } from "../events/test-helpers";
import {
  SECOND_EVENT_ID,
  arrivals,
  eventArrivals,
  eventRegistrations,
  organizerRegistration,
  wholeText,
} from "./test-helpers";

type Handler = () => Response | Promise<Response>;

const ME = "GET /auth/me";
const EVENTS = "GET /events";
const CHECKIN = "POST /checkin";
const ARRIVALS = eventArrivals(EVENT_ID);
const SECOND_ARRIVALS = eventArrivals(SECOND_EVENT_ID);
const LIST = eventRegistrations(EVENT_ID);
const SCAN = `/registrations/scan?event=${EVENT_ID}`;
const LIST_PAGE = `/registrations?event=${EVENT_ID}`;
const CODE = "K7M2QX9TPA";

const EVENT_LIST = {
  events: [organizerEvent(), organizerEvent({ id: SECOND_EVENT_ID, title: "Autumn fair" })],
};

const CHECKED_IN = {
  registration_id: "9c8b7a6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d",
  ticket_code: CODE,
  event_id: EVENT_ID,
  event_title: "Spring meetup",
  attendee_name: "Ann Lee",
  checked_in_at: "2030-01-01T09:55:00.000Z",
};

const OTTO = {
  ...OLGA,
  id: "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f",
  email: "otto@mail.com",
  name: "Otto",
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ok = (body: unknown): Handler => () => json(200, body);
const failed: Handler = () => json(500, { error: "internal" });

// Answers in turn; the last one repeats.
function answers(...list: Handler[]): Handler {
  let n = 0;
  return () => list[Math.min(n++, list.length - 1)]();
}

function main() {
  return within(screen.getByRole("main"));
}

function location(): string | null {
  return screen.getByTestId("location").textContent;
}

function counter(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".arrivals");
}

function count(arrived: number, registered: number): string {
  return `Arrived: ${arrived} / ${registered} registered`;
}

function shows(text: string) {
  return main().findByText(wholeText(text));
}

function showing(text: string): HTMLElement | null {
  return main().queryByText(wholeText(text));
}

function listRequests(fetch: ReturnType<typeof mockFetch>): number {
  return fetch.mock.calls.filter(([input]) => String(input).endsWith("/registrations")).length;
}

function app(path: string, routes: Record<string, Handler>) {
  const fetch = mockFetch({ [ME]: ok(OLGA), [EVENTS]: ok(EVENT_LIST), ...routes });
  return { fetch, ...renderApp(path) };
}

function typeCode(code = CODE) {
  fireEvent.change(main().getByLabelText("Ticket code"), { target: { value: code } });
  fireEvent.click(main().getByRole("button", { name: "Check in" }));
}

// Scan screen link: back to the registrations page (the first event is chosen).
function goToList() {
  fireEvent.click(main().getByRole("link", { name: "Registrations" }));
}

function goToScan() {
  fireEvent.click(main().getByRole("link", { name: "Check in attendees" }));
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

function setVisibility(value: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { value, configurable: true });
}

// A minute passes, the tab is hidden and shown again, the window gets the focus, and the
// network goes away and comes back. Fake timers must be on.
async function leaveItAlone() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  await act(async () => {
    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(5_000);
  });
}

describe("W-C6: nothing runs by itself (test first)", () => {
  it("registrations page: one arrivals and one list request, none after a wait, a hidden tab or a reconnect", async () => {
    const { fetch } = app(LIST_PAGE, {
      [ARRIVALS]: ok(arrivals(11, 20)),
      [LIST]: ok({ registrations: [organizerRegistration()] }),
    });
    await shows(count(11, 20));
    await main().findByText("Olga Test");
    expect(callsTo(fetch, ARRIVALS)).toBe(1);
    expect(callsTo(fetch, LIST)).toBe(1);

    vi.useFakeTimers();
    await leaveItAlone();
    vi.useRealTimers();

    expect(callsTo(fetch, ARRIVALS)).toBe(1);
    expect(callsTo(fetch, LIST)).toBe(1);
    expect(showing(count(11, 20))).not.toBeNull();
  });

  it("scan screen: one arrivals request, no list request, none after a wait, a hidden tab or a reconnect", async () => {
    const { fetch } = app(SCAN, { [ARRIVALS]: ok(arrivals(11, 20)) });
    await shows(count(11, 20));
    expect(callsTo(fetch, ARRIVALS)).toBe(1);

    vi.useFakeTimers();
    await leaveItAlone();
    vi.useRealTimers();

    expect(callsTo(fetch, ARRIVALS)).toBe(1);
    expect(listRequests(fetch)).toBe(0);
  });
});

describe("W-C8: every visit reads the arrivals again (test first)", () => {
  it("scan screen, registrations page, scan screen: one request per visit, the newest numbers shown", async () => {
    const { fetch } = app(SCAN, {
      [ARRIVALS]: answers(ok(arrivals(11, 20)), ok(arrivals(12, 20)), ok(arrivals(13, 20))),
      [LIST]: ok({ registrations: [] }),
    });
    await shows(count(11, 20));
    expect(callsTo(fetch, ARRIVALS)).toBe(1);

    goToList();
    await shows(count(12, 20));
    expect(callsTo(fetch, ARRIVALS)).toBe(2);

    goToScan();
    await shows(count(13, 20));
    expect(callsTo(fetch, ARRIVALS)).toBe(3);
    expect(location()).toBe(SCAN);
  });
});

describe("W-C9: terminal errors (test first)", () => {
  it("401: me is read again, the counter shows no text of its own, the guard sends to the login", async () => {
    let first = true;
    const meAgain = deferred<Response>();
    const { fetch } = app(SCAN, {
      [ME]: () => {
        if (first) {
          first = false;
          return json(200, OLGA);
        }
        return meAgain.promise;
      },
      [ARRIVALS]: () => json(401, { error: "not_logged_in" }),
    });
    await waitFor(() => expect(callsTo(fetch, ME)).toBe(2));
    expect(screen.queryByText("Could not load arrivals")).toBeNull();
    expect(screen.queryByText("Loading arrivals...")).toBeNull();
    expect(counter()).toBeNull();
    await act(async () => meAgain.resolve(json(401, { error: "not_logged_in" })));
    await waitFor(() => expect(location()).toMatch(/^\/organizer\/login\?next=/));
    expect(screen.queryByText("Could not load arrivals")).toBeNull();
    expect(callsTo(fetch, ARRIVALS)).toBe(1);
  });

  it("403: me is read again; an attendee is sent to /registrations/me", async () => {
    let first = true;
    const { fetch } = app(SCAN, {
      [ME]: () => {
        if (first) {
          first = false;
          return json(200, OLGA);
        }
        return json(200, ANN);
      },
      [ARRIVALS]: () => json(403, { error: "wrong_role" }),
    });
    await waitFor(() => expect(location()).toBe("/registrations/me"));
    expect(screen.queryByText("Could not load arrivals")).toBeNull();
    expect(counter()).toBeNull();
    expect(callsTo(fetch, ME)).toBe(2);
  });

  it("404 on the scan screen: Event not found, once, no number and no retry", async () => {
    const { fetch } = app(SCAN, { [ARRIVALS]: () => json(404, { error: "not_found" }) });
    expect(await main().findByText("Event not found")).toBeTruthy();
    await settle();
    expect(main().getAllByText("Event not found")).toHaveLength(1);
    expect(main().queryByText(/Arrived:/)).toBeNull();
    expect(main().getByLabelText("Event")).toBeTruthy();
    expect(callsTo(fetch, ARRIVALS)).toBe(1);
  });

  it("404 on the registrations page (both routes): the page shows Event not found once", async () => {
    const { fetch } = app(LIST_PAGE, {
      [ARRIVALS]: () => json(404, { error: "not_found" }),
      [LIST]: () => json(404, { error: "not_found" }),
    });
    await waitFor(() => expect(callsTo(fetch, LIST)).toBe(1));
    await main().findByText("This link is not valid or the event does not exist.");
    await settle();
    expect(main().getAllByText("Event not found")).toHaveLength(1);
    expect(main().queryByText(/Arrived:/)).toBeNull();
  });
});

describe("W-C11: a check-in is counted once, from the server only (test first)", () => {
  it("a 200 check-in reads the arrivals once more; no local +1; the organizer stays; the list is not read", async () => {
    const next = deferred<Response>();
    const { fetch, queryClient } = app(SCAN, {
      [ARRIVALS]: answers(ok(arrivals(11, 20)), () => next.promise),
      [CHECKIN]: ok(CHECKED_IN),
    });
    await shows(count(11, 20));
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    typeCode();
    await main().findByRole("heading", { name: "Checked in" });
    await waitFor(() => expect(callsTo(fetch, ARRIVALS)).toBe(2));
    // The text changes only when the route answers, and the refetch shows no loading.
    expect(showing(count(11, 20))).not.toBeNull();
    expect(showing(count(12, 20))).toBeNull();
    expect(main().queryByText("Loading arrivals...")).toBeNull();

    await act(async () => next.resolve(json(200, arrivals(12, 20))));
    await shows(count(12, 20));
    await settle();
    expect(callsTo(fetch, ARRIVALS)).toBe(2);
    expect(callsTo(fetch, CHECKIN)).toBe(1);
    expect(listRequests(fetch)).toBe(0);
    expect(location()).toBe(SCAN);
    // Only the arrivals prefix is invalidated (not the registrations list).
    expect(invalidate.mock.calls).toEqual([[{ queryKey: ["event-arrivals"] }]]);
  });

  it("a repeated manual check-in that answers 409 already_checked_in leaves the number and reads nothing", async () => {
    const { fetch } = app(SCAN, {
      [ARRIVALS]: answers(ok(arrivals(11, 20)), ok(arrivals(12, 20))),
      [CHECKIN]: answers(ok(CHECKED_IN), () =>
        json(409, {
          error: "already_checked_in",
          attendee_name: "Ann Lee",
          checked_in_at: "2030-01-01T09:55:00.000Z",
        }),
      ),
    });
    await shows(count(11, 20));
    typeCode();
    await shows(count(12, 20));
    fireEvent.click(main().getByRole("button", { name: "Scan next" }));
    typeCode();
    await main().findByRole("heading", { name: "Already checked in" });
    await settle();
    expect(callsTo(fetch, CHECKIN)).toBe(2);
    expect(callsTo(fetch, ARRIVALS)).toBe(2);
    expect(showing(count(12, 20))).not.toBeNull();
  });

  it("an older arrivals request still running when the check-in succeeds cannot win", async () => {
    const slow = deferred<Response>();
    const { fetch } = app(SCAN, {
      [ARRIVALS]: answers(() => slow.promise, ok(arrivals(12, 20))),
      [CHECKIN]: ok(CHECKED_IN),
    });
    expect(await main().findByText("Loading arrivals...")).toBeTruthy();
    typeCode();
    await main().findByRole("heading", { name: "Checked in" });
    await shows(count(12, 20));
    await act(async () => slow.resolve(json(200, arrivals(11, 20))));
    await settle();
    expect(showing(count(11, 20))).toBeNull();
    expect(showing(count(12, 20))).not.toBeNull();
    expect(callsTo(fetch, ARRIVALS)).toBe(2);
  });
});

describe("W-C13: a refetch keeps the numbers (test first)", () => {
  it("a failed refetch keeps the last numbers and adds Could not refresh; the next good answer removes it", async () => {
    const { fetch } = app(SCAN, {
      [ARRIVALS]: answers(ok(arrivals(11, 20)), failed, ok(arrivals(12, 20))),
      [CHECKIN]: ok(CHECKED_IN),
    });
    const line = await shows(count(11, 20));
    const block = counter();

    typeCode();
    expect(await main().findByText("Could not refresh")).toBeTruthy();
    expect(showing(count(11, 20))).toBe(line);
    expect(counter()).toBe(block);
    expect(main().queryByText("Loading arrivals...")).toBeNull();
    expect(main().queryByText("Could not load arrivals")).toBeNull();
    expect(main().getByText("Could not refresh").getAttribute("role")).toBeNull();

    fireEvent.click(main().getByRole("button", { name: "Scan next" }));
    typeCode();
    await shows(count(12, 20));
    expect(main().queryByText("Could not refresh")).toBeNull();
    expect(counter()).toBe(block);
    expect(callsTo(fetch, ARRIVALS)).toBe(3);
  });

  it("equal data leaves the text as it is (no DOM change)", async () => {
    const { fetch } = app(SCAN, {
      [ARRIVALS]: ok(arrivals(11, 20)),
      [CHECKIN]: ok(CHECKED_IN),
    });
    await shows(count(11, 20));
    const observer = new MutationObserver(() => undefined);
    observer.observe(counter()!, { subtree: true, childList: true, characterData: true, attributes: true });
    typeCode();
    await main().findByRole("heading", { name: "Checked in" });
    await waitFor(() => expect(callsTo(fetch, ARRIVALS)).toBe(2));
    await settle();
    expect(observer.takeRecords()).toEqual([]);
    observer.disconnect();
  });

  it("changing the event shows Loading arrivals... and never the old event's number", async () => {
    const second = deferred<Response>();
    app(SCAN, {
      [ARRIVALS]: ok(arrivals(11, 20)),
      [SECOND_ARRIVALS]: () => second.promise,
    });
    await shows(count(11, 20));
    fireEvent.change(main().getByLabelText("Event"), { target: { value: SECOND_EVENT_ID } });
    expect(await main().findByText("Loading arrivals...")).toBeTruthy();
    expect(showing(count(11, 20))).toBeNull();
    await act(async () => second.resolve(json(200, arrivals(3, 5, 10))));
    await shows(count(3, 5));
    expect(main().getByText("Capacity: 10")).toBeTruthy();
  });
});

describe("W-C15: cache by account (test first)", () => {
  it("after me changes to another organizer, the first one's numbers are not shown and are read again", async () => {
    const forOtto = deferred<Response>();
    const { fetch, queryClient } = app(SCAN, {
      [ARRIVALS]: answers(ok(arrivals(5, 8, 10)), () => forOtto.promise),
    });
    await shows(count(5, 8));
    expect(main().getByText("Capacity: 10")).toBeTruthy();

    // Account B logs in (the login form only sets the me cache).
    await act(async () => queryClient.setQueryData(["me"], OTTO));
    await waitFor(() => expect(callsTo(fetch, ARRIVALS)).toBe(2));
    expect(showing(count(5, 8))).toBeNull();
    expect(main().queryByText("Capacity: 10")).toBeNull();
    expect(main().getByText("Loading arrivals...")).toBeTruthy();

    await act(async () => forOtto.resolve(json(200, arrivals(1, 2, 3))));
    await shows(count(1, 2));
    expect(main().getByText("Capacity: 3")).toBeTruthy();
  });
});

describe("W-C1, W-C2, W-C14: the numbers exactly as the server sent them", () => {
  it.each<[string, ReturnType<typeof arrivals>, string, string, boolean]>([
    ["some arrived", arrivals(12, 20, 25), count(12, 20), "Capacity: 25", false],
    ["nobody registered", arrivals(0, 0, 25), count(0, 0), "Capacity: 25", false],
    ["everyone arrived", arrivals(20, 20, 25), count(20, 20), "Capacity: 25", true],
    ["registered above capacity (not clamped)", arrivals(30, 40, 25), count(30, 40), "Capacity: 25", false],
    ["plain digits, no separators", arrivals(1200, 1500, 2000), count(1200, 1500), "Capacity: 2000", false],
  ])("%s", async (_case, body, line, capacity, all) => {
    const { fetch } = app(SCAN, { [ARRIVALS]: ok(body) });
    await shows(line);
    expect(main().getByText(capacity)).toBeTruthy();
    expect(main().queryByText("Everyone has arrived.") !== null).toBe(all);
    expect(callsTo(fetch, ARRIVALS)).toBe(1);
    expect(fetch.mock.calls.some(([input]) => input === `/events/${EVENT_ID}/arrivals`)).toBe(true);
  });

  it.each(["cancelled", "passed"] as const)("a %s event is counted the same", async (status) => {
    app(SCAN, {
      [EVENTS]: ok({ events: [organizerEvent({ status })] }),
      [ARRIVALS]: ok(arrivals(4, 6)),
    });
    await shows(count(4, 6));
    expect(main().getByText("Capacity: 25")).toBeTruthy();
  });
});

describe("W-C12: first load", () => {
  it("Loading arrivals... until the first answer, and no number", async () => {
    const first = deferred<Response>();
    app(SCAN, { [ARRIVALS]: () => first.promise });
    expect(await main().findByText("Loading arrivals...")).toBeTruthy();
    expect(main().queryByText(/Arrived:/)).toBeNull();
    await act(async () => first.resolve(json(200, arrivals(1, 2))));
    await shows(count(1, 2));
    expect(main().queryByText("Loading arrivals...")).toBeNull();
  });

  it.each<[string, Handler]>([
    ["5xx", failed],
    [
      "network error",
      () => {
        throw new TypeError("Failed to fetch");
      },
    ],
  ])("%s: Could not load arrivals and Retry, which reads only the arrivals again", async (_case, failure) => {
    const { fetch } = app(SCAN, { [ARRIVALS]: answers(failure, ok(arrivals(2, 3))) });
    expect(await main().findByText("Could not load arrivals")).toBeTruthy();
    await settle();
    // No automatic retry.
    expect(callsTo(fetch, ARRIVALS)).toBe(1);
    expect(main().queryByText(/Arrived:/)).toBeNull();
    const retry = within(counter()!).getByRole("button", { name: "Retry" });
    expect(retry.tagName).toBe("BUTTON");
    expect(retry.getAttribute("type")).toBe("button");
    fireEvent.click(retry);
    await shows(count(2, 3));
    expect(callsTo(fetch, ARRIVALS)).toBe(2);
    expect(callsTo(fetch, EVENTS)).toBe(1);
    expect(main().queryByText("Could not load arrivals")).toBeNull();
  });
});

describe("W-C10: cached numbers on a return", () => {
  it("a return shows the cached numbers while the request runs, then the new ones", async () => {
    const back = deferred<Response>();
    const { fetch } = app(SCAN, {
      [ARRIVALS]: answers(ok(arrivals(11, 20)), () => back.promise),
      [LIST]: ok({ registrations: [] }),
    });
    await shows(count(11, 20));
    goToList();
    await main().findByRole("heading", { level: 1, name: "Registrations" });
    expect(showing(count(11, 20))).not.toBeNull();
    expect(main().queryByText("Loading arrivals...")).toBeNull();
    await waitFor(() => expect(callsTo(fetch, ARRIVALS)).toBe(2));
    await act(async () => back.resolve(json(200, arrivals(12, 20))));
    await shows(count(12, 20));
  });

  it("a failed return request keeps the numbers with Could not refresh; a later good answer removes it", async () => {
    app(SCAN, {
      [ARRIVALS]: answers(ok(arrivals(11, 20)), failed, ok(arrivals(12, 20))),
      [LIST]: ok({ registrations: [] }),
    });
    await shows(count(11, 20));
    goToList();
    expect(await main().findByText("Could not refresh")).toBeTruthy();
    expect(showing(count(11, 20))).not.toBeNull();
    goToScan();
    await shows(count(12, 20));
    expect(main().queryByText("Could not refresh")).toBeNull();
  });
});

describe("W-C3, W-C4, W-C5: where the counter shows and what it reads", () => {
  it("registrations page: under the selector, above the table; one arrivals and one list request; numbers only", async () => {
    const { fetch } = app(LIST_PAGE, {
      [ARRIVALS]: ok(arrivals(0, 1)),
      [LIST]: ok({ registrations: [organizerRegistration()] }),
    });
    await shows(count(0, 1));
    const table = await main().findByRole("table");
    const block = counter()!;
    const select = main().getByLabelText("Event");
    expect(select.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(block.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(block).queryByText(/Olga/)).toBeNull();
    expect(within(block).queryByText(/olga@example.com/)).toBeNull();
    expect(within(block).queryByText(/K7M2QX9TPA/)).toBeNull();
    expect(callsTo(fetch, ARRIVALS)).toBe(1);
    expect(callsTo(fetch, LIST)).toBe(1);
  });

  it("both screens read the same cache entry: the registrations page shows the scan screen's numbers at once", async () => {
    const back = deferred<Response>();
    app(SCAN, {
      [ARRIVALS]: answers(ok(arrivals(7, 9)), () => back.promise),
      [LIST]: ok({ registrations: [] }),
    });
    await shows(count(7, 9));
    goToList();
    await main().findByRole("heading", { level: 1, name: "Registrations" });
    expect(showing(count(7, 9))).not.toBeNull();
  });

  it("the organizer event page shows no counter and makes no arrivals request", async () => {
    const fetch = mockFetch({
      [ME]: ok(OLGA),
      [`GET /events/${EVENT_ID}`]: ok(organizerEvent()),
    });
    renderApp(`/event/${EVENT_ID}`);
    expect(await screen.findByRole("heading", { level: 1, name: "Spring meetup" })).toBeTruthy();
    await settle();
    expect(counter()).toBeNull();
    expect(fetch.mock.calls.filter(([input]) => String(input).includes("/arrivals"))).toEqual([]);
  });
});

describe("W-C18: accessibility", () => {
  it("the counter is a div with no live region, also with the Could not refresh note", async () => {
    app(SCAN, {
      [ARRIVALS]: answers(ok(arrivals(20, 20)), failed),
      [CHECKIN]: ok(CHECKED_IN),
    });
    await shows(count(20, 20));
    const block = counter()!;
    expect(block.tagName).toBe("DIV");
    expect(block.getAttribute("role")).toBeNull();
    expect(block.getAttribute("aria-live")).toBeNull();
    expect(block.querySelectorAll("[role], [aria-live], h1, h2, h3")).toHaveLength(0);
    expect(within(block).getByText("Everyone has arrived.")).toBeTruthy();
    typeCode();
    await within(block).findByText("Could not refresh");
    expect(block.querySelectorAll("[role], [aria-live]")).toHaveLength(0);
  });
});
