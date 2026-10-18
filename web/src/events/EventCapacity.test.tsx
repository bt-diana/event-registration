// Tests first (capacity-web.md, roadmap step 23): W-CP1-W-CP12. The "Capacity" section of
// the owner view of /event/:id (POST /events/{id}/capacity).
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { QueryClient } from "@tanstack/react-query";
import { ApiError } from "../auth/api";
import { ANN, OLGA, callsTo, deferred, json, mockFetch, renderApp } from "../auth/test-helpers";
import { EventActionError, setCapacity } from "./api";
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
const CAPACITY = `POST /events/${EVENT_ID}/capacity`;
const OTHER_ID = "5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d";
const REGISTRATION_ID = "9c8b7a6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d";

const TEXT = {
  number: "Enter a whole number from 1 to 100000.",
  below3: "Capacity cannot be below 3 registered people.",
  below5: "Capacity cannot be below 5 registered people.",
  same: "That is already the capacity. Nothing changed.",
  saved25: "Capacity saved. Seats left: 25.",
  cancelled: "This event is cancelled and cannot be changed.",
  passed: "This event has already ended and cannot be changed.",
  started: "This event has already started and cannot be changed.",
  failed: "Something went wrong. Try again.",
};

const hint = (n: number, word: "person" | "people") =>
  `1 to 100000. Not below the ${n} registered ${word}. More seats go to the waiting list in order, and those people get an email.`;

const ok = (body: unknown): Handler => () => json(200, body);
const error = (status: number, code?: string): Handler => () =>
  json(status, code === undefined ? undefined : { error: code });
const below = (registered: unknown): Handler => () =>
  json(409, { error: "capacity_below_registered", registered });
const networkError: Handler = () => {
  throw new TypeError("Failed to fetch");
};
const loggedOut = error(401, "not_logged_in");

// Answers in turn; the last one repeats.
function answers(...list: Handler[]): Handler {
  let n = 0;
  return () => list[Math.min(n++, list.length - 1)]();
}

// The page: capacity 25, 3 registered, 22 seats left.
const PAGE = organizerEvent({ registered: 3, seats_left: 22 });
// The answer to a raise to 30 that moved two waiting people up.
const SAVED = organizerEvent({ capacity: 30, registered: 5, seats_left: 25 });
const CANCELLED = organizerEvent({
  status: "cancelled",
  cancelled_at: "2026-10-18T12:00:00.000Z",
  registered: 3,
  seats_left: 22,
});
const RUNNING = organizerEvent({
  starts_at: "2026-01-01T10:00:00.000Z",
  ends_at: "2099-01-01T10:00:00.000Z",
  duration_minutes: 1440,
  registered: 3,
  seats_left: 22,
});

function main() {
  return within(screen.getByRole("main"));
}

function detail(label: string): string | null {
  return main().getByText(label, { selector: "dt" }).nextElementSibling?.textContent ?? null;
}

async function ownerPage(routes: Record<string, Handler> = {}, event = PAGE) {
  const fetch = mockFetch({ [ME]: () => json(200, OLGA), [OWN]: ok(event), ...routes });
  const rendered = renderApp(`/event/${EVENT_ID}`);
  await main().findByRole("heading", { level: 1, name: "Spring meetup" });
  return { fetch, ...rendered };
}

function section(): HTMLElement | null {
  return main().queryByRole("region", { name: "Capacity" });
}

function field(): HTMLInputElement {
  return main().getByLabelText("Capacity (seats)") as HTMLInputElement;
}

function type(value: string) {
  fireEvent.change(field(), { target: { value } });
}

function save() {
  fireEvent.click(main().getByRole("button", { name: "Save capacity" }));
}

function bodyOfCapacity(fetch: ReturnType<typeof mockFetch>): RequestInit | undefined {
  return fetch.mock.calls.find(([input]) => input === `/events/${EVENT_ID}/capacity`)?.[1];
}

