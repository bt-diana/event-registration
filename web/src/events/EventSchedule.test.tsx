// Tests first (email-reminders-web.md, M7, step 39): W-EM16, W-EM18-W-EM28, W-EM34; then
// W-EM17, W-EM33. The owner view of /event/:id with the reschedule form and the cancel
// confirm panel (POST /events/{id}/reschedule, POST /events/{id}/cancel).
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { QueryClient } from "@tanstack/react-query";
import { ApiError } from "../auth/api";
import { ANN, OLGA, callsTo, deferred, json, mockFetch, renderApp } from "../auth/test-helpers";
import { EventActionError, cancelEvent, rescheduleEvent } from "./api";
import { formatDateTime, toLocalInput } from "./format";
import { EVENT_ID, organizerEvent, publicEvent } from "./test-helpers";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

type Handler = () => Response | Promise<Response>;

const ME = "GET /auth/me";
const OWN = `GET /events/${EVENT_ID}`;
const PUBLIC = `GET /public/events/${EVENT_ID}`;
const MY_REGISTRATION = `GET /events/${EVENT_ID}/registrations/me`;
const RESCHEDULE = `POST /events/${EVENT_ID}/reschedule`;
const CANCEL = `POST /events/${EVENT_ID}/cancel`;
const OTHER_ID = "5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d";
const REGISTRATION_ID = "9c8b7a6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d";

const START = "2030-01-01T10:00:00.000Z";
const NEW_START_INPUT = "2030-02-01T18:30";
const NEW_START = new Date(NEW_START_INPUT).toISOString();
const NEW_END = new Date(Date.parse(NEW_START) + 90 * 60_000).toISOString();

const TEXT = {
  field: "Choose a start in the future.",
  same: "That is already the start time. Nothing changed.",
  rescheduled: "Event rescheduled. Emails to registered and waiting people are queued.",
  confirm:
    "All registrations and the waiting list are cancelled and those people get an email. People who already checked in keep their ticket. This cannot be undone.",
  cancelled: "Event cancelled. Registrations are cancelled and emails to those people are queued.",
  rescheduleCancelled: "This event is cancelled and cannot be changed.",
  reschedulePassed: "This event has already ended and cannot be changed.",
  rescheduleStarted: "This event has already started and cannot be changed.",
  cancelStarted: "This event has already started and cannot be cancelled.",
  cancelPassed: "This event has already ended and cannot be cancelled.",
  alreadyCancelled: "This event is already cancelled.",
  failed: "Something went wrong. Try again.",
};

const ok = (body: unknown): Handler => () => json(200, body);
const error = (status: number, code?: string): Handler => () =>
  json(status, code === undefined ? undefined : { error: code });
const networkError: Handler = () => {
  throw new TypeError("Failed to fetch");
};
const loggedOut = error(401, "not_logged_in");

// Answers in turn; the last one repeats.
function answers(...list: Handler[]): Handler {
  let n = 0;
  return () => list[Math.min(n++, list.length - 1)]();
}

const MOVED = organizerEvent({ starts_at: NEW_START, ends_at: NEW_END, schedule_version: 2 });
const CANCELLED = organizerEvent({
  status: "cancelled",
  cancelled_at: "2026-10-18T12:00:00.000Z",
  registered: 2,
  seats_left: 23,
});
// A running event as the refetch after a 409 event_started shows it.
const RUNNING = organizerEvent({
  starts_at: "2026-01-01T10:00:00.000Z",
  ends_at: "2099-01-01T10:00:00.000Z",
  duration_minutes: 1440,
});

function main() {
  return within(screen.getByRole("main"));
}

function detail(label: string): string | null {
  return main().getByText(label, { selector: "dt" }).nextElementSibling?.textContent ?? null;
}

async function ownerPage(routes: Record<string, Handler> = {}, event = organizerEvent()) {
  const fetch = mockFetch({ [ME]: () => json(200, OLGA), [OWN]: ok(event), ...routes });
  const rendered = renderApp(`/event/${EVENT_ID}`);
  await main().findByRole("heading", { level: 1, name: "Spring meetup" });
  return { fetch, ...rendered };
}

function controls(): HTMLElement | null {
  return main().queryByRole("region", { name: "Change the event" });
}

function startField(): HTMLInputElement {
  return main().getByLabelText("New start") as HTMLInputElement;
}

function setStart(value: string) {
  fireEvent.change(startField(), { target: { value } });
}

function submitReschedule() {
  fireEvent.click(main().getByRole("button", { name: "Reschedule" }));
}

function openConfirm() {
  fireEvent.click(main().getByRole("button", { name: "Cancel event" }));
  return main().getByRole("group", { name: "Cancel this event?" });
}

