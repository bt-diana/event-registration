// cancel-registration-web.md (test first): the "Cancel registration" section of the ticket
// page. W-CR2 (button), W-CR3 (confirm panel), W-CR4 (one request, pending), W-CR5
// (success), W-CR6 (invalidated keys), W-CR7 (errors), W-CR10 (cache by account), W-CR11
// (nothing is live), parts of W-CR12. Through the whole app at the ticket page, fetch mocked.
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { ME_KEY } from "../auth/session";
import {
  ANN,
  OLGA,
  callsTo,
  deferred,
  json,
  mockFetch,
  renderApp,
} from "../auth/test-helpers";
import { EVENT_ID, publicEvent, type SamplePublicEvent } from "../events/test-helpers";
import { drawQr } from "./qr";
import {
  BEN,
  MY_REGISTRATION,
  SECOND_EVENT_ID,
  registration,
  type SampleRegistration,
} from "./test-helpers";

vi.mock("./qr", () => ({ drawQr: vi.fn() }));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Handler = () => Response | Promise<Response>;

const ME = "GET /auth/me";
const PUBLIC = `GET /public/events/${EVENT_ID}`;
const CANCEL = `POST /events/${EVENT_ID}/registrations/me/cancel`;
const TICKET_PATH = `/registrations/me?event=${EVENT_ID}`;

const ok = (body: unknown): Handler => () => json(200, body);
const conflict = (code: string): Handler => () => json(409, { error: code });

const WAITING = registration({ status: "waitlisted", waitlist_position: 2, ticket_code: "H4Z8WR5NCD" });
const SEAT_TEXT =
  "Your seat goes to the next person on the waiting list. If you register again later and the event is full, you join the end of the waiting list.";
const WAITING_TEXT =
  "You lose your place. If you join again later, you go to the end of the list.";
const SEAT_DONE = "Registration cancelled. Your seat is free for someone else.";
const WAITING_DONE = "Registration cancelled. You are no longer on the waiting list.";
const FAILED = "Something went wrong. Try again.";

// Each value in turn, then the last one again.
function sequence(...answers: Handler[]): Handler {
  let n = 0;
  return () => answers[Math.min(n++, answers.length - 1)]();
}

function main() {
  return within(screen.getByRole("main"));
}

function location(): string | null {
  return screen.getByTestId("location").textContent;
}

function keyOf([input, init]: [RequestInfo | URL, RequestInit?]): string {
  return `${init?.method ?? "GET"} ${String(input)}`;
}

type Setup = {
  me?: Handler;
  event?: Handler;
  mine?: Handler;
  cancel?: Handler;
  extra?: Record<string, Handler>;
};

async function ticketPage({
  me = ok(ANN),
  event = ok(publicEvent()),
  mine = ok(registration()),
  cancel = ok(registration({ status: "cancelled" })),
  extra = {},
}: Setup = {}) {
  const fetch = mockFetch({ [ME]: me, [PUBLIC]: event, [MY_REGISTRATION]: mine, [CANCEL]: cancel, ...extra });
  const result = renderApp(TICKET_PATH);
  await main().findByRole("heading", { level: 1, name: "Your ticket" });
  await waitFor(() => expect(main().queryByText("Loading...")).toBeNull());
  return { fetch, ...result };
}

function cancelButton() {
  return main().getByRole("button", { name: "Cancel registration" });
}

