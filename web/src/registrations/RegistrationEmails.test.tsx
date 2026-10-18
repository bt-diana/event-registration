// Tests first (email-reminders-web.md): W-EM2 route and guard, W-EM3 no request for bad
// ids, W-EM4 one request per visit and nothing by itself, W-EM5 a return reads it again,
// W-EM6 cache by account, W-EM7 401, 403 and 404, W-EM9 the words, W-EM11 no claim of
// delivery, W-EM12 the states, W-EM13 only the back link, the h1 and the table. Then
// W-EM8, W-EM10, W-EM15. The page /registrations/:registrationId/emails?event= is read
// through the real routes (renderApp) with one QueryClient kept across navigation;
// fetch is mocked and its call counts prove the request numbers.
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import {
  ANN,
  OLGA,
  backLinks,
  callsTo,
  deferred,
  json,
  mockFetch,
  renderApp,
} from "../auth/test-helpers";
import { formatDateTime } from "../events/format";
import { EVENT_ID, organizerEvent } from "../events/test-helpers";
import {
  arrivals,
  eventArrivals,
  eventRegistrations,
  organizerRegistration,
} from "./test-helpers";

type Handler = () => Response | Promise<Response>;

// An item of GET /events/{id}/registrations/{registrationId}/emails (email-reminders.md ER50).
type SampleEmail = {
  id: string;
  kind: string;
  status: string;
  to_email: string;
  subject: string;
  created_at: string;
  sent_at: string | null;
  send_attempts: number;
  send_error: string | null;
};

const ME = "GET /auth/me";
const EVENTS = "GET /events";
const MY_LIST = "GET /me/registrations";
const LIST = eventRegistrations(EVENT_ID);
const ARRIVALS = eventArrivals(EVENT_ID);
const OLGA_ROW = organizerRegistration();
const RID = OLGA_ROW.id;
const EMAILS = `GET /events/${EVENT_ID}/registrations/${RID}/emails`;
const PAGE = `/registrations/${RID}/emails?event=${EVENT_ID}`;
const LIST_PAGE = `/registrations?event=${EVENT_ID}`;
const KEY = ["registration-emails", OLGA.id, EVENT_ID, RID];

const OTTO = {
  ...OLGA,
  id: "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f",
  email: "otto@mail.com",
  name: "Otto",
};

function email(overrides: Partial<SampleEmail> = {}): SampleEmail {
  return {
    id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    kind: "ticket",
    status: "sent",
    to_email: "olga@example.com",
    subject: "Your ticket for Spring meetup",
    created_at: "2026-10-18T10:00:05.000Z",
    sent_at: "2026-10-18T10:00:09.000Z",
    send_attempts: 0,
    send_error: null,
    ...overrides,
  };
}

// Newest first, as the API sends them (ER53).
const FAILED = email({
  id: "c3d4e5f6-a7b8-4c9d-8e0f-1a2b3c4d5e6f",
  kind: "reminder",
  status: "error_sending",
  subject: "Tomorrow: Spring meetup",
  created_at: "2029-12-31T10:00:00.000Z",
  sent_at: null,
  send_attempts: 3,
  send_error: "provider timeout",
});
const PENDING = email({
  id: "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e",
  kind: "reminder",
  status: "pending",
  subject: "Reminder: Spring meetup",
  created_at: "2029-12-30T10:00:00.000Z",
  sent_at: null,
  send_attempts: 1,
  send_error: "rate limited",
});
const TICKET = email();

const body = (...emails: SampleEmail[]) => ({ attendee_name: "Olga Test", emails });

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const ok = (data: unknown): Handler => () => json(200, data);
const failed: Handler = () => json(500, { error: "internal" });
const notFound: Handler = () => json(404, { error: "not_found" });

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

function app(path: string, routes: Record<string, Handler>) {
  const fetch = mockFetch({
    [ME]: ok(OLGA),
    [EVENTS]: ok({ events: [organizerEvent()] }),
    [LIST]: ok({ registrations: [OLGA_ROW] }),
    [ARRIVALS]: ok(arrivals(0, 1)),
    ...routes,
  });
  return { fetch, ...renderApp(path) };
}