function confirmCancel() {
  fireEvent.click(within(openConfirm()).getByRole("button", { name: "Yes, cancel event" }));
}

// The browser clock only (W-EM16); timers stay real so the queries and waitFor run.
function clockAt(iso: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
}

describe("W-EM16: the controls exist only while active and in the future (test first)", () => {
  it("active, starting later than the browser clock: the form and Cancel event", async () => {
    clockAt("2030-01-01T09:59:00.000Z");
    await ownerPage();
    const region = controls()!;
    expect(region).toBeTruthy();
    expect(within(region).getByRole("heading", { level: 2, name: "Reschedule" })).toBeTruthy();
    expect(within(region).getByLabelText("New start")).toBeTruthy();
    expect(within(region).getByRole("button", { name: "Reschedule" })).toBeTruthy();
    expect(within(region).getByRole("button", { name: "Cancel event" })).toBeTruthy();
  });

  it.each<[string, Parameters<typeof organizerEvent>[0], string]>([
    ["cancelled", { status: "cancelled" }, "2029-12-01T00:00:00.000Z"],
    ["passed (Ended)", { status: "passed" }, "2030-01-02T00:00:00.000Z"],
    ["active, started one minute ago", {}, "2030-01-01T10:01:00.000Z"],
    ["active, starting exactly now", {}, "2030-01-01T10:00:00.000Z"],
  ])("%s: no section at all, no button, no hint", async (_case, overrides, now) => {
    clockAt(now);
    await ownerPage({}, organizerEvent(overrides));
    expect(controls()).toBeNull();
    expect(main().queryAllByRole("button")).toEqual([]);
    expect(main().queryByLabelText("New start")).toBeNull();
    expect(main().queryByText(/Only events/)).toBeNull();
  });

  it.each<[string, Record<string, Handler>]>([
    ["logged out", { [ME]: loggedOut }],
    ["an attendee", { [ME]: ok(ANN), [MY_REGISTRATION]: error(404, "not_found") }],
    ["another organizer", { [ME]: ok(OLGA), [OWN]: error(404, "not_found") }],
  ])("the public view (%s) of the same event has none", async (_case, routes) => {
    clockAt("2029-12-01T00:00:00.000Z");
    mockFetch({ [OWN]: ok(organizerEvent()), [PUBLIC]: ok(publicEvent()), ...routes });
    renderApp(`/event/${EVENT_ID}`);
    await main().findByRole("heading", { level: 1, name: "Spring meetup" });
    await waitFor(() => expect(main().queryByText("Loading...")).toBeNull());
    expect(controls()).toBeNull();
    expect(main().queryByRole("button", { name: "Cancel event" })).toBeNull();
    expect(main().queryByRole("button", { name: "Reschedule" })).toBeNull();
    expect(main().queryByLabelText("New start")).toBeNull();
  });
});

describe("W-EM17: the reschedule form", () => {
  it("an h2, one labelled datetime-local field with min, empty, the zone hint and a primary button", async () => {
    await ownerPage();
    const region = controls()!;
    const form = region.querySelector("form")!;
    expect(form.noValidate).toBe(true);
    const field = startField();
    expect(field.getAttribute("type")).toBe("datetime-local");
    expect(field.value).toBe("");
    expect(field.getAttribute("min")).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    const hint = within(region).getByText(/^Your local time \(.+\)$/);
    expect(field.getAttribute("aria-describedby")?.split(" ")).toContain(hint.id);
    expect(field.getAttribute("aria-invalid")).toBeNull();
    const button = within(region).getByRole("button", { name: "Reschedule" });
    expect(button.getAttribute("type")).toBe("submit");
    expect(button.className).toContain("button-primary");
  });
});

describe("W-EM18: checks before any request (test first)", () => {
  it.each([
    ["empty", ""],
    ["in the past", "2020-01-01T10:00"],
  ])("%s: the field error, focus on the field, no request", async (_case, value) => {
    const { fetch } = await ownerPage();
    setStart(value);
    submitReschedule();
    const message = await main().findByText(TEXT.field);
    expect(message.getAttribute("role")).toBe("alert");
    expect(startField().getAttribute("aria-invalid")).toBe("true");
    expect(startField().getAttribute("aria-describedby")?.split(" ")).toContain(message.id);
    await waitFor(() => expect(document.activeElement).toBe(startField()));
    expect(callsTo(fetch, RESCHEDULE)).toBe(0);
  });

  it("the same instant as the current start: the notice as a status, no request", async () => {
    const { fetch } = await ownerPage();
    setStart(toLocalInput(new Date(START)));
    submitReschedule();
    const notice = await main().findByText(TEXT.same);
    expect(notice.getAttribute("role")).toBe("status");
    expect(main().queryByText(TEXT.field)).toBeNull();
    expect(startField().getAttribute("aria-invalid")).toBeNull();
    expect(callsTo(fetch, RESCHEDULE)).toBe(0);
  });
});