// The browser clock only (W-CP1); timers stay real so the queries and waitFor run.
function clockAt(iso: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
}

const BASE = [["events"], ["public-event", EVENT_ID], ["public-events"]];
const OTHERS = [
  ["registration-emails", OLGA.id, EVENT_ID, REGISTRATION_ID],
  ["registrations", ANN.id],
  ["registration", ANN.id, EVENT_ID],
  ["event-registrations", OLGA.id, EVENT_ID],
  ["event-arrivals", OLGA.id, EVENT_ID],
];
const UNRELATED = [
  ["events", OTHER_ID],
  ["public-event", OTHER_ID],
];
const ALL = [...BASE, ...OTHERS, ...UNRELATED];

function seed(queryClient: QueryClient, keys = ALL) {
  for (const key of keys) queryClient.setQueryData(key, { seeded: true });
}

function invalidated(queryClient: QueryClient, keys: unknown[][]) {
  return keys.map((key) => [key, queryClient.getQueryState(key)?.isInvalidated]);
}

const all = (keys: unknown[][], value: boolean) => keys.map((key) => [key, value]);

describe("W-CP1: the section exists only while active and in the future (test first)", () => {
  it("active, starting later than the browser clock: the section with its form", async () => {
    clockAt("2030-01-01T09:59:00.000Z");
    await ownerPage();
    const region = section()!;
    expect(region).toBeTruthy();
    expect(within(region).getByLabelText("Capacity (seats)")).toBeTruthy();
    expect(within(region).getByRole("button", { name: "Save capacity" })).toBeTruthy();
  });

  it.each<[string, Parameters<typeof organizerEvent>[0], string]>([
    ["cancelled", { status: "cancelled" }, "2029-12-01T00:00:00.000Z"],
    ["passed (Ended)", { status: "passed" }, "2030-01-02T00:00:00.000Z"],
    ["active, started one minute ago", {}, "2030-01-01T10:01:00.000Z"],
    ["active, starting exactly now", {}, "2030-01-01T10:00:00.000Z"],
  ])("%s: no section, no field, no hint; the Capacity detail stays", async (_case, overrides, now) => {
    clockAt(now);
    await ownerPage({}, organizerEvent(overrides));
    expect(section()).toBeNull();
    expect(main().queryByLabelText("Capacity (seats)")).toBeNull();
    expect(main().queryByRole("button", { name: "Save capacity" })).toBeNull();
    expect(main().queryByText(/^1 to 100000/)).toBeNull();
    expect(detail("Capacity")).toBe("25");
  });

  it.each<[string, Record<string, Handler>]>([
    ["logged out", { [ME]: loggedOut }],
    ["an attendee", { [ME]: ok(ANN), [MY_REGISTRATION]: error(404, "not_found") }],
    ["another organizer", { [ME]: ok(OLGA), [OWN]: error(404, "not_found") }],
  ])("the public view (%s) of the same event has none", async (_case, routes) => {
    clockAt("2029-12-01T00:00:00.000Z");
    mockFetch({ [OWN]: ok(PAGE), [PUBLIC]: ok(publicEvent()), ...routes });
    renderApp(`/event/${EVENT_ID}`);
    await main().findByRole("heading", { level: 1, name: "Spring meetup" });
    await waitFor(() => expect(main().queryByText("Loading...")).toBeNull());
    expect(section()).toBeNull();
    expect(main().queryByLabelText("Capacity (seats)")).toBeNull();
    expect(main().queryByRole("button", { name: "Save capacity" })).toBeNull();
  });
});

