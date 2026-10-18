// Tests first (registration-web.md W-R21 no events and 404), then W-R20, W-R21: the
// organizer registrations screen /registrations (GET /events, GET /events/{id}/registrations).
// Tests first (checkin-web.md): W-C7 the list is read again on every return, W-C15 both
// queries keyed by the account. Then W-C3, W-C4, W-C10, W-C16, W-C17: the arrivals counter
// (GET /events/{id}/arrivals) and the Arrival column.
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useNavigate } from "react-router";
import { App } from "../App";
import { OLGA, callsTo, deferred, json, mockFetch, renderApp, renderWith } from "../auth/test-helpers";
import { formatDateTime } from "../events/format";
import { EVENT_ID, organizerEvent } from "../events/test-helpers";
import {
  SECOND_EVENT_ID,
  arrivals,
  eventArrivals,
  eventRegistrations,
  organizerRegistration,
  wholeText,
} from "./test-helpers";

afterEach(() => {
  vi.unstubAllGlobals();
});

type Handler = () => Response | Promise<Response>;

const ME = "GET /auth/me";
const EVENTS = "GET /events";
const FIRST = eventRegistrations(EVENT_ID);
const SECOND = eventRegistrations(SECOND_EVENT_ID);
const FIRST_ARRIVALS = eventArrivals(EVENT_ID);
const SECOND_ARRIVALS = eventArrivals(SECOND_EVENT_ID);

const EVENT_LIST = {
  events: [
    organizerEvent(),
    organizerEvent({ id: SECOND_EVENT_ID, title: "Autumn fair" }),
  ],
};

const OLGA_ROW = organizerRegistration();
const IVAN_ROW = organizerRegistration({
  id: "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e",
  status: "waitlisted",
  waitlist_position: 1,
  ticket_code: "H4Z8WR5NCD",
  attendee_name: "Ivan Test",
  attendee_email: "ivan@example.com",
  created_at: "2026-10-18T11:00:00.000Z",
});

const ok = (body: unknown): Handler => () => json(200, body);
const rows = (...registrations: unknown[]): Handler => ok({ registrations });

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

// The arrivals counter of both events answers by default (checkin-web.md W-C3).
const ARRIVALS_OK = {
  [FIRST_ARRIVALS]: ok(arrivals(0, 1)),
  [SECOND_ARRIVALS]: ok(arrivals(0, 1)),
};

function screenAt(path: string, routes: Record<string, Handler>) {
  const fetch = mockFetch({ [ME]: () => json(200, OLGA), ...ARRIVALS_OK, ...routes });
  renderApp(path);
  return fetch;
}

function rowOf(name: string): HTMLElement {
  return main().getByText(name).closest("tr")!;
}

// The Arrival cell (the fifth column).
function arrivalOf(name: string): HTMLElement {
  return within(rowOf(name)).getAllByRole("cell")[4];
}

function goToScan() {
  fireEvent.click(main().getByRole("link", { name: "Check in attendees" }));
}

// Header link back to /registrations.
function goToList() {
  fireEvent.click(screen.getByRole("link", { name: "Registrations" }));
}

function cellsOf(row: HTMLElement): string[] {
  return within(row)
    .getAllByRole("cell")
    .map((cell) => cell.textContent ?? "");
}

describe("W-R21: no events and event not found (tests first)", () => {
  it("no events at all: You have no events yet. and Create event, no registrations request", async () => {
    const fetch = screenAt("/registrations", { [EVENTS]: ok({ events: [] }) });
    expect(await main().findByText("You have no events yet.")).toBeTruthy();
    expect(main().getByRole("link", { name: "Create event" }).getAttribute("href")).toBe(
      "/organizer/events/new",
    );
    expect(main().getByRole("heading", { level: 1, name: "Registrations" })).toBeTruthy();
    expect(main().queryByRole("table")).toBeNull();
    expect(fetch.mock.calls.filter(([input]) => String(input).includes("/registrations"))).toEqual(
      [],
    );
  });

  it("the event answers 404: Event not found, no table", async () => {
    screenAt("/registrations", {
      [EVENTS]: ok(EVENT_LIST),
      [FIRST]: () => json(404, { error: "not_found" }),
    });
    expect(await main().findByText("Event not found")).toBeTruthy();
    expect(main().queryByRole("table")).toBeNull();
    // The selector stays, so another event can be chosen.
    expect(main().getByLabelText("Event")).toBeTruthy();
  });
});

