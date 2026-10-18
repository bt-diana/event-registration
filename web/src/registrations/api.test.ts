// cancel-registration-web.md W-CR8 (test first): cancelRegistration in the style of
// checkIn. A 200 and the four known 409 codes are results; everything else throws
// ApiError with its status (0 for a network error).
import { ApiError } from "../auth/api";
import { EVENT_ID } from "../events/test-helpers";
import { cancelRegistration } from "./api";
import { registration } from "./test-helpers";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(answer: () => Response | Promise<Response>) {
  const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
    async () => answer(),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function thrownStatus(call: Promise<unknown>): Promise<number> {
  try {
    await call;
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return (error as ApiError).status;
  }
  throw new Error("expected a throw");
}

describe("W-CR8: cancelRegistration", () => {
  it("POSTs to /events/{id}/registrations/me/cancel with no body and no Content-Type", async () => {
    const fetch = stubFetch(() => jsonResponse(200, registration({ status: "cancelled" })));
    await cancelRegistration(EVENT_ID);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [input, init] = fetch.mock.calls[0];
    expect(String(input)).toBe(`/events/${EVENT_ID}/registrations/me/cancel`);
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeUndefined();
    expect(new Headers(init?.headers).has("Content-Type")).toBe(false);
  });

  it("encodes the event id", async () => {
    const fetch = stubFetch(() => jsonResponse(200, registration({ status: "cancelled" })));
    await cancelRegistration("a/b c");
    expect(String(fetch.mock.calls[0][0])).toBe("/events/a%2Fb%20c/registrations/me/cancel");
  });

  it("200: outcome cancelled with the registration", async () => {
    const answer = registration({ status: "cancelled" });
    stubFetch(() => jsonResponse(200, answer));
    expect(await cancelRegistration(EVENT_ID)).toEqual({
      outcome: "cancelled",
      registration: answer,
    });
  });

  it.each(["already_checked_in", "event_started", "event_passed", "event_cancelled"] as const)(
    "409 %s: that outcome",
    async (code) => {
      stubFetch(() => jsonResponse(409, { error: code }));
      expect(await cancelRegistration(EVENT_ID)).toEqual({ outcome: code });
    },
  );

  it.each<[string, () => Response, number]>([
    ["401", () => jsonResponse(401, { error: "not_logged_in" }), 401],
    ["403", () => jsonResponse(403, { error: "wrong_role" }), 403],
    ["404", () => jsonResponse(404, { error: "not_found" }), 404],
    ["500", () => jsonResponse(500, { error: "internal" }), 500],
    ["409 with an unknown code", () => jsonResponse(409, { error: "something_else" }), 409],
    ["409 with no code", () => jsonResponse(409, {}), 409],
    ["409 with a non-JSON body", () => new Response("Conflict", { status: 409 }), 409],
  ])("%s: throws ApiError with that status", async (_case, answer, status) => {
    stubFetch(answer);
    expect(await thrownStatus(cancelRegistration(EVENT_ID))).toBe(status);
  });

  it("a network error throws ApiError(0)", async () => {
    stubFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    expect(await thrownStatus(cancelRegistration(EVENT_ID))).toBe(0);
  });
});