function panel() {
  return main().queryByRole("group");
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

// Opens the panel and confirms; waits until the answer is on screen.
async function confirmCancel() {
  fireEvent.click(cancelButton());
  fireEvent.click(main().getByRole("button", { name: "Yes, cancel registration" }));
  await waitFor(() => expect(panel()).toBeNull());
}

describe("W-CR2: the button", () => {
  it("a registered ticket: one secondary button under the QR; no h2 while closed", async () => {
    await ticketPage();
    const button = cancelButton();
    expect(button.getAttribute("type")).toBe("button");
    expect(button.classList.contains("button-secondary")).toBe(true);
    expect(main().getAllByRole("button")).toEqual([button]);
    const qr = main().getByRole("img", { name: "QR code for ticket K7M2QX9TPA" });
    expect(qr.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(main().queryByRole("heading", { level: 2 })).toBeNull();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("a waiting ticket has it too", async () => {
    await ticketPage({ event: ok(publicEvent({ full: true, seats_left: 0 })), mine: ok(WAITING) });
    expect(cancelButton()).toBeTruthy();
  });

  it("a click sends nothing and replaces the button with the panel", async () => {
    const { fetch } = await ticketPage();
    const before = fetch.mock.calls.length;
    fireEvent.click(cancelButton());
    expect(panel()).toBeTruthy();
    expect(main().queryByRole("button", { name: "Cancel registration" })).toBeNull();
    await settle();
    expect(fetch.mock.calls.length).toBe(before);
    expect(callsTo(fetch, CANCEL)).toBe(0);
  });
});

describe("W-CR3: the confirm panel", () => {
  it.each<[string, SampleRegistration, string, string]>([
    ["registered", registration(), "Cancel your registration?", SEAT_TEXT],
    ["waitlisted", WAITING, "Leave the waiting list?", WAITING_TEXT],
  ])("%s: the wording, both buttons, focus on Keep, no request", async (_case, r, heading, text) => {
    const confirm = vi.spyOn(window, "confirm");
    const { fetch } = await ticketPage({ mine: ok(r) });
    fireEvent.click(cancelButton());
    const group = main().getByRole("group", { name: heading });
    expect(group.tagName).toBe("DIV");
    const h2 = within(group).getByRole("heading", { level: 2, name: heading });
    expect(group.getAttribute("aria-labelledby")).toBe(h2.id);
    expect(within(group).getByText(text)).toBeTruthy();
    const yes = within(group).getByRole("button", { name: "Yes, cancel registration" });
    const keep = within(group).getByRole("button", { name: "Keep registration" });
    expect(yes.getAttribute("type")).toBe("button");
    expect(keep.getAttribute("type")).toBe("button");
    expect(yes.classList.contains("button-primary")).toBe(true);
    expect(keep.classList.contains("button-secondary")).toBe(true);
    await waitFor(() => expect(document.activeElement).toBe(keep));
    expect(document.querySelector("dialog")).toBeNull();
    expect(confirm).not.toHaveBeenCalled();
    await settle();
    expect(callsTo(fetch, CANCEL)).toBe(0);
  });

  it("Keep registration closes the panel, sends nothing, focus back on the button", async () => {
    const { fetch } = await ticketPage();
    const before = fetch.mock.calls.length;
    fireEvent.click(cancelButton());
    fireEvent.click(main().getByRole("button", { name: "Keep registration" }));
    expect(panel()).toBeNull();
    expect(main().queryByRole("heading", { level: 2 })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(cancelButton()));
    await settle();
    expect(fetch.mock.calls.length).toBe(before);
  });
});

describe("W-CR4: one request, pending", () => {
  it("two quick clicks send one POST with no body and no Content-Type; pending state", async () => {
    const answer = deferred<Response>();
    const { fetch } = await ticketPage({ cancel: () => answer.promise });
    fireEvent.click(cancelButton());
    const yes = main().getByRole("button", { name: "Yes, cancel registration" });
    fireEvent.click(yes);
    fireEvent.click(yes);
    await waitFor(() => expect(callsTo(fetch, CANCEL)).toBe(1));
    const group = main().getByRole("group");
    await waitFor(() => expect(group.getAttribute("aria-busy")).toBe("true"));
    const buttons = within(group).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Cancelling...", "Keep registration"]);
    expect(buttons.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    fireEvent.click(buttons[0]);
    await settle();
    expect(callsTo(fetch, CANCEL)).toBe(1);

    const call = fetch.mock.calls.find((c) => keyOf(c) === CANCEL)!;
    expect(String(call[0])).toBe(`/events/${EVENT_ID}/registrations/me/cancel`);
    expect(call[1]?.method).toBe("POST");
    expect(call[1]?.body).toBeUndefined();
    expect(new Headers(call[1]?.headers).has("Content-Type")).toBe(false);

    answer.resolve(json(200, registration({ status: "cancelled" })));
    expect(await main().findByRole("status")).toBeTruthy();
  });

  it("the guard is released after the answer: a second try sends a second request", async () => {
    const { fetch } = await ticketPage({
      cancel: sequence(() => json(500, { error: "internal" }), ok(registration({ status: "cancelled" }))),
    });
    await confirmCancel();
    expect(main().getByRole("alert").textContent).toBe(FAILED);
    await confirmCancel();
    expect(callsTo(fetch, CANCEL)).toBe(2);
    expect(main().getByRole("status").textContent).toBe(SEAT_DONE);
  });
});

describe("W-CR5: success", () => {
  it.each<[string, SampleRegistration, string]>([
    ["a seat", registration(), SEAT_DONE],
    ["a waiting place", WAITING, WAITING_DONE],
  ])("%s: cancelled ticket, no QR, no section, the message with focus, the link", async (_case, r, text) => {
    const { fetch } = await ticketPage({
      mine: ok(r),
      cancel: ok({ ...r, status: "cancelled", waitlist_position: null }),
    });
    await confirmCancel();
    const message = main().getByRole("status");
    expect(message.textContent).toBe(text);
    expect(message.getAttribute("tabindex")).toBe("-1");
    await waitFor(() => expect(document.activeElement).toBe(message));
    // The ticket as W-R7 shows a cancelled one.
    expect(main().getByText("Cancelled", { selector: ".badge" })).toBeTruthy();
    expect(main().getByText(r.ticket_code)).toBeTruthy();
    expect(main().getByText("This ticket is no longer valid.")).toBeTruthy();
    expect(main().queryByRole("img")).toBeNull();
    // No section controls.
    expect(main().queryByRole("button")).toBeNull();
    expect(main().queryByRole("heading", { level: 2 })).toBeNull();
    const link = main().getByRole("link", { name: "Go to the event" });
    expect(link.getAttribute("href")).toBe(`/event/${EVENT_ID}`);
    expect(link.classList.contains("button-link")).toBe(true);
    // No extra request: the answer is stored, nothing is read again.
    await settle();
    expect(fetch.mock.calls.map(keyOf)).toEqual([ME, PUBLIC, MY_REGISTRATION, CANCEL]);
  });

  it("a 200 for a ticket that was already cancelled (a second tab) is shown the same way", async () => {
    await ticketPage({ cancel: ok(registration({ status: "cancelled" })) });
    await confirmCancel();
    expect(main().getByRole("status").textContent).toBe(SEAT_DONE);
    expect(main().getByText("Cancelled", { selector: ".badge" })).toBeTruthy();
  });
});

describe("W-CR6: what a success invalidates", () => {
  it("the attendee list, the public event and the home list; nothing else", async () => {
    const answer = registration({ status: "cancelled" });
    const { queryClient } = await ticketPage({ cancel: ok(answer) });
    queryClient.setQueryData(["registrations", ANN.id], { registrations: [] });
    queryClient.setQueryData(["public-events"], []);
    queryClient.setQueryData(["public-event", SECOND_EVENT_ID], publicEvent({ id: SECOND_EVENT_ID }));
    queryClient.setQueryData(["event-arrivals"], { capacity: 25, registered: 1, arrived: 0 });
    queryClient.setQueryData(["event-registrations", OLGA.id, EVENT_ID], []);
    queryClient.setQueryData(["registration-emails", OLGA.id, EVENT_ID, answer.id], []);
    await confirmCancel();
    expect(queryClient.getQueryData(["registration", ANN.id, EVENT_ID])).toEqual(answer);
    expect(queryClient.getQueryState(["registrations", ANN.id])?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(["public-event", EVENT_ID])?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(["public-events"])?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(["public-event", SECOND_EVENT_ID])?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(["event-arrivals"])?.isInvalidated).toBe(false);
    expect(
      queryClient.getQueryState(["event-registrations", OLGA.id, EVENT_ID])?.isInvalidated,
    ).toBe(false);
    expect(
      queryClient.getQueryState(["registration-emails", OLGA.id, EVENT_ID, answer.id])?.isInvalidated,
    ).toBe(false);
  });
});

describe("W-CR7: errors", () => {
  async function expectAlert(text: string) {
    const alert = await main().findByRole("alert");
    expect(alert.textContent).toBe(text);
    expect(alert.classList.contains("error-box")).toBe(true);
    expect(alert.getAttribute("tabindex")).toBe("-1");
    await waitFor(() => expect(document.activeElement).toBe(alert));
    expect(panel()).toBeNull();
    return alert;
  }

  it("409 already_checked_in: the text; the registration is read again (Checked in, no section)", async () => {
    const { fetch } = await ticketPage({
      mine: sequence(ok(registration()), ok(registration({ checked_in_at: "2030-01-01T09:55:00.000Z" }))),
      cancel: conflict("already_checked_in"),
    });
    await confirmCancel();
    await expectAlert("You have already checked in, so this registration cannot be cancelled.");
    await waitFor(() => expect(main().getByText("Checked in", { selector: ".badge" })).toBeTruthy());
    expect(main().queryByRole("button", { name: "Cancel registration" })).toBeNull();
    expect(main().getByRole("alert")).toBeTruthy();
    expect(callsTo(fetch, MY_REGISTRATION)).toBe(2);
    expect(callsTo(fetch, PUBLIC)).toBe(1);
  });

  it.each<[string, string, Partial<SamplePublicEvent>]>([
    [
      "event_started",
      "This event has already started, so the registration can no longer be cancelled.",
      { has_started: true },
    ],
    [
      "event_passed",
      "This event has ended, so the registration can no longer be cancelled.",
      { status: "passed", has_started: true, seats_left: 0 },
    ],
  ])("409 %s: the text; the public event is read again and the section hides", async (code, text, later) => {
    const { fetch } = await ticketPage({
      event: sequence(ok(publicEvent()), ok(publicEvent(later))),
      cancel: conflict(code),
    });
    await confirmCancel();
    await expectAlert(text);
    await waitFor(() => expect(callsTo(fetch, PUBLIC)).toBe(2));
    await waitFor(() =>
      expect(main().queryByRole("button", { name: "Cancel registration" })).toBeNull(),
    );
    expect(main().getByRole("alert").textContent).toBe(text);
    expect(callsTo(fetch, MY_REGISTRATION)).toBe(1);
  });

  it("409 event_cancelled: the text; the public event and the registration are read again", async () => {
    const { fetch } = await ticketPage({
      event: sequence(ok(publicEvent()), ok(publicEvent({ status: "cancelled", seats_left: 0 }))),
      mine: sequence(ok(registration()), ok(registration({ status: "cancelled" }))),
      cancel: conflict("event_cancelled"),
    });
    await confirmCancel();
    await expectAlert("This event has been cancelled.");
    await waitFor(() => expect(callsTo(fetch, PUBLIC)).toBe(2));
    await waitFor(() => expect(callsTo(fetch, MY_REGISTRATION)).toBe(2));
    await waitFor(() =>
      expect(main().getByText("Cancelled", { selector: ".badge" })).toBeTruthy(),
    );
    expect(main().queryByRole("button", { name: "Cancel registration" })).toBeNull();
    expect(main().getByRole("alert").textContent).toBe("This event has been cancelled.");
  });

  it("404: no text; both reads run again and the page shows no ticket", async () => {
    const { fetch } = await ticketPage({
      mine: sequence(ok(registration()), () => json(404, { error: "not_found" })),
      cancel: () => json(404, { error: "not_found" }),
    });
    fireEvent.click(cancelButton());
    fireEvent.click(main().getByRole("button", { name: "Yes, cancel registration" }));
    expect(await main().findByText("You have no ticket for this event.")).toBeTruthy();
    expect(callsTo(fetch, MY_REGISTRATION)).toBe(2);
    expect(callsTo(fetch, PUBLIC)).toBe(2);
    expect(main().queryByRole("alert")).toBeNull();
  });

  it("401: me is read again and the guard sends to the login; no text", async () => {
    const { fetch } = await ticketPage({
      me: sequence(ok(ANN), () => json(401, { error: "not_logged_in" })),
      cancel: () => json(401, { error: "not_logged_in" }),
    });
    fireEvent.click(cancelButton());
    fireEvent.click(main().getByRole("button", { name: "Yes, cancel registration" }));
    await waitFor(() =>
      expect(location()).toBe(`/login?next=${encodeURIComponent(TICKET_PATH)}`),
    );
    expect(callsTo(fetch, ME)).toBe(2);
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it("403: me is read again; an organizer goes to /registrations; no text", async () => {
    const { fetch } = await ticketPage({
      me: sequence(ok(ANN), ok(OLGA)),
      cancel: () => json(403, { error: "wrong_role" }),
      extra: { "GET /events": () => json(200, { events: [] }) },
    });
    fireEvent.click(cancelButton());
    fireEvent.click(main().getByRole("button", { name: "Yes, cancel registration" }));
    await waitFor(() => expect(location()).toBe("/registrations"));
    expect(callsTo(fetch, ME)).toBe(2);
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it.each<[string, Handler]>([
    ["a network error", () => Promise.reject(new TypeError("Failed to fetch"))],
    ["a 500", () => json(500, { error: "internal" })],
    ["a 409 with an unknown code", conflict("something_else")],
    ["a 409 with no code", () => json(409, {})],
  ])("%s: Something went wrong, nothing read again, the button is back, no retry", async (_case, cancel) => {
    const { fetch, queryClient } = await ticketPage({ cancel });
    await confirmCancel();
    await expectAlert(FAILED);
    expect(cancelButton()).toBeTruthy();
    await settle();
    expect(fetch.mock.calls.map(keyOf)).toEqual([ME, PUBLIC, MY_REGISTRATION, CANCEL]);
    expect(queryClient.getQueryState(["public-event", EVENT_ID])?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(["registration", ANN.id, EVENT_ID])?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(ME_KEY)?.isInvalidated).toBe(false);
  });
});

describe("W-CR10: cache by account", () => {
  it("A's message and answer are not shown for B; B's ticket is read for B", async () => {
    const annCancelled = registration({ status: "cancelled" });
    const benTicket = registration({ id: "b0000000-0000-4000-8000-000000000001", ticket_code: "B3NT1CK3TZ" });
    const { fetch, queryClient } = await ticketPage({
      mine: sequence(ok(registration()), ok(benTicket)),
      cancel: ok(annCancelled),
    });
    await confirmCancel();
    expect(main().getByRole("status").textContent).toBe(SEAT_DONE);
    const [mutation] = queryClient.getMutationCache().getAll();
    expect(mutation.state.variables).toBe(ANN.id);

    act(() => {
      queryClient.setQueryData(ME_KEY, BEN);
    });
    expect(await main().findByText("B3NT1CK3TZ")).toBeTruthy();
    expect(main().queryByText(SEAT_DONE)).toBeNull();
    expect(main().queryByRole("status")).toBeNull();
    expect(main().getByText("Registered", { selector: ".badge" })).toBeTruthy();
    expect(cancelButton()).toBeTruthy();
    expect(callsTo(fetch, MY_REGISTRATION)).toBe(2);
    expect(queryClient.getQueryData(["registration", BEN.id, EVENT_ID])).toEqual(benTicket);
    expect(queryClient.getQueryData(["registration", ANN.id, EVENT_ID])).toEqual(annCancelled);
  });
});

describe("W-CR11: nothing is live", () => {
  async function quietMinute(fetch: ReturnType<typeof mockFetch>) {
    const before = fetch.mock.calls.length;
    vi.useFakeTimers();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(60_000);
    });
    vi.useRealTimers();
    expect(fetch.mock.calls.length).toBe(before);
  }

  it("after mount and after a cancel: 60 s, visibilitychange and online send nothing", async () => {
    const { fetch } = await ticketPage();
    await quietMinute(fetch);
    await confirmCancel();
    expect(main().getByRole("status").textContent).toBe(SEAT_DONE);
    expect(fetch.mock.calls.map(keyOf)).toEqual([ME, PUBLIC, MY_REGISTRATION, CANCEL]);
    await quietMinute(fetch);
  });
});

describe("W-CR12: the look of the section", () => {
  it("one h1; the panel h2 only while open; no button looks like danger", async () => {
    await ticketPage();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    fireEvent.click(cancelButton());
    expect(main().getAllByRole("heading", { level: 2 })).toHaveLength(1);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    for (const button of main().getAllByRole("button")) {
      expect(button.className).not.toMatch(/danger|destructive|error/);
    }
  });
});

// A drawn QR is not part of these tests; only its presence is checked.
afterEach(() => {
  vi.mocked(drawQr).mockClear();
});
