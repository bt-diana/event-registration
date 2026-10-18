// Tests first (events-web.md): W-E23, the description as plain text.
import { screen } from "@testing-library/react";
import { OLGA, json, mockFetch, renderApp } from "../auth/test-helpers";
import { EVENT_ID, organizerEvent, publicEvent, type SamplePublicEvent } from "./test-helpers";

afterEach(() => {
  vi.unstubAllGlobals();
});

const OWN = `GET /events/${EVENT_ID}`;
const PUBLIC = `GET /public/events/${EVENT_ID}`;
const TEXT = "Bring a laptop.\n\nDoors at 9.";

// The element whose own text is exactly the description, line breaks kept.
function descriptionBlock(): Element | null {
  return (
    Array.from(document.querySelectorAll("main *")).find(
      (el) => el.children.length === 0 && el.textContent === TEXT,
    ) ?? null
  );
}

function blocks(): NodeListOf<Element> {
  return document.querySelectorAll(".event-description");
}

function loggedOutPublic(
  description: string | undefined,
  status: SamplePublicEvent["status"] = "active",
) {
  mockFetch({
    "GET /auth/me": () => json(401, { error: "not_logged_in" }),
    [PUBLIC]: () => json(200, publicEvent({ description, status })),
  });
  renderApp(`/event/${EVENT_ID}`);
}

describe("W-E23: description", () => {
  it.each(["active", "cancelled", "passed"] as const)(
    "the public view shows it with line breaks kept (%s)",
    async (status) => {
      loggedOutPublic(TEXT, status);
      await screen.findByRole("heading", { level: 1, name: "Spring meetup" });
      const block = descriptionBlock();
      expect(block).toBeTruthy();
      expect(block!.classList.contains("event-description")).toBe(true);
    },
  );

  it.each(["active", "cancelled", "passed"] as const)(
    "the organizer view shows it (%s)",
    async (status) => {
      mockFetch({
        "GET /auth/me": () => json(200, OLGA),
        [OWN]: () => json(200, organizerEvent({ description: TEXT, status })),
      });
      renderApp(`/event/${EVENT_ID}`);
      await screen.findByRole("heading", { level: 1, name: "Spring meetup" });
      expect(descriptionBlock()?.classList.contains("event-description")).toBe(true);
    },
  );

  it("shows markup as typed, never as HTML", async () => {
    loggedOutPublic("<b>hi</b> <img src=x onerror=alert(1)>");
    expect(await screen.findByText("<b>hi</b> <img src=x onerror=alert(1)>")).toBeTruthy();
    expect(document.querySelector("main b")).toBeNull();
    expect(document.querySelector("main img")).toBeNull();
  });

  it.each([
    ["empty", ""],
    ["missing (API without the field yet)", undefined],
  ])("an %s description shows nothing", async (_label, description) => {
    loggedOutPublic(description);
    await screen.findByRole("heading", { level: 1, name: "Spring meetup" });
    expect(blocks().length).toBe(0);
    expect(screen.queryByText("Description")).toBeNull();
  });

  it("an empty description shows nothing in the organizer view", async () => {
    mockFetch({
      "GET /auth/me": () => json(200, OLGA),
      [OWN]: () => json(200, organizerEvent({ description: "" })),
    });
    renderApp(`/event/${EVENT_ID}`);
    await screen.findByRole("heading", { level: 1, name: "Spring meetup" });
    expect(blocks().length).toBe(0);
  });

  it("the events list does not show it", async () => {
    mockFetch({
      "GET /auth/me": () => json(200, OLGA),
      "GET /events": () => json(200, { events: [organizerEvent({ description: TEXT })] }),
    });
    renderApp("/organizer");
    expect(await screen.findByRole("link", { name: "Spring meetup" })).toBeTruthy();
    expect(screen.queryByText(/Bring a laptop/)).toBeNull();
  });
});