describe("W-R20: the registrations of the chosen event", () => {
  it("defaults to the first event and shows the table in the API order", async () => {
    const fetch = screenAt("/registrations", {
      [EVENTS]: ok(EVENT_LIST),
      [FIRST]: rows(OLGA_ROW, IVAN_ROW),
    });
    const table = await main().findByRole("table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((th) => [th.textContent, th.getAttribute("scope")]),
    ).toEqual([
      ["Name", "col"],
      ["Email", "col"],
      ["Status", "col"],
      ["Place", "col"],
      ["Arrival", "col"],
      ["Ticket code", "col"],
      ["Registered", "col"],
    ]);
    const body = within(table).getAllByRole("row").slice(1);
    expect(body.map(cellsOf)).toEqual([
      [
        "Olga Test",
        "olga@example.com",
        "Registered",
        "",
        "Not yet",
        "K7M2QX9TPA",
        formatDateTime("2026-10-18T10:00:00.000Z"),
      ],
      [
        "Ivan Test",
        "ivan@example.com",
        "Waiting list",
        "1",
        "",
        "H4Z8WR5NCD",
        formatDateTime("2026-10-18T11:00:00.000Z"),
      ],
    ]);
    const select = main().getByLabelText("Event") as HTMLSelectElement;
    expect(select.value).toBe(EVENT_ID);
    expect([...select.options].map((o) => o.textContent)).toEqual(["Spring meetup", "Autumn fair"]);
    expect(callsTo(fetch, EVENTS)).toBe(1);
    expect(callsTo(fetch, FIRST)).toBe(1);
    expect(callsTo(fetch, SECOND)).toBe(0);
  });

  it("the event query parameter picks the event when it is in the list", async () => {
    const fetch = screenAt(`/registrations?event=${SECOND_EVENT_ID}`, {
      [EVENTS]: ok(EVENT_LIST),
      [SECOND]: rows(IVAN_ROW),
    });
    expect(await main().findByText("Ivan Test")).toBeTruthy();
    expect((main().getByLabelText("Event") as HTMLSelectElement).value).toBe(SECOND_EVENT_ID);
    expect(callsTo(fetch, FIRST)).toBe(0);
  });

  it("an event parameter that is not in the list falls back to the first event", async () => {
    const fetch = screenAt("/registrations?event=not-mine", {
      [EVENTS]: ok(EVENT_LIST),
      [FIRST]: rows(OLGA_ROW),
    });
    expect(await main().findByText("Olga Test")).toBeTruthy();
    expect(callsTo(fetch, FIRST)).toBe(1);
  });

  it("choosing another event loads its registrations and keeps it in the address", async () => {
    const fetch = screenAt("/registrations", {
      [EVENTS]: ok(EVENT_LIST),
      [FIRST]: rows(OLGA_ROW),
      [SECOND]: rows(IVAN_ROW),
    });
    expect(await main().findByText("Olga Test")).toBeTruthy();
    fireEvent.change(main().getByLabelText("Event"), { target: { value: SECOND_EVENT_ID } });
    expect(await main().findByText("Ivan Test")).toBeTruthy();
    expect(main().queryByText("Olga Test")).toBeNull();
    expect(location()).toBe(`/registrations?event=${SECOND_EVENT_ID}`);
    expect(callsTo(fetch, SECOND)).toBe(1);
    expect(callsTo(fetch, EVENTS)).toBe(1);
  });

  it('a checked-in ticket has "Checked in" next to its status', async () => {
    screenAt("/registrations", {
      [EVENTS]: ok(EVENT_LIST),
      [FIRST]: rows({ ...OLGA_ROW, checked_in_at: "2030-01-01T09:55:00.000Z" }),
    });
    const row = (await main().findByText("Olga Test")).closest("tr")!;
    expect(within(row).getByText("Checked in")).toBeTruthy();
    expect(within(row).getByText("Registered")).toBeTruthy();
  });
});