describe("W-CP2: the form (test first)", () => {
  it("an h2, a labelled numeric text field with the loaded capacity, the hint, a primary submit", async () => {
    await ownerPage();
    const region = section()!;
    expect(within(region).getByRole("heading", { level: 2, name: "Capacity" }).className).toContain(
      "schedule-heading",
    );
    expect(region.querySelector("form")!.noValidate).toBe(true);
    const input = field();
    expect(input.getAttribute("type")).toBe("text");
    expect(input.getAttribute("inputmode")).toBe("numeric");
    expect(input.value).toBe("25");
    const hintText = within(region).getByText(hint(3, "people"));
    expect(hintText.className).toContain("hint");
    expect(input.getAttribute("aria-describedby")?.split(" ")).toContain(hintText.id);
    expect(input.getAttribute("aria-invalid")).toBeNull();
    const button = within(region).getByRole("button", { name: "Save capacity" });
    expect(button.getAttribute("type")).toBe("submit");
    expect(button.className).toContain("button-primary");
  });

  it.each<[number, string]>([
    [1, hint(1, "person")],
    [0, hint(0, "people")],
  ])("with %i registered the hint reads right", async (registered, text) => {
    await ownerPage({}, organizerEvent({ registered }));
    expect(within(section()!).getByText(text)).toBeTruthy();
  });

  it("a refetch with another registered count changes the hint and leaves a typed value alone", async () => {
    const { queryClient } = await ownerPage({
      [OWN]: answers(ok(PAGE), ok(organizerEvent({ capacity: 26, registered: 1, seats_left: 25 }))),
    });
    type("40");
    await act(() => queryClient.refetchQueries({ queryKey: ["events", EVENT_ID], exact: true }));
    await main().findByText(hint(1, "person"));
    expect(detail("Capacity")).toBe("26");
    expect(field().value).toBe("40");
  });
});

describe("W-CP3: checks before any request (test first)", () => {
  it.each<[string, string, string]>([
    ["empty", "", TEXT.number],
    ["text", "abc", TEXT.number],
    ["zero", "0", TEXT.number],
    ["a fraction", "1.5", TEXT.number],
    ["above the limit", "100001", TEXT.number],
    ["below the registered count", "2", TEXT.below3],
  ])("%s: the field error as an alert, focus on the field, no request", async (_case, value, text) => {
    const { fetch } = await ownerPage();
    type(value);
    save();
    const message = await main().findByText(text);
    expect(message.getAttribute("role")).toBe("alert");
    expect(message.className).toContain("field-error");
    expect(field().getAttribute("aria-invalid")).toBe("true");
    const describedBy = field().getAttribute("aria-describedby")?.split(" ");
    expect(describedBy).toContain(message.id);
    expect(describedBy).toContain(main().getByText(hint(3, "people")).id);
    await waitFor(() => expect(document.activeElement).toBe(field()));
    expect(field().value).toBe(value);
    expect(callsTo(fetch, CAPACITY)).toBe(0);
  });

  it("the registered count itself is allowed and sends the request", async () => {
    const { fetch } = await ownerPage({
      [CAPACITY]: ok(organizerEvent({ capacity: 3, registered: 3, seats_left: 0 })),
    });
    type("3");
    save();
    await main().findByText("Capacity saved. Seats left: 0.");
    expect(callsTo(fetch, CAPACITY)).toBe(1);
  });

  it("the unchanged value: the notice as a status with focus, no field error, no request", async () => {
    const { fetch } = await ownerPage();
    save();
    const notice = await main().findByText(TEXT.same);
    expect(notice.getAttribute("role")).toBe("status");
    expect(notice.getAttribute("tabindex")).toBe("-1");
    await waitFor(() => expect(document.activeElement).toBe(notice));
    expect(field().getAttribute("aria-invalid")).toBeNull();
    expect(main().queryByRole("alert")).toBeNull();
    expect(callsTo(fetch, CAPACITY)).toBe(0);
  });

  it("the unchanged value with spaces around is the same notice", async () => {
    const { fetch } = await ownerPage();
    type(" 25 ");
    save();
    await main().findByText(TEXT.same);
    expect(callsTo(fetch, CAPACITY)).toBe(0);
  });

  it("a client check invalidates nothing", async () => {
    const { queryClient } = await ownerPage();
    seed(queryClient);
    type("2");
    save();
    await main().findByText(TEXT.below3);
    expect(invalidated(queryClient, ALL)).toEqual(all(ALL, false));
  });
});