function emailRequests(fetch: ReturnType<typeof mockFetch>): number {
  return fetch.mock.calls.filter(([input]) => String(input).includes("/emails")).length;
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

function h1(): string | null {
  return main().getByRole("heading", { level: 1 }).textContent;
}

function bodyRows(): HTMLElement[] {
  return within(main().getByRole("table")).getAllByRole("row").slice(1);
}

function cellsOf(row: HTMLElement): string[] {
  return within(row)
    .getAllByRole("cell")
    .map((cell) => cell.textContent ?? "");
}

// From the registrations page to the emails page of Olga, and back.
function openEmails() {
  fireEvent.click(main().getByRole("link", { name: "View emails of Olga Test" }));
}

function goToList() {
  fireEvent.click(main().getByRole("link", { name: "Registrations" }));
}

function setVisibility(value: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { value, configurable: true });
}

describe("W-EM2: route and guard (test first)", () => {
  it("an organizer sees the page: me, then one emails request, nothing else", async () => {
    const { fetch } = app(PAGE, { [EMAILS]: ok(body(TICKET)) });
    expect(await main().findByRole("heading", { level: 1, name: "Emails of Olga Test" })).toBeTruthy();
    expect(location()).toBe(PAGE);
    await settle();
    expect(callsTo(fetch, ME)).toBe(1);
    expect(callsTo(fetch, EMAILS)).toBe(1);
    expect(fetch.mock.calls).toHaveLength(2);
  });

  it("logged out: redirect to the organizer login with the path and the query in next", async () => {
    const fetch = mockFetch({ [ME]: () => json(401, { error: "not_logged_in" }) });
    renderApp(PAGE);
    await waitFor(() => expect(location()).toBe(`/organizer/login?next=${encodeURIComponent(PAGE)}`));
    expect(await screen.findByLabelText("Email")).toBeTruthy();
    expect(fetch.mock.calls).toHaveLength(1);
  });

  it("an attendee is redirected to /registrations/me (the query dropped), no emails request", async () => {
    const fetch = mockFetch({ [ME]: ok(ANN), [MY_LIST]: ok({ registrations: [] }) });
    renderApp(PAGE);
    await waitFor(() => expect(location()).toBe("/registrations/me"));
    expect(await main().findByRole("heading", { level: 1, name: "My registrations" })).toBeTruthy();
    expect(screen.queryByText(/This page is for/)).toBeNull();
    await settle();
    expect(emailRequests(fetch)).toBe(0);
  });

  it('shows only "Loading..." while me loads: no request before the guard accepts', async () => {
    const me = deferred<Response>();
    const fetch = mockFetch({ [ME]: () => me.promise, [EMAILS]: ok(body(TICKET)) });
    renderApp(PAGE);
    expect(main().getByRole("status").textContent).toBe("Loading...");
    expect(main().queryByRole("heading")).toBeNull();
    expect(fetch.mock.calls).toHaveLength(1);
    await act(async () => me.resolve(json(200, OLGA)));
    expect(await main().findByRole("heading", { level: 1, name: "Emails of Olga Test" })).toBeTruthy();
    expect(callsTo(fetch, EMAILS)).toBe(1);
  });

  it("/registrations/me and /registrations/scan still open their own screens", async () => {
    const attendee = mockFetch({ [ME]: ok(ANN), [MY_LIST]: ok({ registrations: [] }) });
    const first = renderApp("/registrations/me");
    expect(await main().findByRole("heading", { level: 1, name: "My registrations" })).toBeTruthy();
    expect(emailRequests(attendee)).toBe(0);
    first.unmount();

    const organizer = app("/registrations/scan", {});
    expect(await main().findByRole("heading", { level: 1, name: "Check in" })).toBeTruthy();
    expect(location()).toBe("/registrations/scan");
    expect(emailRequests(organizer.fetch)).toBe(0);
  });
});

