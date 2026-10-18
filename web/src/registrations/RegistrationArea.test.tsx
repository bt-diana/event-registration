// Tests first (registration-web.md): W-R1, W-R4, W-R5, W-R6, W-R8, W-R9, W-R10, W-R23.
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
import { EVENT_ID, organizerEvent, publicEvent, type SamplePublicEvent } from "../events/test-helpers";
import {
  BEN,
  MY_REGISTRATION,
  REGISTER,
  registration,
  type SampleRegistration,
} from "./test-helpers";

afterEach(() => {
  vi.unstubAllGlobals();
});

type Handler = () => Response | Promise<Response>;

const ME = "GET /auth/me";
const PUBLIC = `GET /public/events/${EVENT_ID}`;
const OWN = `GET /events/${EVENT_ID}`;
const loggedOut = () => json(401, { error: "not_logged_in" });
const NONE: Handler = () => json(404, { error: "not_found" });
const mine = (r: SampleRegistration): Handler => () => json(200, r);

const FULL: Partial<SamplePublicEvent> = { full: true, seats_left: 0 };
const CANCELLED: Partial<SamplePublicEvent> = { status: "cancelled", seats_left: 0 };
const PASSED: Partial<SamplePublicEvent> = { status: "passed", has_started: true, seats_left: 0 };
const STARTED: Partial<SamplePublicEvent> = { has_started: true, seats_left: 10 };

function main() {
  return within(screen.getByRole("main"));
}

function registerControls(): HTMLElement[] {
  return main().queryAllByRole("button", { name: /register|join/i });
}

function registrationCalls(fetch: ReturnType<typeof mockFetch>): number {
  return fetch.mock.calls.filter(([input]) => String(input).includes("/registrations")).length;
}

// me answers each value in turn, then keeps the last one.
function sequence(...answers: Handler[]): Handler {
  let n = 0;
  return () => answers[Math.min(n++, answers.length - 1)]();
}

// An attendee on the public page, once the registration read has settled.
async function attendeePage(
  event: SamplePublicEvent | Handler,
  my: Handler,
  extra: Record<string, Handler> = {},
) {
  const fetch = mockFetch({
    [ME]: () => json(200, ANN),
    [PUBLIC]: typeof event === "function" ? event : () => json(200, event),
    [MY_REGISTRATION]: my,
    ...extra,
  });
  const rendered = renderApp(`/event/${EVENT_ID}`);
  await screen.findByRole("heading", { level: 1, name: "Spring meetup" });
  await waitFor(() => expect(callsTo(fetch, MY_REGISTRATION)).toBe(1));
  await waitFor(() => expect(main().queryByText("Loading...")).toBeNull());
  return { fetch, ...rendered };
}