describe("W-CP4: the request (test first)", () => {
  it.each(["12", " 12 "])("%j sends one POST with exactly {\"capacity\":12}", async (value) => {
    const { fetch } = await ownerPage({
      [CAPACITY]: ok(organizerEvent({ capacity: 12, registered: 3, seats_left: 9 })),
    });
    type(value);
    save();
    await waitFor(() => expect(callsTo(fetch, CAPACITY)).toBe(1));
    const init = bodyOfCapacity(fetch);
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({ "Content-Type": "application/json" });
    expect(init?.body).toBe('{"capacity":12}');
    await main().findByText("Capacity saved. Seats left: 9.");
  });
});

describe("W-CP5: pending and double submit (test first)", () => {
  it("two quick submits make one request", async () => {
    const { fetch } = await ownerPage({ [CAPACITY]: ok(SAVED) });
    type("30");
    const form = field().closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    await main().findByText(TEXT.saved25);
    expect(callsTo(fetch, CAPACITY)).toBe(1);
  });

  it("Saving... and disabled while it runs, the value kept, the guard released after", async () => {
    const answer = deferred<Response>();
    const { fetch } = await ownerPage({
      [CAPACITY]: answers(() => answer.promise, ok(organizerEvent({ capacity: 40 }))),
    });
    type("30");
    save();
    const button = (await main().findByRole("button", { name: "Saving..." })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    fireEvent.submit(button.closest("form")!);
    expect(callsTo(fetch, CAPACITY)).toBe(1);
    expect(field().value).toBe("30");

    await act(async () => answer.resolve(json(200, SAVED)));
    await main().findByText(TEXT.saved25);
    type("40");
    save();
    await waitFor(() => expect(callsTo(fetch, CAPACITY)).toBe(2));
  });
});

describe("W-CP6: success (test first)", () => {
  it("the details at once, the field reset to the answer, the message as a status with focus", async () => {
    const { fetch } = await ownerPage({ [CAPACITY]: ok(SAVED) });
    expect(detail("Capacity")).toBe("25");
    type(" 30 ");
    save();
    const message = await main().findByText(TEXT.saved25);
    expect(message.getAttribute("role")).toBe("status");
    expect(message.getAttribute("tabindex")).toBe("-1");
    await waitFor(() => expect(document.activeElement).toBe(message));
    expect(detail("Capacity")).toBe("30");
    expect(detail("Registered")).toBe("5");
    expect(detail("Seats left")).toBe("25");
    expect(field().value).toBe("30");
    expect(main().getByText(hint(5, "people"))).toBeTruthy();
    expect(main().queryByText(/moved up|promoted|queued/)).toBeNull();
    // The answer is the new state: the event is not read again.
    expect(callsTo(fetch, OWN)).toBe(1);
  });

  it("a field error from an earlier submit is cleared", async () => {
    await ownerPage({ [CAPACITY]: ok(SAVED) });
    type("abc");
    save();
    await main().findByText(TEXT.number);
    type("30");
    save();
    await main().findByText(TEXT.saved25);
    expect(main().queryByText(TEXT.number)).toBeNull();
    expect(field().getAttribute("aria-invalid")).toBeNull();
  });

  it("a server-side no-op (same capacity in the answer) is shown the same way", async () => {
    await ownerPage({ [CAPACITY]: ok(PAGE) });
    type("26");
    save();
    await main().findByText("Capacity saved. Seats left: 22.");
    expect(field().value).toBe("25");
  });

  it("the message goes at the next submit", async () => {
    await ownerPage({ [CAPACITY]: ok(SAVED) });
    type("30");
    save();
    await main().findByText(TEXT.saved25);
    type("abc");
    save();
    await main().findByText(TEXT.number);
    expect(main().queryByText(TEXT.saved25)).toBeNull();
  });
});

describe("W-CP7: what a success invalidates (test first)", () => {
  it("the event set; the lists, public reads, emails, tickets, registrations and arrivals invalidated", async () => {
    const { queryClient } = await ownerPage({ [CAPACITY]: ok(SAVED) });
    seed(queryClient);
    type("30");
    save();
    await main().findByText(TEXT.saved25);
    expect(queryClient.getQueryData(["events", EVENT_ID])).toMatchObject({ capacity: 30 });
    const related = [...BASE, ...OTHERS];
    expect(invalidated(queryClient, related)).toEqual(all(related, true));
    expect(invalidated(queryClient, UNRELATED)).toEqual(all(UNRELATED, false));
  });
});

describe("W-CP8: below the registered count from the server (test first)", () => {
  it("the server's count in the field error, focus on the field, the value kept, the event read again", async () => {
    const { fetch, queryClient } = await ownerPage({
      [OWN]: answers(ok(PAGE), ok(organizerEvent({ registered: 5, seats_left: 20 }))),
      [CAPACITY]: below(5),
    });
    seed(queryClient);
    type("4");
    save();
    const message = await main().findByText(TEXT.below5);
    expect(message.getAttribute("role")).toBe("alert");
    expect(message.className).toContain("field-error");
    expect(field().getAttribute("aria-invalid")).toBe("true");
    expect(field().getAttribute("aria-describedby")?.split(" ")).toContain(message.id);
    await waitFor(() => expect(document.activeElement).toBe(field()));
    expect(field().value).toBe("4");
    expect(invalidated(queryClient, [["events"], ["public-event", EVENT_ID]])).toEqual(
      all([["events"], ["public-event", EVENT_ID]], true),
    );
    const untouched = [["public-events"], ...OTHERS, ...UNRELATED];
    expect(invalidated(queryClient, untouched)).toEqual(all(untouched, false));
    await waitFor(() => expect(callsTo(fetch, OWN)).toBe(2));
    // The page catches up: the hint and the details show the real count.
    await main().findByText(hint(5, "people"));
    expect(detail("Registered")).toBe("5");
    expect(field().value).toBe("4");
    expect(callsTo(fetch, CAPACITY)).toBe(1);
  });

  it.each<[string, Handler]>([
    ["no registered key", () => json(409, { error: "capacity_below_registered" })],
    ["registered as a string", below("5")],
    ["registered not whole", below(4.5)],
    ["registered below zero", below(-1)],
  ])("%s: Something went wrong. Try again. as the form error", async (_case, failure) => {
    await ownerPage({ [CAPACITY]: failure });
    type("4");
    save();
    const message = await main().findByText(TEXT.failed);
    expect(message.getAttribute("role")).toBe("alert");
    expect(message.className).toContain("form-error");
    await waitFor(() => expect(document.activeElement).toBe(message));
    expect(field().value).toBe("4");
    expect(main().queryByText(/registered people\.$/)).toBeNull();
  });
});

describe("W-CP9: other errors (test first)", () => {
  it.each<[string, Handler, string, ReturnType<typeof organizerEvent>]>([
    ["409 event_cancelled", error(409, "event_cancelled"), TEXT.cancelled, CANCELLED],
    [
      "409 event_passed",
      error(409, "event_passed"),
      TEXT.passed,
      organizerEvent({ status: "passed", registered: 3, seats_left: 22 }),
    ],
    ["409 event_started", error(409, "event_started"), TEXT.started, RUNNING],
  ])("%s: the text as an alert with focus, the value kept, the event read again, the form gone", async (_case, failure, text, after) => {
    const reread = deferred<Response>();
    const { fetch, queryClient } = await ownerPage({
      [OWN]: answers(ok(PAGE), () => reread.promise),
      [CAPACITY]: failure,
    });
    seed(queryClient);
    type("30");
    save();
    const message = await main().findByText(text);
    expect(message.getAttribute("role")).toBe("alert");
    expect(message.getAttribute("tabindex")).toBe("-1");
    expect(message.className).toContain("form-error");
    expect(message.className).toContain("schedule-message");
    await waitFor(() => expect(document.activeElement).toBe(message));
    expect(field().value).toBe("30");
    expect(invalidated(queryClient, [["events"], ["public-event", EVENT_ID]])).toEqual(
      all([["events"], ["public-event", EVENT_ID]], true),
    );
    const untouched = [["public-events"], ...OTHERS, ...UNRELATED];
    expect(invalidated(queryClient, untouched)).toEqual(all(untouched, false));
    await waitFor(() => expect(callsTo(fetch, OWN)).toBe(2));
    await act(async () => reread.resolve(json(200, after)));
    await waitFor(() => expect(section()).toBeNull());
    // The message stays when the form goes (W-CP1).
    expect(main().getByText(text)).toBe(message);
    expect(document.activeElement).toBe(message);
    expect(main().queryByLabelText("Capacity (seats)")).toBeNull();
    expect(callsTo(fetch, CAPACITY)).toBe(1);
  });

  it("400 invalid_input: the field error, focus on the field, the value kept, nothing read again", async () => {
    const { fetch } = await ownerPage({ [CAPACITY]: error(400, "invalid_input") });
    type("30");
    save();
    const message = await main().findByText(TEXT.number);
    expect(message.getAttribute("role")).toBe("alert");
    expect(message.className).toContain("field-error");
    expect(field().getAttribute("aria-invalid")).toBe("true");
    await waitFor(() => expect(document.activeElement).toBe(field()));
    expect(field().value).toBe("30");
    expect(main().getAllByRole("alert")).toEqual([message]);
    expect(callsTo(fetch, OWN)).toBe(1);
  });

  it.each<[string, Handler]>([
    ["a 5xx", error(500, "internal")],
    ["a network error", networkError],
    ["a 409 with an unknown code", error(409, "something_else")],
    ["a 409 without a code", () => json(409, {})],
    ["a 409 with a body that is not JSON", () => new Response("Conflict", { status: 409 })],
  ])("%s: Something went wrong. Try again., nothing invalidated, no retry", async (_case, failure) => {
    const { fetch, queryClient } = await ownerPage({ [CAPACITY]: failure });
    seed(queryClient);
    type("30");
    save();
    const message = await main().findByText(TEXT.failed);
    expect(message.getAttribute("role")).toBe("alert");
    expect(message.getAttribute("tabindex")).toBe("-1");
    await waitFor(() => expect(document.activeElement).toBe(message));
    expect(field().value).toBe("30");
    expect(invalidated(queryClient, ALL)).toEqual(all(ALL, false));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(callsTo(fetch, CAPACITY)).toBe(1);
    expect(callsTo(fetch, OWN)).toBe(1);
  });

  it("404: no text of its own, the event is read again and the page falls back to the public view", async () => {
    const { fetch } = await ownerPage({
      [OWN]: answers(ok(PAGE), error(404, "not_found")),
      [PUBLIC]: ok(publicEvent()),
      [CAPACITY]: error(404, "not_found"),
    });
    type("30");
    save();
    await waitFor(() => expect(callsTo(fetch, PUBLIC)).toBe(1));
    await main().findByText("Event", { selector: ".eyebrow" });
    expect(section()).toBeNull();
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
      [CAPACITY]: failure,
    });
    type("30");
    save();
    await waitFor(() => expect(callsTo(fetch, ME)).toBe(2));
    await main().findByText("Event", { selector: ".eyebrow" });
    expect(section()).toBeNull();
    expect(main().queryByText(TEXT.failed)).toBeNull();
    expect(callsTo(fetch, CAPACITY)).toBe(1);
  });
});