describe("W-EM3: ids from the URL, no request for bad ids (test first)", () => {
  it.each<[string, string, string]>([
    ["no event", `/registrations/${RID}/emails`, "/registrations"],
    ["an empty event", `/registrations/${RID}/emails?event=`, "/registrations"],
    ["event=abc", `/registrations/${RID}/emails?event=abc`, "/registrations"],
    ["path id me", `/registrations/me/emails?event=${EVENT_ID}`, LIST_PAGE],
    ["a path id that is not a uuid", `/registrations/12345/emails?event=${EVENT_ID}`, LIST_PAGE],
  ])("%s: Registration not found and zero emails requests", async (_case, path, back) => {
    const { fetch } = app(path, {});
    const alert = await main().findByRole("alert");
    expect(alert.textContent).toBe("Registration not found");
    expect(main().getByText("This link is not valid or the registration does not exist.")).toBeTruthy();
    expect(main().queryByRole("table")).toBeNull();
    expect(h1()).toBe("Emails");
    expect(main().getByRole("link", { name: "Registrations" }).getAttribute("href")).toBe(back);
    await settle();
    expect(emailRequests(fetch)).toBe(0);
    expect(fetch.mock.calls).toHaveLength(1);
  });

  it("upper-case uuids are ids too: one request with them", async () => {
    const event = EVENT_ID.toUpperCase();
    const id = RID.toUpperCase();
    const { fetch } = app(`/registrations/${id}/emails?event=${event}`, {
      [`GET /events/${event}/registrations/${id}/emails`]: ok(body(TICKET)),
    });
    expect(await main().findByRole("table")).toBeTruthy();
    expect(callsTo(fetch, `GET /events/${event}/registrations/${id}/emails`)).toBe(1);
  });
});

describe("W-EM4: one request on open, never by itself (test first)", () => {
  it("one request after mount; none after a minute, a hidden tab, the focus or a reconnect", async () => {
    const { fetch } = app(PAGE, { [EMAILS]: ok(body(TICKET)) });
    await main().findByRole("table");
    expect(callsTo(fetch, EMAILS)).toBe(1);

    vi.useFakeTimers();
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
    vi.useRealTimers();

    expect(callsTo(fetch, EMAILS)).toBe(1);
    expect(main().getByRole("table")).toBeTruthy();
  });

  it("the query key is per account, event and registration, with staleTime 0 and no refetch by itself", async () => {
    const { queryClient } = app(PAGE, { [EMAILS]: ok(body(TICKET)) });
    await main().findByRole("table");
    const query = queryClient.getQueryCache().find({ queryKey: KEY, exact: true });
    expect(query).toBeTruthy();
    expect(query!.state.data).toEqual(body(TICKET));
    const options = query!.options as Record<string, unknown>;
    expect(options.staleTime).toBe(0);
    expect(options.refetchOnMount).toBe("always");
    expect(options.refetchOnReconnect).toBe(false);
    expect(options.refetchOnWindowFocus).toBe(false);
    expect(options.retry).toBe(false);
    expect(options.refetchInterval).toBeUndefined();
  });
});

