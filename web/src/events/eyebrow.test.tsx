// Tests first (docs/specs/role-eyebrow.md): RE1, the role word only in the header, never in page content.
import { screen, within } from "@testing-library/react";
import { ANN, OLGA, deferred, json, mockFetch, renderApp } from "../auth/test-helpers";
import { EVENT_ID, organizerEvent, publicListItem } from "./test-helpers";

afterEach(() => {
  vi.unstubAllGlobals();
});

function main() {
  return within(screen.getByRole("main"));
}

function mainText(): string {
  return screen.getByRole("main").textContent ?? "";
}

function expectNoRoleWord() {
  expect(main().queryByText("Organizer")).toBeNull();
  expect(main().queryByText("Attendee")).toBeNull();
}

describe("RE1: no role eyebrow in page content", () => {
  it.each([
    ["with events", () => json(200, { events: [organizerEvent()] }), "Your events"],
    ["empty", () => json(200, { events: [] }), "Your events"],
    ["load error", () => json(500, { error: "internal" }), "Could not load your events"],
  ])("events list %s: no Organizer eyebrow, the h1 comes first", async (_label, answer, h1) => {
    mockFetch({ "GET /auth/me": () => json(200, OLGA), "GET /events": answer });
    renderApp("/organizer");
    expect(await screen.findByRole("heading", { level: 1, name: h1 })).toBeTruthy();
    expectNoRoleWord();
    expect(mainText().startsWith(h1)).toBe(true);
  });

  it("events list loading: no Organizer eyebrow", async () => {
    mockFetch({
      "GET /auth/me": () => json(200, OLGA),
      "GET /events": () => deferred<Response>().promise,
    });
    renderApp("/organizer");
    expect(await screen.findByRole("heading", { level: 1, name: "Your events" })).toBeTruthy();
    expectNoRoleWord();
    expect(mainText().startsWith("Your events")).toBe(true);
  });

  it("create form: no Organizer eyebrow, the h1 comes first", async () => {
    mockFetch({ "GET /auth/me": () => json(200, OLGA) });
    renderApp("/organizer/events/new");
    expect(await screen.findByRole("heading", { level: 1, name: "Create event" })).toBeTruthy();
    expectNoRoleWord();
    expect(mainText().startsWith("Create event")).toBe(true);
  });

  it("organizer event view: no Organizer eyebrow", async () => {
    mockFetch({
      "GET /auth/me": () => json(200, OLGA),
      [`GET /events/${EVENT_ID}`]: () => json(200, organizerEvent()),
    });
    renderApp(`/event/${EVENT_ID}`);
    expect(await screen.findByRole("heading", { level: 1, name: "Spring meetup" })).toBeTruthy();
    expectNoRoleWord();
  });

  it("attendee home: no Attendee eyebrow, the h1 comes first", async () => {
    mockFetch({
      "GET /auth/me": () => json(200, ANN),
      "GET /public/events": () => json(200, { events: [publicListItem()] }),
    });
    renderApp("/");
    expect(await screen.findByRole("heading", { level: 1, name: "Events" })).toBeTruthy();
    expectNoRoleWord();
    expect(mainText().startsWith("Events")).toBe(true);
  });

  it.each([
    ["/login", "Attendee"],
    ["/organizer/login", "Organizer"],
  ])("%s keeps its role eyebrow for logged-out people", async (path, word) => {
    mockFetch({ "GET /auth/me": () => json(401, { error: "not_logged_in" }) });
    renderApp(path);
    expect(await main().findByText(word)).toBeTruthy();
  });
});