describe("W-R21: the other states", () => {
  it("an event with nobody: No one has registered for this event yet.", async () => {
    screenAt("/registrations", { [EVENTS]: ok(EVENT_LIST), [FIRST]: rows() });
    expect(await main().findByText("No one has registered for this event yet.")).toBeTruthy();
    expect(main().queryByRole("table")).toBeNull();
  });

  it('shows "Loading..." while the events or the registrations load', async () => {
    const events = deferred<Response>();
    const list = deferred<Response>();
    screenAt("/registrations", { [EVENTS]: () => events.promise, [FIRST]: () => list.promise });
    expect((await main().findByRole("status")).textContent).toBe("Loading...");
    await act(async () => events.resolve(json(200, EVENT_LIST)));
    expect(await main().findByLabelText("Event")).toBeTruthy();
    expect(main().getByRole("status").textContent).toBe("Loading...");
    await act(async () => list.resolve(json(200, { registrations: [OLGA_ROW] })));
    expect(await main().findByText("Olga Test")).toBeTruthy();
  });

  it("the registrations fail: Could not load registrations, Retry reads only them again", async () => {
    let n = 0;
    const fetch = screenAt("/registrations", {
      [EVENTS]: ok(EVENT_LIST),
      [FIRST]: () => (n++ === 0 ? json(500, { error: "internal" }) : json(200, { registrations: [OLGA_ROW] })),
    });
    expect((await main().findByRole("alert")).textContent).toBe("Could not load registrations");
    fireEvent.click(main().getByRole("button", { name: "Retry" }));
    expect(await main().findByText("Olga Test")).toBeTruthy();
    expect(callsTo(fetch, FIRST)).toBe(2);
    expect(callsTo(fetch, EVENTS)).toBe(1);
  });

  it("the events fail: Could not load registrations, Retry reads the events again", async () => {
    let n = 0;
    const fetch = screenAt("/registrations", {
      [EVENTS]: () => {
        if (n++ === 0) throw new TypeError("Failed to fetch");
        return json(200, EVENT_LIST);
      },
      [FIRST]: rows(OLGA_ROW),
    });
    expect((await main().findByRole("alert")).textContent).toBe("Could not load registrations");
    fireEvent.click(main().getByRole("button", { name: "Retry" }));
    expect(await main().findByText("Olga Test")).toBeTruthy();
    expect(callsTo(fetch, EVENTS)).toBe(2);
  });

  it("401 on the list re-checks me and the guard sends to the organizer login", async () => {
    let first = true;
    const fetch = mockFetch({
      [ME]: () => {
        if (first) {
          first = false;
          return json(200, OLGA);
        }
        return json(401, { error: "not_logged_in" });
      },
      [EVENTS]: ok(EVENT_LIST),
      [FIRST]: () => json(401, { error: "not_logged_in" }),
      ...ARRIVALS_OK,
    });
    renderApp("/registrations");
    await waitFor(() => expect(location()).toMatch(/^\/organizer\/login\?next=/));
    expect(screen.queryByText("Could not load registrations")).toBeNull();
    expect(callsTo(fetch, ME)).toBe(2);
  });
});

describe("W-R22: one h1, a real table", () => {
  it("has one h1 and the table has column headers", async () => {
    screenAt("/registrations", { [EVENTS]: ok(EVENT_LIST), [FIRST]: rows(OLGA_ROW) });
    await main().findByRole("table");
    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual([
      "Registrations",
    ]);
    expect(main().getAllByRole("columnheader")).toHaveLength(7);
  });
});

// W-R21/W-R23: a login as another account replaces the cookie without a logout, so
// the attendee names and emails of account A must never be shown to account B.
describe("W-R23: the organizer list is keyed by the account", () => {
  const OTTO = { ...OLGA, id: "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f", email: "otto@mail.com", name: "Otto" };

  it("after me changes to another organizer, no row of the first one is shown", async () => {
    const second = deferred<Response>();
    let n = 0;
    const fetch = mockFetch({
      [ME]: () => json(200, OLGA),
      [EVENTS]: ok(EVENT_LIST),
      [FIRST]: () => (n++ === 0 ? json(200, { registrations: [OLGA_ROW, IVAN_ROW] }) : second.promise),
      ...ARRIVALS_OK,
    });
    const { queryClient } = renderApp("/registrations");
    expect(await main().findByText("Olga Test")).toBeTruthy();
    // Account B logs in (the login form only sets the me cache).
    await act(async () => queryClient.setQueryData(["me"], OTTO));
    await waitFor(() => expect(callsTo(fetch, FIRST)).toBe(2));
    expect(screen.queryByText("Olga Test")).toBeNull();
    expect(screen.queryByText("olga@example.com")).toBeNull();
    expect(screen.queryByText("Ivan Test")).toBeNull();
    await act(async () => second.resolve(json(200, { registrations: [] })));
    expect(await main().findByText("No one has registered for this event yet.")).toBeTruthy();
    expect(screen.queryByText("Olga Test")).toBeNull();
  });
});