describe("W-CP10: setCapacity and EventActionError.registered (test first)", () => {
  it("sends method, header and body, and answers the organizer event", async () => {
    const { description: _drop, ...noDescription } = SAVED;
    void _drop;
    const fetch = mockFetch({ [CAPACITY]: ok(noDescription) });
    expect(await setCapacity(EVENT_ID, 30)).toEqual({ ...SAVED, description: "" });
    const init = bodyOfCapacity(fetch);
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({ "Content-Type": "application/json" });
    expect(init?.body).toBe('{"capacity":30}');
  });

  it("the id goes through encodeURIComponent", async () => {
    const fetch = mockFetch({ "POST /events/a%2Fb/capacity": ok(SAVED) });
    await setCapacity("a/b", 30);
    expect(fetch.mock.calls.map(([input]) => input)).toEqual(["/events/a%2Fb/capacity"]);
  });

  it("a 409 capacity_below_registered with registered 4 gives the code and 4", async () => {
    mockFetch({ [CAPACITY]: below(4) });
    const thrown: unknown = await setCapacity(EVENT_ID, 2).catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(EventActionError);
    expect(thrown).toBeInstanceOf(ApiError);
    expect((thrown as EventActionError).status).toBe(409);
    expect((thrown as EventActionError).code).toBe("capacity_below_registered");
    expect((thrown as EventActionError).registered).toBe(4);
  });

  it("registered 0 is kept", async () => {
    mockFetch({ [CAPACITY]: below(0) });
    const thrown = (await setCapacity(EVENT_ID, 2).catch((e: unknown) => e)) as EventActionError;
    expect(thrown.registered).toBe(0);
  });

  it.each<[string, Handler, string]>([
    ["a body that is not JSON", () => new Response("Conflict", { status: 409 }), ""],
    ["registered as a string", below("4"), "capacity_below_registered"],
    ["registered below zero", below(-1), "capacity_below_registered"],
    ["registered not whole", below(1.5), "capacity_below_registered"],
    ["no registered", error(409, "event_started"), "event_started"],
  ])("a 409 with %s gives no registered", async (_case, answer, code) => {
    mockFetch({ [CAPACITY]: answer });
    const thrown = (await setCapacity(EVENT_ID, 2).catch((e: unknown) => e)) as EventActionError;
    expect(thrown).toBeInstanceOf(EventActionError);
    expect(thrown.code).toBe(code);
    expect(thrown.registered).toBeUndefined();
  });
});