describe("W-EM5: every return reads it again (test first)", () => {
  it("table, page, back, page again: the request is sent again, cached rows stay, the new answer shows", async () => {
    const back = deferred<Response>();
    const { fetch } = app(LIST_PAGE, {
      [EMAILS]: answers(
        ok(body(PENDING, TICKET)),
        () => back.promise,
        failed,
        ok(body(PENDING, TICKET)),
      ),
    });
    await main().findByText("Olga Test");
    openEmails();
    expect(await main().findByText("Pending")).toBeTruthy();
    expect(location()).toBe(PAGE);
    expect(callsTo(fetch, EMAILS)).toBe(1);

    // Second visit, the answer is very recent and still read again.
    goToList();
    await main().findByRole("heading", { level: 1, name: "Registrations" });
    openEmails();
    await waitFor(() => expect(callsTo(fetch, EMAILS)).toBe(2));
    // While the request runs the cached rows stay: no "Loading emails..." flash.
    expect(main().getByText("Pending")).toBeTruthy();
    expect(main().queryByRole("status")).toBeNull();
    expect(main().queryByText("Loading emails...")).toBeNull();
    await act(async () => back.resolve(json(200, body({ ...PENDING, status: "sent", sent_at: "2029-12-31T09:00:00.000Z" }, TICKET))));
    await waitFor(() => expect(main().queryByText("Pending")).toBeNull());
    expect(main().getAllByText("Sent")).toHaveLength(2);

    // Third visit fails: the rows stay with the note above the table.
    goToList();
    await main().findByRole("heading", { level: 1, name: "Registrations" });
    openEmails();
    const note = await main().findByText("Could not refresh");
    expect(note.getAttribute("role")).toBeNull();
    expect(note.classList.contains("refresh-note")).toBe(true);
    expect(main().getAllByText("Sent")).toHaveLength(2);
    expect(main().queryByText("Could not load emails")).toBeNull();
    expect(note.compareDocumentPosition(main().getByRole("table")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(h1()).toBe("Emails of Olga Test");

    // Fourth visit answers: the note goes.
    goToList();
    await main().findByRole("heading", { level: 1, name: "Registrations" });
    openEmails();
    await waitFor(() => expect(callsTo(fetch, EMAILS)).toBe(4));
    await waitFor(() => expect(main().queryByText("Could not refresh")).toBeNull());
    expect(await main().findByText("Pending")).toBeTruthy();
  });
});

describe("W-EM6: cache by account (test first)", () => {
  it("after me changes to another organizer, the first one's rows and name are gone and B's request is sent", async () => {
    const forOtto = deferred<Response>();
    const { fetch, queryClient } = app(PAGE, {
      [EMAILS]: answers(ok(body(PENDING, TICKET)), () => forOtto.promise),
    });
    expect(await main().findByRole("heading", { level: 1, name: "Emails of Olga Test" })).toBeTruthy();
    expect(main().getByText("Reminder: Spring meetup")).toBeTruthy();

    await act(async () => queryClient.setQueryData(["me"], OTTO));
    await waitFor(() => expect(callsTo(fetch, EMAILS)).toBe(2));
    expect(screen.queryByText("Emails of Olga Test")).toBeNull();
    expect(screen.queryByText("Reminder: Spring meetup")).toBeNull();
    expect(screen.queryByText("olga@example.com")).toBeNull();
    expect(main().queryByRole("table")).toBeNull();
    expect(main().getByText("Loading emails...")).toBeTruthy();

    await act(async () =>
      forOtto.resolve(json(200, { attendee_name: "Ivan Test", emails: [email({ to_email: "ivan@example.com" })] })),
    );
    expect(await main().findByRole("heading", { level: 1, name: "Emails of Ivan Test" })).toBeTruthy();
    expect(main().getByText("ivan@example.com")).toBeTruthy();
  });
});

describe("W-EM7: terminal errors (test first)", () => {
  it("401: me is read again, the page shows loading, the guard sends to the login", async () => {
    let first = true;
    const meAgain = deferred<Response>();
    const { fetch } = app(PAGE, {
      [ME]: () => {
        if (first) {
          first = false;
          return json(200, OLGA);
        }
        return meAgain.promise;
      },
      [EMAILS]: () => json(401, { error: "not_logged_in" }),
    });
    await waitFor(() => expect(callsTo(fetch, ME)).toBe(2));
    expect(main().getByRole("status").textContent).toBe("Loading emails...");
    expect(screen.queryByText("Could not load emails")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    await act(async () => meAgain.resolve(json(401, { error: "not_logged_in" })));
    await waitFor(() => expect(location()).toMatch(/^\/organizer\/login\?next=/));
    expect(screen.queryByText("Could not load emails")).toBeNull();
    expect(callsTo(fetch, EMAILS)).toBe(1);
  });

  it("403: me is read again; an attendee is sent to /registrations/me", async () => {
    let first = true;
    const { fetch } = app(PAGE, {
      [ME]: () => {
        if (first) {
          first = false;
          return json(200, OLGA);
        }
        return json(200, ANN);
      },
      [MY_LIST]: ok({ registrations: [] }),
      [EMAILS]: () => json(403, { error: "wrong_role" }),
    });
    await waitFor(() => expect(location()).toBe("/registrations/me"));
    expect(screen.queryByText("Could not load emails")).toBeNull();
    expect(callsTo(fetch, ME)).toBe(2);
    expect(callsTo(fetch, EMAILS)).toBe(1);
  });

  it("404: Registration not found, once, no table and no retry", async () => {
    const { fetch } = app(PAGE, { [EMAILS]: notFound });
    expect((await main().findByRole("alert")).textContent).toBe("Registration not found");
    expect(main().getByText("This link is not valid or the registration does not exist.")).toBeTruthy();
    await settle();
    expect(main().getAllByText("Registration not found")).toHaveLength(1);
    expect(main().queryByRole("table")).toBeNull();
    expect(main().queryByRole("button")).toBeNull();
    expect(h1()).toBe("Emails");
    expect(main().getByRole("link", { name: "Registrations" }).getAttribute("href")).toBe(LIST_PAGE);
    expect(callsTo(fetch, EMAILS)).toBe(1);
  });
});

describe("W-EM12: the states (test first)", () => {
  it('"Loading emails..." until the first answer, with the h1 "Emails"', async () => {
    const first = deferred<Response>();
    app(PAGE, { [EMAILS]: () => first.promise });
    const status = await main().findByRole("status");
    expect(status.textContent).toBe("Loading emails...");
    expect(h1()).toBe("Emails");
    expect(main().queryByRole("table")).toBeNull();
    await act(async () => first.resolve(json(200, body(TICKET))));
    expect(await main().findByRole("table")).toBeTruthy();
    expect(main().queryByText("Loading emails...")).toBeNull();
  });

  it("empty: No emails for this attendee yet. and no table", async () => {
    app(PAGE, { [EMAILS]: ok(body()) });
    expect(await main().findByText("No emails for this attendee yet.")).toBeTruthy();
    expect(main().queryByRole("table")).toBeNull();
    expect(h1()).toBe("Emails of Olga Test");
  });

  it.each<[string, Handler]>([
    ["5xx", failed],
    [
      "network error",
      () => {
        throw new TypeError("Failed to fetch");
      },
    ],
  ])("%s: Could not load emails with Retry, which reads only this query again", async (_case, failure) => {
    const { fetch } = app(PAGE, { [EMAILS]: answers(failure, ok(body(TICKET))) });
    const alert = await main().findByRole("alert");
    expect(alert.textContent).toBe("Could not load emails");
    expect(alert.classList.contains("error-box")).toBe(true);
    expect(main().queryByRole("table")).toBeNull();
    expect(h1()).toBe("Emails");
    await settle();
    // No automatic retry.
    expect(callsTo(fetch, EMAILS)).toBe(1);
    const retry = main().getByRole("button", { name: "Retry" });
    expect(retry.getAttribute("type")).toBe("button");
    expect(retry.classList.contains("button-secondary")).toBe(true);
    fireEvent.click(retry);
    expect(await main().findByRole("table")).toBeTruthy();
    expect(callsTo(fetch, EMAILS)).toBe(2);
    expect(fetch.mock.calls).toHaveLength(3);
    expect(main().queryByText("Could not load emails")).toBeNull();
  });
});

describe("W-EM8, W-EM10: the table", () => {
  it("the columns in order, the cells as sent, in the API order, dates in <time>", async () => {
    const { fetch } = app(PAGE, { [EMAILS]: ok(body(FAILED, PENDING, TICKET)) });
    const table = await main().findByRole("table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((th) => [th.textContent, th.getAttribute("scope")]),
    ).toEqual([
      ["Kind", "col"],
      ["Status", "col"],
      ["To", "col"],
      ["Subject", "col"],
      ["Created", "col"],
      ["Sent at", "col"],
      ["Failed tries", "col"],
      ["Error", "col"],
    ]);
    expect(bodyRows().map(cellsOf)).toEqual([
      [
        "Reminder",
        "Sending failed",
        "olga@example.com",
        "Tomorrow: Spring meetup",
        formatDateTime(FAILED.created_at),
        "",
        "3",
        "provider timeout",
      ],
      [
        "Reminder",
        "Pending",
        "olga@example.com",
        "Reminder: Spring meetup",
        formatDateTime(PENDING.created_at),
        "",
        "1",
        "rate limited",
      ],
      [
        "Ticket",
        "Sent",
        "olga@example.com",
        "Your ticket for Spring meetup",
        formatDateTime(TICKET.created_at),
        formatDateTime(TICKET.sent_at!),
        "0",
        "",
      ],
    ]);
    const [failedRow, , ticketRow] = bodyRows();
    const created = within(ticketRow).getAllByRole("cell")[4].querySelector("time")!;
    expect(created.getAttribute("datetime")).toBe(TICKET.created_at);
    const sent = within(ticketRow).getAllByRole("cell")[5].querySelector("time")!;
    expect(sent.getAttribute("datetime")).toBe(TICKET.sent_at);
    // An empty Sent at cell has no <time> and no dash.
    expect(within(failedRow).getAllByRole("cell")[5].querySelector("time")).toBeNull();
    expect(callsTo(fetch, EMAILS)).toBe(1);
    expect(fetch.mock.calls.some(([input]) => input === `/events/${EVENT_ID}/registrations/${RID}/emails`)).toBe(true);
  });

  it("strings are drawn as text, never as HTML", async () => {
    app(PAGE, {
      [EMAILS]: ok({
        attendee_name: "<i>Olga</i>",
        emails: [email({ subject: "<b>Hi</b>", send_error: "<img src=x>" })],
      }),
    });
    expect(await main().findByText("<b>Hi</b>")).toBeTruthy();
    expect(main().getByText("<img src=x>")).toBeTruthy();
    expect(h1()).toBe("Emails of <i>Olga</i>");
    expect(screen.getByRole("main").querySelector("b, i, img")).toBeNull();
  });
});

describe("W-EM9: the words in the table (test first)", () => {
  it("all five kinds, all three statuses, and unknown values as received", async () => {
    const items = [
      email({ id: "10000000-0000-4000-8000-000000000001", kind: "ticket", status: "pending" }),
      email({ id: "10000000-0000-4000-8000-000000000002", kind: "promotion", status: "sent" }),
      email({ id: "10000000-0000-4000-8000-000000000003", kind: "reminder", status: "error_sending" }),
      email({ id: "10000000-0000-4000-8000-000000000004", kind: "reschedule", status: "sent" }),
      email({ id: "10000000-0000-4000-8000-000000000005", kind: "event_cancelled", status: "sent" }),
      email({ id: "10000000-0000-4000-8000-000000000006", kind: "newsletter", status: "bounced" }),
    ];
    app(PAGE, { [EMAILS]: ok(body(...items)) });
    await main().findByRole("table");
    expect(bodyRows().map((row) => cellsOf(row).slice(0, 2))).toEqual([
      ["Ticket", "Pending"],
      ["Promotion", "Sent"],
      ["Reminder", "Sending failed"],
      ["Reschedule", "Sent"],
      ["Event cancelled", "Sent"],
      ["newsletter", "bounced"],
    ]);
    // Words, not colour: no badge in the table.
    expect(main().getByRole("table").querySelector(".badge")).toBeNull();
  });
});

describe("W-EM11: no claim of delivery (test first)", () => {
  it("pending, sent and failed rows: no word about an inbox", async () => {
    app(PAGE, { [EMAILS]: ok(body(FAILED, PENDING, TICKET)) });
    await main().findByRole("table");
    const text = screen.getByRole("main").textContent ?? "";
    for (const word of ["delivered", "arrived", "received", "inbox", "read", "opened"]) {
      expect(text).not.toMatch(new RegExp(`\\b${word}\\b`, "i"));
    }
  });
});

describe("W-EM13: the heading and the back link (test first)", () => {
  it("with data: only the back link, the h1 and the table; no button", async () => {
    app(PAGE, { [EMAILS]: ok(body(PENDING, TICKET)) });
    const table = await main().findByRole("table");
    const links = backLinks();
    expect(links).toHaveLength(1);
    const link = main().getByRole("link", { name: "Registrations" });
    expect(links[0]).toBe(link);
    expect(link.textContent).toBe("← Registrations");
    expect(link.getAttribute("href")).toBe(LIST_PAGE);
    const heading = main().getByRole("heading", { level: 1 });
    expect(heading.textContent).toBe("Emails of Olga Test");
    expect(link.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("main").textContent).toBe(
      `${link.textContent}${heading.textContent}${table.textContent}`,
    );
    expect(main().queryByRole("button")).toBeNull();
  });

  it('the h1 is "Emails" and the back link is there in the other states', async () => {
    app(PAGE, { [EMAILS]: () => deferred<Response>().promise });
    await main().findByText("Loading emails...");
    expect(h1()).toBe("Emails");
    expect(backLinks()).toHaveLength(1);
    expect(main().getByRole("link", { name: "Registrations" }).getAttribute("href")).toBe(LIST_PAGE);
  });
});

describe("W-EM15: accessibility and layout", () => {
  it("the table sits in a table-card on the organizer page; no live region for data", async () => {
    app(PAGE, { [EMAILS]: ok(body(TICKET)) });
    const table = await main().findByRole("table");
    expect(table.classList.contains("table")).toBe(true);
    expect(table.parentElement!.classList.contains("table-card")).toBe(true);
    const section = main().getByRole("heading", { level: 1 }).closest("section")!;
    expect(section.getAttribute("data-role")).toBe("organizer");
    expect(section.classList.contains("list-page")).toBe(true);
    expect(screen.getByRole("main").querySelectorAll("[aria-live], [role='alert'], [role='status']")).toHaveLength(0);
  });
});