describe("W-EM19: the request (test first)", () => {
  it("one POST to the reschedule route with exactly starts_at as a UTC string", async () => {
    const { fetch } = await ownerPage({ [RESCHEDULE]: ok(MOVED) });
    setStart(NEW_START_INPUT);
    submitReschedule();
    await waitFor(() => expect(callsTo(fetch, RESCHEDULE)).toBe(1));
    const [, init] = fetch.mock.calls.find(([input]) => input === `/events/${EVENT_ID}/reschedule`)!;
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({ "Content-Type": "application/json" });
    expect(init?.body).toBe(JSON.stringify({ starts_at: NEW_START }));
    expect(JSON.parse(String(init?.body))).toEqual({ starts_at: NEW_START });
    expect(NEW_START).toMatch(/Z$/);
  });

  it("a field value of 2030-01-01T10:00 in CET is sent as 2030-01-01T09:00:00.000Z", async () => {
    vi.stubEnv("TZ", "Europe/Berlin");
    try {
      // The zone change took effect in this process.
      expect(new Date("2030-01-01T10:00").toISOString()).toBe("2030-01-01T09:00:00.000Z");
      const { fetch } = await ownerPage({ [RESCHEDULE]: ok(MOVED) });
      setStart("2030-01-01T10:00");
      submitReschedule();
      await waitFor(() => expect(callsTo(fetch, RESCHEDULE)).toBe(1));
      const [, init] = fetch.mock.calls.find(([input]) => input === `/events/${EVENT_ID}/reschedule`)!;
      expect(init?.body).toBe('{"starts_at":"2030-01-01T09:00:00.000Z"}');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("W-EM20: pending and double submit (test first)", () => {
  it("two quick submits make one request", async () => {
    const { fetch } = await ownerPage({ [RESCHEDULE]: ok(MOVED) });
    setStart(NEW_START_INPUT);
    submitReschedule();
    submitReschedule();
    await main().findByText(TEXT.rescheduled);
    expect(callsTo(fetch, RESCHEDULE)).toBe(1);
  });

  it("Rescheduling... and disabled while it runs, the value kept, the guard released after", async () => {
    const answer = deferred<Response>();
    const { fetch } = await ownerPage({
      [RESCHEDULE]: answers(() => answer.promise, ok(organizerEvent({ schedule_version: 3 }))),
    });
    setStart(NEW_START_INPUT);
    submitReschedule();
    const button = (await main().findByRole("button", {
      name: "Rescheduling...",
    })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    fireEvent.submit(button.closest("form")!);
    expect(callsTo(fetch, RESCHEDULE)).toBe(1);
    expect(startField().value).toBe(NEW_START_INPUT);

    await act(async () => answer.resolve(json(200, MOVED)));
    await main().findByText(TEXT.rescheduled);
    setStart("2030-03-01T09:00");
    submitReschedule();
    await waitFor(() => expect(callsTo(fetch, RESCHEDULE)).toBe(2));
  });
});

describe("W-EM21: success, the time changed (test first)", () => {
  it("the new Starts and Ends at once, the field cleared, the message as a status with focus", async () => {
    const { fetch } = await ownerPage({ [RESCHEDULE]: ok(MOVED) });
    expect(detail("Starts")).toBe(formatDateTime(START));
    setStart(NEW_START_INPUT);
    submitReschedule();
    const message = await main().findByText(TEXT.rescheduled);
    expect(message.getAttribute("role")).toBe("status");
    expect(message.getAttribute("tabindex")).toBe("-1");
    await waitFor(() => expect(document.activeElement).toBe(message));
    expect(detail("Starts")).toBe(formatDateTime(NEW_START));
    expect(detail("Ends")).toBe(formatDateTime(NEW_END));
    expect(startField().value).toBe("");
    // The answer is the new state: the event is not read again.
    expect(callsTo(fetch, OWN)).toBe(1);
  });
});

describe("W-EM22: success, nothing changed (test first)", () => {
  it("the same schedule_version: the notice, the answer cached, the field kept", async () => {
    const same = organizerEvent({ title: "Spring meetup", registered: 4, seats_left: 21 });
    const { fetch, queryClient } = await ownerPage({ [RESCHEDULE]: ok(same) });
    setStart(NEW_START_INPUT);
    submitReschedule();
    const notice = await main().findByText(TEXT.same);
    expect(notice.getAttribute("role")).toBe("status");
    expect(main().queryByText(TEXT.rescheduled)).toBeNull();
    expect(queryClient.getQueryData(["events", EVENT_ID])).toMatchObject({ registered: 4 });
    expect(detail("Registered")).toBe("4");
    expect(startField().value).toBe(NEW_START_INPUT);
    expect(callsTo(fetch, OWN)).toBe(1);
  });
});

describe("W-EM23: reschedule errors (test first)", () => {
  it.each<[string, Handler, string, ReturnType<typeof organizerEvent>]>([
    ["409 event_cancelled", error(409, "event_cancelled"), TEXT.rescheduleCancelled, CANCELLED],
    [
      "409 event_passed",
      error(409, "event_passed"),
      TEXT.reschedulePassed,
      organizerEvent({ status: "passed" }),
    ],
    ["409 event_started", error(409, "event_started"), TEXT.rescheduleStarted, RUNNING],
  ])("%s: the text as an alert with focus, the value kept, the event read again, the section gone", async (_case, failure, text, after) => {
    const { fetch } = await ownerPage({
      [OWN]: answers(ok(organizerEvent()), ok(after)),
      [RESCHEDULE]: failure,
    });
    setStart(NEW_START_INPUT);
    submitReschedule();
    const message = await main().findByText(text);
    expect(message.getAttribute("role")).toBe("alert");
    expect(message.getAttribute("tabindex")).toBe("-1");
    await waitFor(() => expect(document.activeElement).toBe(message));
    expect(startField().value).toBe(NEW_START_INPUT);
    await waitFor(() => expect(callsTo(fetch, OWN)).toBe(2));
    await waitFor(() => expect(controls()).toBeNull());
    // The message stays when the section goes (W-EM16).
    expect(main().getByText(text)).toBe(message);
    expect(callsTo(fetch, RESCHEDULE)).toBe(1);
  });

  it("400 invalid_input: the field error, focus on the field, the value kept", async () => {
    const { fetch } = await ownerPage({ [RESCHEDULE]: error(400, "invalid_input") });
    setStart(NEW_START_INPUT);
    submitReschedule();
    const message = await main().findByText(TEXT.field);
    expect(message.getAttribute("role")).toBe("alert");
    expect(message.className).toContain("field-error");
    expect(startField().getAttribute("aria-invalid")).toBe("true");
    await waitFor(() => expect(document.activeElement).toBe(startField()));
    expect(startField().value).toBe(NEW_START_INPUT);
    expect(main().getAllByRole("alert")).toEqual([message]);
    expect(callsTo(fetch, OWN)).toBe(1);
  });

  it.each<[string, Handler]>([
    ["a 5xx", error(500, "internal")],
    ["a network error", networkError],
    ["a 409 with an unknown code", error(409, "something_else")],
    ["a 409 with a body that is not JSON", () => new Response("Conflict", { status: 409 })],
  ])("%s: Something went wrong. Try again. as an alert with focus, no retry", async (_case, failure) => {
    const { fetch } = await ownerPage({ [RESCHEDULE]: failure });
    setStart(NEW_START_INPUT);
    submitReschedule();
    const message = await main().findByText(TEXT.failed);
    expect(message.getAttribute("role")).toBe("alert");
    await waitFor(() => expect(document.activeElement).toBe(message));
    expect(startField().value).toBe(NEW_START_INPUT);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(callsTo(fetch, RESCHEDULE)).toBe(1);
  });

  it("404: no text of its own, the event is read again and the page falls back to the public view", async () => {
    const { fetch } = await ownerPage({
      [OWN]: answers(ok(organizerEvent()), error(404, "not_found")),
      [PUBLIC]: ok(publicEvent()),
      [RESCHEDULE]: error(404, "not_found"),
    });
    setStart(NEW_START_INPUT);
    submitReschedule();
    await waitFor(() => expect(callsTo(fetch, PUBLIC)).toBe(1));
    await main().findByText("Event", { selector: ".eyebrow" });
    expect(controls()).toBeNull();
    expect(main().queryByRole("link", { name: "Registrations" })).toBeNull();
    expect(main().queryByText(TEXT.failed)).toBeNull();
    expect(callsTo(fetch, OWN)).toBe(2);
  });

  it.each<[string, Handler]>([
    ["401", error(401, "not_logged_in")],
    ["403", error(403, "wrong_role")],
  ])("%s: me is read again and the page follows it, no text of its own", async (_case, failure) => {
    const { fetch } = await ownerPage({
      [ME]: answers(ok(OLGA), loggedOut),
      [PUBLIC]: ok(publicEvent()),
      [RESCHEDULE]: failure,
    });
    setStart(NEW_START_INPUT);
    submitReschedule();
    await waitFor(() => expect(callsTo(fetch, ME)).toBe(2));
    await main().findByText("Event", { selector: ".eyebrow" });
    expect(controls()).toBeNull();
    expect(main().queryByText(TEXT.failed)).toBeNull();
    expect(callsTo(fetch, RESCHEDULE)).toBe(1);
  });
});

describe("W-EM24: Cancel event and the confirm step (test first)", () => {
  it("a click sends nothing and opens the panel; focus on Keep event; the form stays usable", async () => {
    const { fetch } = await ownerPage();
    const cancel = main().getByRole("button", { name: "Cancel event" });
    expect(cancel.getAttribute("type")).toBe("button");
    expect(cancel.className).toContain("button-secondary");
    const panel = openConfirm();
    expect(within(panel).getByRole("heading", { level: 2, name: "Cancel this event?" })).toBeTruthy();
    expect(within(panel).getByText(TEXT.confirm)).toBeTruthy();
    const yes = within(panel).getByRole("button", { name: "Yes, cancel event" });
    const keep = within(panel).getByRole("button", { name: "Keep event" });
    expect(yes.className).toContain("button-primary");
    expect(keep.className).toContain("button-secondary");
    await waitFor(() => expect(document.activeElement).toBe(keep));
    expect(main().queryByRole("button", { name: "Cancel event" })).toBeNull();
    const reschedule = main().getByRole("button", { name: "Reschedule" }) as HTMLButtonElement;
    expect(reschedule.disabled).toBe(false);
    expect(document.querySelector("dialog")).toBeNull();
    expect(callsTo(fetch, CANCEL)).toBe(0);
  });

  it("Keep event closes the panel, sends nothing and gives focus back to Cancel event", async () => {
    const { fetch } = await ownerPage();
    const panel = openConfirm();
    fireEvent.click(within(panel).getByRole("button", { name: "Keep event" }));
    expect(main().queryByRole("group", { name: "Cancel this event?" })).toBeNull();
    const cancel = main().getByRole("button", { name: "Cancel event" });
    await waitFor(() => expect(document.activeElement).toBe(cancel));
    expect(callsTo(fetch, CANCEL)).toBe(0);
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toEqual([]);
  });
});

describe("W-EM25: the cancel request and pending (test first)", () => {
  it("one POST with no body and no Content-Type; both buttons disabled; Cancelling...", async () => {
    const answer = deferred<Response>();
    const { fetch } = await ownerPage({ [CANCEL]: () => answer.promise });
    confirmCancel();
    const yes = (await main().findByRole("button", { name: "Cancelling..." })) as HTMLButtonElement;
    const keep = main().getByRole("button", { name: "Keep event" }) as HTMLButtonElement;
    expect(yes.disabled).toBe(true);
    expect(keep.disabled).toBe(true);
    fireEvent.click(yes);
    expect(callsTo(fetch, CANCEL)).toBe(1);
    const [, init] = fetch.mock.calls.find(([input]) => input === `/events/${EVENT_ID}/cancel`)!;
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeUndefined();
    expect(init?.headers).toBeUndefined();
    await act(async () => answer.resolve(json(200, CANCELLED)));
    await main().findByText(TEXT.cancelled);
    expect(callsTo(fetch, CANCEL)).toBe(1);
  });

  it("two quick clicks on Yes make one request", async () => {
    const { fetch } = await ownerPage({ [CANCEL]: ok(CANCELLED) });
    const panel = openConfirm();
    const yes = within(panel).getByRole("button", { name: "Yes, cancel event" });
    fireEvent.click(yes);
    fireEvent.click(yes);
    await main().findByText(TEXT.cancelled);
    expect(callsTo(fetch, CANCEL)).toBe(1);
  });
});

describe("W-EM26: cancel success (test first)", () => {
  it.each<[string, ReturnType<typeof organizerEvent>]>([
    ["cancelled now", CANCELLED],
    ["already cancelled (200 no-op)", CANCELLED],
  ])("%s: the Cancelled badge, no controls, the message as a status with focus", async (_case, answer) => {
    const { fetch } = await ownerPage({ [CANCEL]: ok(answer) });
    confirmCancel();
    const message = await main().findByText(TEXT.cancelled);
    expect(message.getAttribute("role")).toBe("status");
    expect(message.getAttribute("tabindex")).toBe("-1");
    await waitFor(() => expect(document.activeElement).toBe(message));
    expect(main().getByText("Cancelled")).toBeTruthy();
    expect(main().queryByText("Active")).toBeNull();
    expect(controls()).toBeNull();
    expect(main().queryAllByRole("button")).toEqual([]);
    expect(detail("Registered")).toBe("2");
    expect(detail("Seats left")).toBe("23");
    expect(callsTo(fetch, OWN)).toBe(1);
  });
});

describe("W-EM27: cancel errors (test first)", () => {
  it.each<[string, Handler, string, ReturnType<typeof organizerEvent>]>([
    ["409 event_started", error(409, "event_started"), TEXT.cancelStarted, RUNNING],
    [
      "409 event_passed",
      error(409, "event_passed"),
      TEXT.cancelPassed,
      organizerEvent({ status: "passed" }),
    ],
  ])("%s: the text as an alert with focus, the panel closed, the event read again", async (_case, failure, text, after) => {
    const { fetch } = await ownerPage({
      [OWN]: answers(ok(organizerEvent()), ok(after)),
      [CANCEL]: failure,
    });
    confirmCancel();
    const message = await main().findByText(text);
    expect(message.getAttribute("role")).toBe("alert");
    await waitFor(() => expect(document.activeElement).toBe(message));
    expect(main().queryByRole("group", { name: "Cancel this event?" })).toBeNull();
    await waitFor(() => expect(callsTo(fetch, OWN)).toBe(2));
    await waitFor(() => expect(controls()).toBeNull());
    expect(main().getByText(text)).toBe(message);
  });

  it("409 event_cancelled: This event is already cancelled. as a status, no queued sentence", async () => {
    const { fetch } = await ownerPage({
      [OWN]: answers(ok(organizerEvent()), ok(CANCELLED)),
      [CANCEL]: error(409, "event_cancelled"),
    });
    confirmCancel();
    const message = await main().findByText(TEXT.alreadyCancelled);
    expect(message.getAttribute("role")).toBe("status");
    await waitFor(() => expect(document.activeElement).toBe(message));
    expect(main().queryByText(/queued/)).toBeNull();
    await waitFor(() => expect(callsTo(fetch, OWN)).toBe(2));
    expect(await main().findByText("Cancelled")).toBeTruthy();
    expect(controls()).toBeNull();
  });

  it.each<[string, Handler]>([
    ["a 5xx", error(500, "internal")],
    ["a network error", networkError],
    ["a 409 with an unknown code", error(409, "something_else")],
  ])("%s: Something went wrong. Try again., the panel closed, Cancel event back", async (_case, failure) => {
    const { fetch } = await ownerPage({ [CANCEL]: failure });
    confirmCancel();
    const message = await main().findByText(TEXT.failed);
    expect(message.getAttribute("role")).toBe("alert");
    await waitFor(() => expect(document.activeElement).toBe(message));
    expect(main().queryByRole("group", { name: "Cancel this event?" })).toBeNull();
    expect(main().getByRole("button", { name: "Cancel event" })).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(callsTo(fetch, CANCEL)).toBe(1);
  });

  it("404: no text of its own, the page falls back to the public view", async () => {
    const { fetch } = await ownerPage({
      [OWN]: answers(ok(organizerEvent()), error(404, "not_found")),
      [PUBLIC]: ok(publicEvent()),
      [CANCEL]: error(404, "not_found"),
    });
    confirmCancel();
    await waitFor(() => expect(callsTo(fetch, PUBLIC)).toBe(1));
    await main().findByText("Event", { selector: ".eyebrow" });
    expect(controls()).toBeNull();
    expect(main().queryByText(TEXT.failed)).toBeNull();
  });

  it.each<[string, Handler]>([
    ["401", error(401, "not_logged_in")],
    ["403", error(403, "wrong_role")],
  ])("%s: me is read again, no text of its own", async (_case, failure) => {
    const { fetch } = await ownerPage({
      [ME]: answers(ok(OLGA), loggedOut),
      [PUBLIC]: ok(publicEvent()),
      [CANCEL]: failure,
    });
    confirmCancel();
    await waitFor(() => expect(callsTo(fetch, ME)).toBe(2));
    await main().findByText("Event", { selector: ".eyebrow" });
    expect(main().queryByText(TEXT.failed)).toBeNull();
    expect(callsTo(fetch, CANCEL)).toBe(1);
  });
});

describe("W-EM28: what a success invalidates (test first)", () => {
  const BASE = [["events"], ["public-event", EVENT_ID], ["public-events"]];
  const ATTENDEE_AND_EMAILS = [
    ["registration-emails", OLGA.id, EVENT_ID, REGISTRATION_ID],
    ["registrations", ANN.id],
    ["registration", ANN.id, EVENT_ID],
  ];
  const ORGANIZER_LISTS = [
    ["event-registrations", OLGA.id, EVENT_ID],
    ["event-arrivals", OLGA.id, EVENT_ID],
  ];
  const UNRELATED = [
    ["events", OTHER_ID],
    ["public-event", OTHER_ID],
  ];
  const ALL = [...BASE, ...ATTENDEE_AND_EMAILS, ...ORGANIZER_LISTS, ...UNRELATED];

  // The public event of this id is left out where the page falls back to the public view,
  // so the view never renders the placeholder.
  function seed(queryClient: QueryClient, keys = ALL) {
    for (const key of keys) queryClient.setQueryData(key, { seeded: true });
  }

  function invalidated(queryClient: QueryClient, keys: unknown[][]) {
    return keys.map((key) => [key, queryClient.getQueryState(key)?.isInvalidated]);
  }

  const all = (keys: unknown[][], value: boolean) => keys.map((key) => [key, value]);

  it("reschedule, time changed: the event set; the lists, public reads, emails and tickets invalidated", async () => {
    const { queryClient } = await ownerPage({ [RESCHEDULE]: ok(MOVED) });
    seed(queryClient);
    setStart(NEW_START_INPUT);
    submitReschedule();
    await main().findByText(TEXT.rescheduled);
    expect(queryClient.getQueryData(["events", EVENT_ID])).toMatchObject({ schedule_version: 2 });
    expect(invalidated(queryClient, [...BASE, ...ATTENDEE_AND_EMAILS])).toEqual(
      all([...BASE, ...ATTENDEE_AND_EMAILS], true),
    );
    expect(invalidated(queryClient, [...ORGANIZER_LISTS, ...UNRELATED])).toEqual(
      all([...ORGANIZER_LISTS, ...UNRELATED], false),
    );
  });

  it("cancel: the same plus the organizer lists and the arrivals", async () => {
    const { queryClient } = await ownerPage({ [CANCEL]: ok(CANCELLED) });
    seed(queryClient);
    confirmCancel();
    await main().findByText(TEXT.cancelled);
    expect(queryClient.getQueryData(["events", EVENT_ID])).toMatchObject({ status: "cancelled" });
    const related = [...BASE, ...ATTENDEE_AND_EMAILS, ...ORGANIZER_LISTS];
    expect(invalidated(queryClient, related)).toEqual(all(related, true));
    expect(invalidated(queryClient, UNRELATED)).toEqual(all(UNRELATED, false));
  });

  it("reschedule no-op: only the event set, nothing invalidated", async () => {
    const same = organizerEvent({ registered: 4, seats_left: 21 });
    const { queryClient } = await ownerPage({ [RESCHEDULE]: ok(same) });
    seed(queryClient);
    setStart(NEW_START_INPUT);
    submitReschedule();
    await main().findByText(TEXT.same);
    expect(queryClient.getQueryData(["events", EVENT_ID])).toMatchObject({ registered: 4 });
    expect(invalidated(queryClient, ALL)).toEqual(all(ALL, false));
  });

  it("a client check: nothing set, nothing invalidated", async () => {
    const { queryClient } = await ownerPage();
    seed(queryClient);
    setStart(toLocalInput(new Date(START)));
    submitReschedule();
    await main().findByText(TEXT.same);
    expect(queryClient.getQueryData(["events", EVENT_ID])).toMatchObject({ schedule_version: 1 });
    expect(invalidated(queryClient, ALL)).toEqual(all(ALL, false));
  });

  it.each<[string, () => void, Record<string, Handler>]>([
    [
      "reschedule 409",
      () => {
        setStart(NEW_START_INPUT);
        submitReschedule();
      },
      { [RESCHEDULE]: error(409, "event_cancelled") },
    ],
    ["cancel 409", confirmCancel, { [CANCEL]: error(409, "event_started") }],
  ])("%s: the event read again, the list and the public event invalidated, nothing else", async (_case, act409, routes) => {
    const { fetch, queryClient } = await ownerPage({
      [OWN]: answers(ok(organizerEvent()), ok(CANCELLED)),
      ...routes,
    });
    seed(queryClient);
    act409();
    await waitFor(() => expect(callsTo(fetch, OWN)).toBe(2));
    const expected = [["events"], ["public-event", EVENT_ID]];
    expect(invalidated(queryClient, expected)).toEqual(all(expected, true));
    const untouched = [["public-events"], ...ATTENDEE_AND_EMAILS, ...ORGANIZER_LISTS, ...UNRELATED];
    expect(invalidated(queryClient, untouched)).toEqual(all(untouched, false));
  });

  it("reschedule 404: the event read again and the list invalidated, the attendee keys not", async () => {
    const { fetch, queryClient } = await ownerPage({
      [OWN]: answers(ok(organizerEvent()), error(404, "not_found")),
      [PUBLIC]: ok(publicEvent()),
      [RESCHEDULE]: error(404, "not_found"),
    });
    seed(
      queryClient,
      ALL.filter((key) => !(key[0] === "public-event" && key[1] === EVENT_ID)),
    );
    setStart(NEW_START_INPUT);
    submitReschedule();
    await waitFor(() => expect(callsTo(fetch, OWN)).toBe(2));
    expect(queryClient.getQueryState(["events"])?.isInvalidated).toBe(true);
    const untouched = [["public-events"], ...ATTENDEE_AND_EMAILS, ...ORGANIZER_LISTS, ...UNRELATED];
    expect(invalidated(queryClient, untouched)).toEqual(all(untouched, false));
  });
});

describe("W-EM33: accessibility and placement", () => {
  it("the section sits under the Registrations link and above the share line", async () => {
    await ownerPage();
    const region = controls()!;
    const registrations = main().getByRole("link", { name: "Registrations" });
    const share = main().getByRole("link", { name: `/event/${EVENT_ID}` });
    expect(registrations.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(region.compareDocumentPosition(share) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(region.closest("section.card")).toBeTruthy();
  });

  it("every button is a real button with a text name; the panel buttons are type button", async () => {
    await ownerPage();
    const panel = openConfirm();
    for (const button of within(panel).getAllByRole("button")) {
      expect(button.getAttribute("type")).toBe("button");
      expect(button.textContent).not.toBe("");
    }
    expect(screen.getByRole("main").querySelector("[role='dialog']")).toBeNull();
  });
});

describe("W-EM34: rescheduleEvent, cancelEvent and EventActionError (test first)", () => {
  it.each(["event_cancelled", "event_passed", "event_started"])(
    "a 409 %s gives an EventActionError with that code",
    async (code) => {
      mockFetch({ [RESCHEDULE]: error(409, code), [CANCEL]: error(409, code) });
      for (const call of [() => rescheduleEvent(EVENT_ID, NEW_START), () => cancelEvent(EVENT_ID)]) {
        const thrown: unknown = await call().catch((e: unknown) => e);
        expect(thrown).toBeInstanceOf(EventActionError);
        expect(thrown).toBeInstanceOf(ApiError);
        expect((thrown as EventActionError).status).toBe(409);
        expect((thrown as EventActionError).code).toBe(code);
      }
    },
  );

  it.each<[string, Handler]>([
    ["a body that is not JSON", () => new Response("Conflict", { status: 409 })],
    ["a JSON body without error", () => json(409, {})],
    ["no body", () => json(409)],
  ])("a 409 with %s gives the code ''", async (_case, answer) => {
    mockFetch({ [RESCHEDULE]: answer, [CANCEL]: answer });
    for (const call of [() => rescheduleEvent(EVENT_ID, NEW_START), () => cancelEvent(EVENT_ID)]) {
      const thrown: unknown = await call().catch((e: unknown) => e);
      expect(thrown).toBeInstanceOf(EventActionError);
      expect((thrown as EventActionError).status).toBe(409);
      expect((thrown as EventActionError).code).toBe("");
    }
  });

  it("other statuses keep their status and code", async () => {
    mockFetch({ [RESCHEDULE]: error(400, "invalid_input"), [CANCEL]: error(404, "not_found") });
    const bad = (await rescheduleEvent(EVENT_ID, NEW_START).catch((e: unknown) => e)) as EventActionError;
    expect([bad.status, bad.code]).toEqual([400, "invalid_input"]);
    const missing = (await cancelEvent(EVENT_ID).catch((e: unknown) => e)) as EventActionError;
    expect([missing.status, missing.code]).toEqual([404, "not_found"]);
  });

  it("a 200 answers the organizer event (description read as empty when missing)", async () => {
    const { description: _drop, ...noDescription } = MOVED;
    void _drop;
    mockFetch({ [RESCHEDULE]: ok(noDescription), [CANCEL]: ok(CANCELLED) });
    expect(await rescheduleEvent(EVENT_ID, NEW_START)).toEqual({ ...MOVED, description: "" });
    expect(await cancelEvent(EVENT_ID)).toEqual(CANCELLED);
  });

  it("the id goes through encodeURIComponent", async () => {
    const fetch = mockFetch({
      "POST /events/a%2Fb/reschedule": ok(MOVED),
      "POST /events/a%2Fb/cancel": ok(CANCELLED),
    });
    await rescheduleEvent("a/b", NEW_START);
    await cancelEvent("a/b");
    expect(fetch.mock.calls.map(([input]) => input)).toEqual([
      "/events/a%2Fb/reschedule",
      "/events/a%2Fb/cancel",
    ]);
  });

  it("ApiError is unchanged: no code", () => {
    expect(Object.keys(new ApiError(409))).not.toContain("code");
  });
});