describe("W-CP11: nothing is live", () => {
  it("after a save no request: not after 60 s, not on visibilitychange or online", async () => {
    const { fetch } = await ownerPage({ [CAPACITY]: ok(SAVED) });
    type("30");
    save();
    await main().findByText(TEXT.saved25);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const before = fetch.mock.calls.length;
    vi.useFakeTimers();
    act(() => {
      vi.advanceTimersByTime(60_000);
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("online"));
      vi.advanceTimersByTime(60_000);
    });
    vi.useRealTimers();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetch.mock.calls.length).toBe(before);
    expect(callsTo(fetch, OWN)).toBe(1);
  });
});

describe("W-CP12: accessibility and layout", () => {
  it("a section labelled by its h2, one h1, the field labelled, no dialog", async () => {
    await ownerPage();
    const region = section()!;
    expect(region.tagName).toBe("SECTION");
    const heading = within(region).getByRole("heading", { level: 2, name: "Capacity" });
    expect(region.getAttribute("aria-labelledby")).toBe(heading.id);
    expect(main().getAllByRole("heading", { level: 1 }).length).toBe(1);
    expect(field().labels?.[0]?.textContent).toBe("Capacity (seats)");
    expect(region.closest("[data-role='organizer']")).toBeTruthy();
    expect(document.querySelector("dialog")).toBeNull();
    expect(screen.getByRole("main").querySelector("[role='dialog']")).toBeNull();
  });
});