describe("checkin-web.md W-C7: every return reads the list again (test first)", () => {
  it("to the scan screen and back: the list is sent again and the table shows the new answer", async () => {
    const CHECKED = { ...OLGA_ROW, checked_in_at: "2030-01-01T09:55:00.000Z" };
    const back = deferred<Response>();
    const fetch = screenAt("/registrations", {
      [EVENTS]: ok(EVENT_LIST),
      [FIRST]: answers(rows(OLGA_ROW), () => back.promise, rows(CHECKED)),
    });
    await main().findByText("Olga Test");
    expect(arrivalOf("Olga Test").textContent).toBe("Not yet");
    expect(callsTo(fetch, FIRST)).toBe(1);

    goToScan();
    expect(await main().findByRole("heading", { level: 1, name: "Check in" })).toBeTruthy();
    // The scan screen never reads the list.
    expect(callsTo(fetch, FIRST)).toBe(1);

    goToList();
    await waitFor(() => expect(callsTo(fetch, FIRST)).toBe(2));
    // While the request runs the cached rows stay: no "Loading..." flash.
    expect(main().getByText("Olga Test")).toBeTruthy();
    expect(main().queryByRole("status")).toBeNull();
    await act(async () => back.resolve(json(200, { registrations: [CHECKED] })));
    await waitFor(() => expect(within(arrivalOf("Olga Test")).queryByText("Arrived")).not.toBeNull());

    // The list did not change, and the request is still sent.
    goToScan();
    await main().findByRole("heading", { level: 1, name: "Check in" });
    goToList();
    await waitFor(() => expect(callsTo(fetch, FIRST)).toBe(3));
    expect(await main().findByText("Olga Test")).toBeTruthy();
  });
});

describe("checkin-web.md W-C15: the list and the counter are keyed by the account (test first)", () => {
  const OTTO = { ...OLGA, id: "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f", email: "otto@mail.com", name: "Otto" };

  it("after me changes to another organizer, no row and no number of the first one is shown; both are read again", async () => {
    const listForOtto = deferred<Response>();
    const countForOtto = deferred<Response>();
    const fetch = mockFetch({
      [ME]: () => json(200, OLGA),
      [EVENTS]: ok(EVENT_LIST),
      [FIRST]: answers(rows(OLGA_ROW, IVAN_ROW), () => listForOtto.promise),
      [FIRST_ARRIVALS]: answers(ok(arrivals(5, 8, 10)), () => countForOtto.promise),
    });
    const { queryClient } = renderApp("/registrations");
    expect(await main().findByText("Olga Test")).toBeTruthy();
    expect(await main().findByText(wholeText("Arrived: 5 / 8 registered"))).toBeTruthy();

    await act(async () => queryClient.setQueryData(["me"], OTTO));
    await waitFor(() => expect(callsTo(fetch, FIRST)).toBe(2));
    await waitFor(() => expect(callsTo(fetch, FIRST_ARRIVALS)).toBe(2));
    expect(screen.queryByText("Olga Test")).toBeNull();
    expect(screen.queryByText("olga@example.com")).toBeNull();
    expect(screen.queryByText("Ivan Test")).toBeNull();
    expect(main().queryByText(wholeText("Arrived: 5 / 8 registered"))).toBeNull();
    expect(main().queryByText("Capacity: 10")).toBeNull();

    await act(async () => {
      listForOtto.resolve(json(200, { registrations: [] }));
      countForOtto.resolve(json(200, arrivals(0, 0, 3)));
    });
    expect(await main().findByText("No one has registered for this event yet.")).toBeTruthy();
    expect(await main().findByText(wholeText("Arrived: 0 / 0 registered"))).toBeTruthy();
    expect(main().getByText("Capacity: 3")).toBeTruthy();
  });
});

describe("checkin-web.md W-C16: the Arrival column, from the list rows only", () => {
  it("Arrived with the time, Not yet, and empty for the waiting list", async () => {
    const at = "2030-01-01T09:55:00.000Z";
    const ARRIVED = organizerRegistration({
      id: "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f",
      ticket_code: "M3N4P5Q6R7",
      attendee_name: "Ann Lee",
      attendee_email: "ann@example.com",
      checked_in_at: at,
    });
    const fetch = screenAt("/registrations", {
      [EVENTS]: ok(EVENT_LIST),
      [FIRST]: rows(ARRIVED, OLGA_ROW, IVAN_ROW),
    });
    await main().findByText("Ann Lee");
    const arrived = arrivalOf("Ann Lee");
    expect(within(arrived).getByText("Arrived")).toBeTruthy();
    const time = arrived.querySelector("time")!;
    expect(time.getAttribute("datetime")).toBe(at);
    expect(time.textContent).toBe(formatDateTime(at));
    expect(arrivalOf("Olga Test").textContent).toBe("Not yet");
    expect(arrivalOf("Ivan Test").textContent).toBe("");
    // The rows stay in the API order and the column needs no request of its own.
    const names = within(main().getByRole("table"))
      .getAllByRole("row")
      .slice(1)
      .map((row) => cellsOf(row)[0]);
    expect(names).toEqual(["Ann Lee", "Olga Test", "Ivan Test"]);
    expect(callsTo(fetch, FIRST)).toBe(1);
    expect(callsTo(fetch, FIRST_ARRIVALS)).toBe(1);
  });
});

