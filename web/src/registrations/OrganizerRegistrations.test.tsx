// Tests first (registration-web.md W-R21 no events and 404), then W-R20, W-R21: the
// organizer registrations screen /registrations (GET /events, GET /events/{id}/registrations).
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { OLGA, callsTo, deferred, json, mockFetch, renderApp } from "../auth/test-helpers";
import { formatDateTime } from "../events/format";
import { EVENT_ID, organizerEvent } from "../events/test-helpers";
import {
  SECOND_EVENT_ID,
  eventRegistrations,
  organizerRegistration,
} from "./test-helpers";

afterEach(() => {
  vi.unstubAllGlobals();
});

type Handler = () => Response | Promise<Response>;

const ME = "GET /auth/me";
const EVENTS = "GET /events";
const FIRST = eventRegistrations(EVENT_ID);
const SECOND = eventRegistrations(SECOND_EVENT_ID);

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

function main() {
  return within(screen.getByRole("main"));
}

function location(): string | null {
  return screen.getByTestId("location").textContent;
}

function screenAt(path: string, routes: Record<string, Handler>) {
  const fetch = mockFetch({ [ME]: () => json(200, OLGA), ...routes });
  renderApp(path);
  return fetch;
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
        "K7M2QX9TPA",
        formatDateTime("2026-10-18T10:00:00.000Z"),
      ],
      [
        "Ivan Test",
        "ivan@example.com",
        "Waiting list",
        "1",
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
    expect(main().getByLabelText("Event")).toBeTruthy();
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
    expect(main().getAllByRole("columnheader")).toHaveLength(6);
  });
});
