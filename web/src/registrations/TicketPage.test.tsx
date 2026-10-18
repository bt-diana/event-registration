// Tests first (registration-web.md): W-R13. Then W-R11, W-R12 (the ticket page).
import { screen, waitFor, within } from "@testing-library/react";
import { ANN, OLGA, callsTo, json, mockFetch, renderApp } from "../auth/test-helpers";
import { EVENT_ID, publicEvent } from "../events/test-helpers";
import { MY_REGISTRATION } from "./test-helpers";

afterEach(() => {
  vi.unstubAllGlobals();
});

type Handler = () => Response | Promise<Response>;

const ME = "GET /auth/me";
const PUBLIC = `GET /public/events/${EVENT_ID}`;
const TICKET_PATH = `/registrations/me?event=${EVENT_ID}`;
const loggedOut = () => json(401, { error: "not_logged_in" });

function main() {
  return within(screen.getByRole("main"));
}

function location(): string | null {
  return screen.getByTestId("location").textContent;
}

function sequence(...answers: Handler[]): Handler {
  let n = 0;
  return () => answers[Math.min(n++, answers.length - 1)]();
}

describe("W-R13: 401 or 403 on the ticket page goes to the guard", () => {
  it("401 re-checks me and redirects to the login with next, no text of its own", async () => {
    const fetch = mockFetch({
      [ME]: sequence(() => json(200, ANN), loggedOut),
      [PUBLIC]: () => json(200, publicEvent()),
      [MY_REGISTRATION]: loggedOut,
    });
    renderApp(TICKET_PATH);
    await waitFor(() =>
      expect(location()).toBe(`/login?next=${encodeURIComponent(TICKET_PATH)}`),
    );
    expect(screen.queryByText("Could not load your ticket")).toBeNull();
    expect(callsTo(fetch, ME)).toBe(2);
  });

  it("403 re-checks me; an organizer is sent to /registrations", async () => {
    const fetch = mockFetch({
      [ME]: sequence(() => json(200, ANN), () => json(200, OLGA)),
      [PUBLIC]: () => json(200, publicEvent()),
      [MY_REGISTRATION]: () => json(403, { error: "wrong_role" }),
    });
    renderApp(TICKET_PATH);
    await waitFor(() => expect(location()).toBe("/registrations"));
    expect(await main().findByRole("heading", { level: 1, name: "Registrations" })).toBeTruthy();
    expect(screen.queryByText("Could not load your ticket")).toBeNull();
    expect(callsTo(fetch, ME)).toBe(2);
  });
});