describe("checkin-web.md W-C3, W-C4, W-C17: the counter on the registrations page", () => {
  it("an event with nobody: the counter shows 0 / 0 with the capacity above the empty text", async () => {
    screenAt("/registrations", {
      [EVENTS]: ok(EVENT_LIST),
      [FIRST]: rows(),
      [FIRST_ARRIVALS]: ok(arrivals(0, 0, 25)),
    });
    const empty = await main().findByText("No one has registered for this event yet.");
    const line = await main().findByText(wholeText("Arrived: 0 / 0 registered"));
    expect(main().getByText("Capacity: 25")).toBeTruthy();
    expect(main().queryByText("Everyone has arrived.")).toBeNull();
    expect(line.compareDocumentPosition(empty) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("opening the page sends one arrivals and one list request and nothing more", async () => {
    const fetch = screenAt("/registrations", {
      [EVENTS]: ok(EVENT_LIST),
      [FIRST]: rows(OLGA_ROW),
    });
    await main().findByText("Olga Test");
    await main().findByText(wholeText("Arrived: 0 / 1 registered"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(callsTo(fetch, FIRST_ARRIVALS)).toBe(1);
    expect(callsTo(fetch, FIRST)).toBe(1);
    expect(callsTo(fetch, SECOND_ARRIVALS)).toBe(0);
    expect(callsTo(fetch, SECOND)).toBe(0);
  });

  it("a return through the browser history keeps the chosen event and reads it again", async () => {
    function Back() {
      const navigate = useNavigate();
      return (
        <button type="button" onClick={() => void navigate(-1)}>
          Back
        </button>
      );
    }
    const fetch = mockFetch({
      [ME]: () => json(200, OLGA),
      [EVENTS]: ok(EVENT_LIST),
      [SECOND]: rows(IVAN_ROW),
      ...ARRIVALS_OK,
    });
    renderWith(
      <>
        <App />
        <Back />
      </>,
      `/registrations?event=${SECOND_EVENT_ID}`,
    );
    await main().findByText("Ivan Test");
    goToScan();
    await main().findByRole("heading", { level: 1, name: "Check in" });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(location()).toBe(`/registrations?event=${SECOND_EVENT_ID}`));
    await waitFor(() => expect(callsTo(fetch, SECOND)).toBe(2));
    expect((main().getByLabelText("Event") as HTMLSelectElement).value).toBe(SECOND_EVENT_ID);
    expect(callsTo(fetch, FIRST)).toBe(0);
    await waitFor(() => expect(callsTo(fetch, SECOND_ARRIVALS)).toBe(3));
  });
});

describe("checkin-web.md W-C10: a failed return request of the list", () => {
  it("keeps the rows and shows Could not refresh above the table; a later good answer removes it", async () => {
    const fetch = screenAt("/registrations", {
      [EVENTS]: ok(EVENT_LIST),
      [FIRST]: answers(rows(OLGA_ROW), () => json(500, { error: "internal" }), rows(OLGA_ROW)),
    });
    await main().findByText("Olga Test");
    goToScan();
    await main().findByRole("heading", { level: 1, name: "Check in" });
    goToList();
    const note = await main().findByText("Could not refresh");
    expect(note.getAttribute("role")).toBeNull();
    expect(main().getByText("Olga Test")).toBeTruthy();
    expect(main().queryByText("Could not load registrations")).toBeNull();
    const table = main().getByRole("table");
    expect(note.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    goToScan();
    await main().findByRole("heading", { level: 1, name: "Check in" });
    goToList();
    await waitFor(() => expect(callsTo(fetch, FIRST)).toBe(3));
    await waitFor(() => expect(main().queryByText("Could not refresh")).toBeNull());
    expect(main().getByText("Olga Test")).toBeTruthy();
  });
});