describe("W-R1: no registration area for an organizer", () => {
  it("the owner: no button, no text, no registration request", async () => {
    const fetch = mockFetch({
      [ME]: () => json(200, OLGA),
      [OWN]: () => json(200, organizerEvent()),
    });
    renderApp(`/event/${EVENT_ID}`);
    await screen.findByRole("heading", { level: 1, name: "Spring meetup" });
    expect(registerControls()).toEqual([]);
    expect(main().queryByText(/Log in to/)).toBeNull();
    expect(registrationCalls(fetch)).toBe(0);
  });

  it.each<[string, Partial<SamplePublicEvent>]>([
    ["open", {}],
    ["full", FULL],
    ["already started", STARTED],
  ])("another organizer's %s event (public view): nothing", async (_case, overrides) => {
    const fetch = mockFetch({
      [ME]: () => json(200, OLGA),
      [OWN]: () => json(404, { error: "not_found" }),
      [PUBLIC]: () => json(200, publicEvent(overrides)),
    });
    renderApp(`/event/${EVENT_ID}`);
    await screen.findByRole("heading", { level: 1, name: "Spring meetup" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(registerControls()).toEqual([]);
    expect(main().queryByText(/Log in to/)).toBeNull();
    expect(main().queryByText("This event is full.")).toBeNull();
    expect(main().queryByText(/Could not load your registration/)).toBeNull();
    expect(registrationCalls(fetch)).toBe(0);
  });
});

describe("W-R4: the register control by event and registration", () => {
  it.each<[string, Partial<SamplePublicEvent>]>([
    ["open", {}],
    ["already started", STARTED],
  ])("%s, not registered: Register", async (_case, overrides) => {
    await attendeePage(publicEvent(overrides), NONE);
    expect(registerControls().map((b) => b.textContent)).toEqual(["Register"]);
    expect(main().queryByText("Registration is closed.")).toBeNull();
    expect(main().queryByText("This event is full.")).toBeNull();
  });

  it.each<[string, Partial<SamplePublicEvent>]>([
    ["full", FULL],
    ["full and started", { ...FULL, has_started: true }],
  ])("%s, not registered: This event is full. and Join waiting list", async (_case, overrides) => {
    await attendeePage(publicEvent(overrides), NONE);
    expect(main().getByText("This event is full.")).toBeTruthy();
    expect(registerControls().map((b) => b.textContent)).toEqual(["Join waiting list"]);
  });

  it.each<[string, Partial<SamplePublicEvent>]>([
    ["cancelled", CANCELLED],
    ["ended", PASSED],
  ])("%s, not registered: no button, Registration is closed. once", async (_case, overrides) => {
    await attendeePage(publicEvent(overrides), NONE);
    expect(registerControls()).toEqual([]);
    expect(main().getAllByText("Registration is closed.")).toHaveLength(1);
  });

  it.each<[string, Partial<SamplePublicEvent>]>([
    ["open", {}],
    ["cancelled", CANCELLED],
    ["ended", PASSED],
  ])("registered, %s event: the ticket panel and no button", async (_case, overrides) => {
    await attendeePage(publicEvent(overrides), mine(registration()));
    expect(main().getByRole("heading", { level: 2, name: "You are registered" })).toBeTruthy();
    expect(main().getByText("K7M2QX9TPA")).toBeTruthy();
    expect(registerControls()).toEqual([]);
  });

  it("waitlisted, full event: the waiting list panel and no button", async () => {
    await attendeePage(
      publicEvent(FULL),
      mine(registration({ status: "waitlisted", waitlist_position: 3, ticket_code: "H4Z8WR5NCD" })),
    );
    expect(
      main().getByRole("heading", { level: 2, name: "You are on the waiting list" }),
    ).toBeTruthy();
    expect(main().getByText("Your place: 3")).toBeTruthy();
    expect(main().getByText("H4Z8WR5NCD")).toBeTruthy();
    expect(registerControls()).toEqual([]);
  });

  it("cancelled ticket, open event: the cancelled panel and Register again", async () => {
    await attendeePage(publicEvent(), mine(registration({ status: "cancelled" })));
    expect(main().getByRole("heading", { level: 2, name: "Registration cancelled" })).toBeTruthy();
    expect(main().getByText("This ticket is no longer valid.")).toBeTruthy();
    expect(registerControls().map((b) => b.textContent)).toEqual(["Register again"]);
  });

  it("cancelled ticket, full event: the cancelled panel and Join waiting list", async () => {
    await attendeePage(publicEvent(FULL), mine(registration({ status: "cancelled" })));
    expect(main().getByRole("heading", { level: 2, name: "Registration cancelled" })).toBeTruthy();
    expect(main().getByText("This event is full.")).toBeTruthy();
    expect(registerControls().map((b) => b.textContent)).toEqual(["Join waiting list"]);
  });

  it.each<[string, Partial<SamplePublicEvent>]>([
    ["cancelled", CANCELLED],
    ["ended", PASSED],
  ])("cancelled ticket, %s event: the panel, closed once, no button", async (_case, overrides) => {
    await attendeePage(publicEvent(overrides), mine(registration({ status: "cancelled" })));
    expect(main().getByRole("heading", { level: 2, name: "Registration cancelled" })).toBeTruthy();
    expect(main().getAllByText("Registration is closed.")).toHaveLength(1);
    expect(registerControls()).toEqual([]);
  });
});

describe("W-R5: one POST per click, also after a double click", () => {
  it.each<[string, Partial<SamplePublicEvent>, string, SampleRegistration]>([
    ["Register", {}, "Registering...", registration()],
    [
      "Join waiting list",
      FULL,
      "Joining...",
      registration({ status: "waitlisted", waitlist_position: 1 }),
    ],
  ])("%s: disabled and busy while pending, one request", async (label, overrides, pendingLabel, answer) => {
    const post = deferred<Response>();
    const { fetch } = await attendeePage(publicEvent(overrides), NONE, {
      [REGISTER]: () => post.promise,
    });
    const button = main().getByRole("button", { name: label });
    fireEvent.click(button);
    fireEvent.click(button);
    const pending = (await main().findByRole("button", { name: pendingLabel })) as HTMLButtonElement;
    expect(pending.disabled).toBe(true);
    expect(pending.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(pending);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(callsTo(fetch, REGISTER)).toBe(1);
    const init = fetch.mock.calls.find(([input, i]) => `${i?.method} ${String(input)}` === REGISTER)?.[1];
    expect(init?.body).toBeUndefined();

    await act(async () => post.resolve(json(201, answer)));
    expect(await main().findByRole("heading", { level: 2 })).toBeTruthy();
    expect(callsTo(fetch, REGISTER)).toBe(1);
  });
});

describe("W-R6: success, 201 or 200", () => {
  it.each([201, 200])("%s: the ticket from the answer, a fresh event, no extra read", async (status) => {
    const { fetch, queryClient } = await attendeePage(publicEvent(), NONE, {
      [REGISTER]: () => json(status, registration()),
    });
    queryClient.setQueryData(["public-events"], []);
    fireEvent.click(main().getByRole("button", { name: "Register" }));

    expect(
      await main().findByRole("heading", { level: 2, name: "You are registered" }),
    ).toBeTruthy();
    expect(main().getByText("K7M2QX9TPA")).toBeTruthy();
    expect(registerControls()).toEqual([]);
    await waitFor(() => expect(callsTo(fetch, PUBLIC)).toBe(2));
    expect(callsTo(fetch, MY_REGISTRATION)).toBe(1);
    expect(queryClient.getQueryData(["registration", ANN.id, EVENT_ID])).toEqual(registration());
    // W-L13: the home list is marked stale too.
    expect(queryClient.getQueryState(["public-events"])?.isInvalidated).toBe(true);
  });
});

describe("W-R8: the server decides the seat", () => {
  it("Register answered 201 waitlisted shows the waiting list ticket, no error", async () => {
    let n = 0;
    await attendeePage(
      () => json(200, n++ === 0 ? publicEvent({ seats_left: 1 }) : publicEvent(FULL)),
      NONE,
      {
        [REGISTER]: () =>
          json(201, registration({ status: "waitlisted", waitlist_position: 1 })),
      },
    );
    fireEvent.click(main().getByRole("button", { name: "Register" }));
    expect(
      await main().findByRole("heading", { level: 2, name: "You are on the waiting list" }),
    ).toBeTruthy();
    expect(main().getByText("Your place: 1")).toBeTruthy();
    expect(main().queryByRole("alert")).toBeNull();
    expect(await main().findByText("Full")).toBeTruthy();
  });
});

describe("W-R9: errors of the register call", () => {
  it("409: Registration is closed., no button, the event is read again", async () => {
    const again = deferred<Response>();
    let n = 0;
    const { fetch } = await attendeePage(
      () => (n++ === 0 ? json(200, publicEvent()) : again.promise),
      NONE,
      { [REGISTER]: () => json(409, { error: "event_cancelled" }) },
    );
    fireEvent.click(main().getByRole("button", { name: "Register" }));

    const alert = await main().findByRole("alert");
    expect(alert.textContent).toBe("Registration is closed.");
    expect(registerControls()).toEqual([]);
    await waitFor(() => expect(callsTo(fetch, PUBLIC)).toBe(2));

    await act(async () => again.resolve(json(200, publicEvent(CANCELLED))));
    expect(await main().findByText("Cancelled")).toBeTruthy();
    expect(main().getAllByText("Registration is closed.")).toHaveLength(1);
    expect(registerControls()).toEqual([]);
  });

  it("404: the event is read again and the page shows Event not found", async () => {
    let n = 0;
    await attendeePage(
      () => (n++ === 0 ? json(200, publicEvent()) : json(404, { error: "not_found" })),
      NONE,
      { [REGISTER]: () => json(404, { error: "not_found" }) },
    );
    fireEvent.click(main().getByRole("button", { name: "Register" }));
    expect(await main().findByRole("heading", { level: 1, name: "Event not found" })).toBeTruthy();
  });

  it("401: me is checked again, no text of its own, the login link appears", async () => {
    const { fetch } = await attendeePage(publicEvent(), NONE, {
      [ME]: sequence(() => json(200, ANN), loggedOut),
      [REGISTER]: loggedOut,
    });
    fireEvent.click(main().getByRole("button", { name: "Register" }));
    const link = await main().findByRole("link", { name: "Log in to register" });
    expect(link.getAttribute("href")).toBe(`/login?next=${encodeURIComponent(`/event/${EVENT_ID}`)}`);
    expect(main().queryByRole("alert")).toBeNull();
    expect(main().queryByText("Something went wrong. Try again.")).toBeNull();
    expect(callsTo(fetch, ME)).toBe(2);
  });

  it("403: me is checked again, an organizer gets no area", async () => {
    const { fetch } = await attendeePage(publicEvent(), NONE, {
      [ME]: sequence(() => json(200, ANN), () => json(200, OLGA)),
      [REGISTER]: () => json(403, { error: "wrong_role" }),
      [OWN]: () => json(404, { error: "not_found" }),
    });
    fireEvent.click(main().getByRole("button", { name: "Register" }));
    await waitFor(() => expect(callsTo(fetch, OWN)).toBe(1));
    expect(await screen.findByRole("heading", { level: 1, name: "Spring meetup" })).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(registerControls()).toEqual([]);
    expect(main().queryByRole("alert")).toBeNull();
    expect(main().queryByText(/Log in to/)).toBeNull();
    expect(callsTo(fetch, ME)).toBe(2);
  });

  it.each<[string, Handler]>([
    ["5xx", () => json(500, { error: "internal" })],
    [
      "network error",
      () => {
        throw new TypeError("Failed to fetch");
      },
    ],
  ])("%s: Something went wrong, the button is enabled again, no ticket", async (_case, failure) => {
    await attendeePage(publicEvent(), NONE, { [REGISTER]: failure });
    fireEvent.click(main().getByRole("button", { name: "Register" }));
    const alert = await main().findByRole("alert");
    expect(alert.textContent).toBe("Something went wrong. Try again.");
    const button = main().getByRole("button", { name: "Register" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(main().queryByRole("heading", { level: 2 })).toBeNull();
  });
});

describe("W-R10: states of the registration read", () => {
  it('pending: "Loading..." in the area, the event stays, no button', async () => {
    const fetch = mockFetch({
      [ME]: () => json(200, ANN),
      [PUBLIC]: () => json(200, publicEvent()),
      [MY_REGISTRATION]: () => deferred<Response>().promise,
    });
    renderApp(`/event/${EVENT_ID}`);
    await screen.findByRole("heading", { level: 1, name: "Spring meetup" });
    await waitFor(() => expect(callsTo(fetch, MY_REGISTRATION)).toBe(1));
    expect(main().getByRole("status").textContent).toBe("Loading...");
    expect(main().getByText("Open")).toBeTruthy();
    expect(registerControls()).toEqual([]);
  });

  it.each<[string, Handler]>([
    ["5xx", () => json(500, { error: "internal" })],
    [
      "network error",
      () => {
        throw new TypeError("Failed to fetch");
      },
    ],
  ])("%s: an error with Retry that refetches only the registration", async (_case, failure) => {
    let n = 0;
    const { fetch } = await attendeePage(publicEvent(), () => (n++ === 0 ? failure() : NONE()));
    expect(main().getByText("Could not load your registration")).toBeTruthy();
    expect(registerControls()).toEqual([]);
    fireEvent.click(main().getByRole("button", { name: "Retry" }));
    expect(await main().findByRole("button", { name: "Register" })).toBeTruthy();
    expect(callsTo(fetch, MY_REGISTRATION)).toBe(2);
    expect(callsTo(fetch, PUBLIC)).toBe(1);
    expect(callsTo(fetch, ME)).toBe(1);
  });
});

describe("W-R23: the registration is cached per account", () => {
  it("a second account in the same tab never sees the first one's ticket", async () => {
    const ben = deferred<Response>();
    let n = 0;
    const { fetch, queryClient } = await attendeePage(publicEvent(), () =>
      n++ === 0 ? json(200, registration()) : ben.promise,
    );
    expect(main().getByText("K7M2QX9TPA")).toBeTruthy();

    act(() => {
      queryClient.setQueryData(ME_KEY, BEN);
    });
    await waitFor(() => expect(callsTo(fetch, MY_REGISTRATION)).toBe(2));
    expect(main().queryByText("K7M2QX9TPA")).toBeNull();
    expect(main().getByRole("status").textContent).toBe("Loading...");

    await act(async () => ben.resolve(json(404, { error: "not_found" })));
    expect(await main().findByRole("button", { name: "Register" })).toBeTruthy();
    expect(main().queryByText("K7M2QX9TPA")).toBeNull();
    expect(queryClient.getQueryData(["registration", BEN.id, EVENT_ID])).toBeNull();
  });
});
