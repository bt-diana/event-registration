// Tests first (registration-web.md): W-R30 denied, no camera, insecure; W-R31 no request
// on invalid text; W-R33 one request per code; W-R35 the camera is released; W-R34 valid
// and already checked in. Then W-R29, W-R32, W-R34 (the other answers), W-R36.
// scanner.ts is mocked (jsdom has no camera and no decoding, W-R37); getUserMedia is a
// stub on navigator.mediaDevices; POST /checkin is answered by the fetch mock.
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import {
  OLGA,
  bodyOf,
  callsTo,
  deferred,
  json,
  mockFetch,
  renderApp,
  renderWith,
} from "../auth/test-helpers";
import { formatDateTime } from "../events/format";
import { EVENT_ID, organizerEvent } from "../events/test-helpers";
import { ScanScreen } from "./ScanScreen";
import { hasCamera, startScanner } from "./scanner";
import { SECOND_EVENT_ID } from "./test-helpers";

vi.mock("./scanner", () => ({ hasCamera: vi.fn(), startScanner: vi.fn() }));

type Handler = () => Response | Promise<Response>;

const ME = "GET /auth/me";
const EVENTS = "GET /events";
const CHECKIN = "POST /checkin";
const SCAN_PATH = `/registrations/scan?event=${EVENT_ID}`;
const CODE = "K7M2QX9TPA";

const EVENT_LIST = {
  events: [organizerEvent(), organizerEvent({ id: SECOND_EVENT_ID, title: "Autumn fair" })],
};

const CHECKED_IN = {
  registration_id: "9c8b7a6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d",
  ticket_code: CODE,
  event_id: EVENT_ID,
  event_title: "Spring meetup",
  attendee_name: "Ann Lee",
  checked_in_at: "2030-01-01T09:55:00.000Z",
};

const scannerStop = vi.fn();
let onText: (text: string) => void = () => undefined;

function fakeStream() {
  const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
  return { stream: { getTracks: () => tracks } as unknown as MediaStream, tracks };
}

function setMediaDevices(value: unknown) {
  Object.defineProperty(navigator, "mediaDevices", { value, configurable: true });
}

function setSecure(value: boolean) {
  Object.defineProperty(window, "isSecureContext", { value, configurable: true });
}

beforeEach(() => {
  vi.mocked(hasCamera).mockResolvedValue(true);
  vi.mocked(startScanner).mockImplementation((_video, callback) => {
    onText = callback;
    return scannerStop;
  });
  setSecure(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  setMediaDevices(undefined);
});

function main() {
  return within(screen.getByRole("main"));
}

function location(): string | null {
  return screen.getByTestId("location").textContent;
}

async function scanScreen(checkin: Handler = () => json(200, CHECKED_IN), path = SCAN_PATH) {
  const fetch = mockFetch({
    [ME]: () => json(200, OLGA),
    [EVENTS]: () => json(200, EVENT_LIST),
    [CHECKIN]: checkin,
  });
  const rendered = renderApp(path);
  await main().findByRole("heading", { level: 1, name: "Check in" });
  await main().findByLabelText("Event");
  return { fetch, ...rendered };
}

// The camera starts and the preview is active.
async function withCamera(checkin?: Handler) {
  const { stream, tracks } = fakeStream();
  const getUserMedia = vi.fn(() => Promise.resolve(stream));
  setMediaDevices({ getUserMedia });
  const result = await scanScreen(checkin);
  fireEvent.click(main().getByRole("button", { name: "Start camera" }));
  await main().findByText("Point the camera at the ticket QR code.");
  await waitFor(() => expect(startScanner).toHaveBeenCalledTimes(1));
  return { ...result, stream, tracks, getUserMedia };
}

function typeCode(value: string) {
  fireEvent.change(main().getByLabelText("Ticket code"), { target: { value } });
  fireEvent.click(main().getByRole("button", { name: "Check in" }));
}

describe("W-R30: camera states (tests first: denied, no camera, insecure)", () => {
  it("asks for nothing on load; Start camera asks once with the back camera", async () => {
    const { getUserMedia } = await withCamera();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledWith({ video: { facingMode: "environment" }, audio: false });
  });

  it("no permission prompt before the click", async () => {
    const getUserMedia = vi.fn();
    setMediaDevices({ getUserMedia });
    await scanScreen();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(hasCamera).not.toHaveBeenCalled();
    expect(main().getByRole("button", { name: "Start camera" })).toBeTruthy();
  });

  it("asking: Waiting for camera permission... as a status", async () => {
    const pending = deferred<MediaStream>();
    setMediaDevices({ getUserMedia: () => pending.promise });
    await scanScreen();
    fireEvent.click(main().getByRole("button", { name: "Start camera" }));
    expect((await main().findByText("Waiting for camera permission...")).getAttribute("role")).toBe(
      "status",
    );
  });

  it("active: the preview video goes to the scanner with the stream", async () => {
    const { stream } = await withCamera();
    const video = main().getByLabelText("Camera preview") as HTMLVideoElement;
    expect(video.tagName).toBe("VIDEO");
    expect(vi.mocked(startScanner).mock.calls[0][0]).toBe(video);
    expect(video.srcObject).toBe(stream);
  });

  it.each(["NotAllowedError", "SecurityError"])("%s: denied message, manual form usable", async (name) => {
    setMediaDevices({ getUserMedia: () => Promise.reject(new DOMException("no", name)) });
    await scanScreen();
    fireEvent.click(main().getByRole("button", { name: "Start camera" }));
    expect(
      await main().findByText(
        "Camera access is blocked. Allow the camera in your browser settings, or enter the code below.",
      ),
    ).toBeTruthy();
    expect(startScanner).not.toHaveBeenCalled();
    expect((main().getByLabelText("Ticket code") as HTMLInputElement).disabled).toBe(false);
  });

  it("hasCamera() false: no camera message, no permission prompt", async () => {
    vi.mocked(hasCamera).mockResolvedValue(false);
    const getUserMedia = vi.fn();
    setMediaDevices({ getUserMedia });
    await scanScreen();
    fireEvent.click(main().getByRole("button", { name: "Start camera" }));
    expect(await main().findByText("No camera found. Enter the code below.")).toBeTruthy();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it.each(["NotFoundError", "OverconstrainedError"])("%s: no camera message", async (name) => {
    setMediaDevices({ getUserMedia: () => Promise.reject(new DOMException("no", name)) });
    await scanScreen();
    fireEvent.click(main().getByRole("button", { name: "Start camera" }));
    expect(await main().findByText("No camera found. Enter the code below.")).toBeTruthy();
  });

  it("not a secure context: insecure message, nothing asked", async () => {
    setSecure(false);
    const getUserMedia = vi.fn();
    setMediaDevices({ getUserMedia });
    await scanScreen();
    fireEvent.click(main().getByRole("button", { name: "Start camera" }));
    expect(
      await main().findByText(
        "The camera needs a secure connection (https or localhost). Enter the code below.",
      ),
    ).toBeTruthy();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(hasCamera).not.toHaveBeenCalled();
  });

  it("no navigator.mediaDevices: insecure message", async () => {
    setMediaDevices(undefined);
    await scanScreen();
    fireEvent.click(main().getByRole("button", { name: "Start camera" }));
    expect(
      await main().findByText(
        "The camera needs a secure connection (https or localhost). Enter the code below.",
      ),
    ).toBeTruthy();
  });

  it("another error: Could not start the camera. and Try again asks again", async () => {
    const { stream } = fakeStream();
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(new DOMException("busy", "NotReadableError"))
      .mockResolvedValueOnce(stream);
    setMediaDevices({ getUserMedia });
    await scanScreen();
    fireEvent.click(main().getByRole("button", { name: "Start camera" }));
    expect(await main().findByText("Could not start the camera.")).toBeTruthy();
    fireEvent.click(main().getByRole("button", { name: "Try again" }));
    expect(await main().findByText("Point the camera at the ticket QR code.")).toBeTruthy();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });
});

describe("W-R31: decoded text is checked before any request (tests first)", () => {
  it("a URL: This is not a ticket code., no request, scanning goes on", async () => {
    const { fetch } = await withCamera();
    act(() => onText("https://example.com/ticket"));
    expect(main().getByRole("alert").textContent).toBe("This is not a ticket code.");
    act(() => onText("https://example.com/ticket"));
    expect(main().getAllByRole("alert")).toHaveLength(1);
    expect(callsTo(fetch, CHECKIN)).toBe(0);
    // A valid code after it is still sent.
    act(() => onText(` ${CODE} `));
    await waitFor(() => expect(callsTo(fetch, CHECKIN)).toBe(1));
    expect(bodyOf(fetch, CHECKIN)).toEqual({ ticket_code: CODE });
  });

  it.each(["k7m2qx9tpa", "K7M2QX9TPO", "K7M2QX9TP", "other qr"])(
    "%s is not sent",
    async (text) => {
      const { fetch } = await withCamera();
      act(() => onText(text));
      expect(main().getByText("This is not a ticket code.")).toBeTruthy();
      expect(callsTo(fetch, CHECKIN)).toBe(0);
    },
  );
});

describe("W-R32: manual entry", () => {
  it.each(["", "K7M2", "K7M2QX9TPI"])("%j: field error and no request", async (value) => {
    const { fetch } = await scanScreen();
    typeCode(value);
    const error = main().getByText(
      "Enter a valid ticket code: 10 characters, A-Z without I and O, and 2-9.",
    );
    const input = main().getByLabelText("Ticket code");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(error.id);
    expect(callsTo(fetch, CHECKIN)).toBe(0);
  });

  it("lower case with spaces is sent upper-cased without spaces", async () => {
    const { fetch } = await scanScreen();
    typeCode(" k7m2 qx9 tpa ");
    await waitFor(() => expect(callsTo(fetch, CHECKIN)).toBe(1));
    expect(bodyOf(fetch, CHECKIN)).toEqual({ ticket_code: CODE });
  });

  it("the input attributes", async () => {
    await scanScreen();
    const input = main().getByLabelText("Ticket code");
    expect(input.getAttribute("autocapitalize")).toBe("characters");
    expect(input.getAttribute("autocomplete")).toBe("off");
    expect(input.getAttribute("spellcheck")).toBe("false");
    expect(input.getAttribute("inputmode")).toBe("text");
    expect(main().getByRole("heading", { level: 2, name: "Or enter the code" })).toBeTruthy();
  });

  it("works without a camera at all", async () => {
    setMediaDevices(undefined);
    const { fetch } = await scanScreen();
    typeCode(CODE);
    expect(await main().findByRole("heading", { name: "Checked in" })).toBeTruthy();
    expect(callsTo(fetch, CHECKIN)).toBe(1);
  });
});

describe("W-R33: one request per code (tests first)", () => {
  it("five reads of one code send one POST /checkin; reads while the result shows send nothing", async () => {
    const answer = deferred<Response>();
    const { fetch } = await withCamera(() => answer.promise);
    act(() => {
      for (let i = 0; i < 5; i += 1) onText(CODE);
    });
    await waitFor(() => expect(callsTo(fetch, CHECKIN)).toBe(1));
    const button = main().getByRole("button", { name: "Checking..." }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    act(() => onText(CODE));
    await act(async () => answer.resolve(json(200, CHECKED_IN)));
    expect(await main().findByRole("heading", { name: "Checked in" })).toBeTruthy();
    act(() => {
      onText(CODE);
      onText("H4Z8WR5NCD");
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(callsTo(fetch, CHECKIN)).toBe(1);
  });

  it("a double click on Check in sends one request", async () => {
    const answer = deferred<Response>();
    const { fetch } = await scanScreen(() => answer.promise);
    fireEvent.change(main().getByLabelText("Ticket code"), { target: { value: CODE } });
    const button = main().getByRole("button", { name: "Check in" });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(callsTo(fetch, CHECKIN)).toBe(1));
    await act(async () => answer.resolve(json(200, CHECKED_IN)));
    await main().findByRole("heading", { name: "Checked in" });
    expect(callsTo(fetch, CHECKIN)).toBe(1);
  });

  it("Scan next clears the result and the next code is sent", async () => {
    const { fetch } = await withCamera();
    act(() => onText(CODE));
    await main().findByRole("heading", { name: "Checked in" });
    fireEvent.click(main().getByRole("button", { name: "Scan next" }));
    expect(main().queryByRole("heading", { name: "Checked in" })).toBeNull();
    act(() => onText("H4Z8WR5NCD"));
    await waitFor(() => expect(callsTo(fetch, CHECKIN)).toBe(2));
  });

  it("a submitCode prop replaces the request (the stub counts calls)", async () => {
    mockFetch({ [ME]: () => json(200, OLGA), [EVENTS]: () => json(200, EVENT_LIST) });
    const submitCode = vi.fn(() =>
      Promise.resolve({ outcome: "not_found" as const, ticket_code: CODE }),
    );
    renderWith(<ScanScreen submitCode={submitCode} />, SCAN_PATH);
    await screen.findByLabelText("Event");
    fireEvent.change(screen.getByLabelText("Ticket code"), { target: { value: CODE } });
    fireEvent.click(screen.getByRole("button", { name: "Check in" }));
    expect(await screen.findByRole("heading", { name: "Ticket not found." })).toBeTruthy();
    expect(submitCode).toHaveBeenCalledTimes(1);
    expect(submitCode).toHaveBeenCalledWith(CODE);
  });
});

describe("W-R34: result states", () => {
  it("200 (test first): Checked in, the name, the code and the event title; focus on the heading", async () => {
    await withCamera(() => json(200, CHECKED_IN));
    act(() => onText(CODE));
    const heading = await main().findByRole("heading", { level: 2, name: "Checked in" });
    expect(document.activeElement).toBe(heading);
    const result = heading.closest("[role]")!;
    expect(result.getAttribute("role")).toBe("status");
    expect(within(result as HTMLElement).getByText("Ann Lee")).toBeTruthy();
    expect(within(result as HTMLElement).getByText(CODE)).toBeTruthy();
    expect(within(result as HTMLElement).getByText("Spring meetup")).toBeTruthy();
    expect(main().getByRole("button", { name: "Scan next" })).toBeTruthy();
  });

  it("409 already_checked_in (test first): the name and the first check-in time", async () => {
    await withCamera(() =>
      json(409, {
        error: "already_checked_in",
        checked_in_at: "2030-01-01T09:40:00.000Z",
        attendee_name: "Ann Lee",
      }),
    );
    act(() => onText(CODE));
    const heading = await main().findByRole("heading", { level: 2, name: "Already checked in" });
    const result = heading.closest("[role]") as HTMLElement;
    expect(result.getAttribute("role")).toBe("status");
    expect(within(result).getByText("Ann Lee")).toBeTruthy();
    expect(within(result).getByText(formatDateTime("2030-01-01T09:40:00.000Z"), { exact: false })).toBeTruthy();
    expect(within(result).getByText(CODE)).toBeTruthy();
  });

  it.each<[string, number, string, string]>([
    ["404 not_found", 404, "not_found", "Ticket not found."],
    ["409 waitlisted", 409, "waitlisted", "On the waiting list, no seat yet."],
    ["409 registration_cancelled", 409, "registration_cancelled", "This ticket is cancelled."],
    ["409 event_cancelled", 409, "event_cancelled", "This event is cancelled."],
    ["400 invalid_input", 400, "invalid_input", "This is not a ticket code."],
  ])("%s: the message as an alert, Scan next", async (_case, status, error, text) => {
    await scanScreen(() => json(status, { error }));
    typeCode(CODE);
    const heading = await main().findByRole("heading", { level: 2, name: text });
    expect(heading.closest("[role]")?.getAttribute("role")).toBe("alert");
    expect(document.activeElement).toBe(heading);
    fireEvent.click(main().getByRole("button", { name: "Scan next" }));
    expect(main().queryByRole("heading", { name: text })).toBeNull();
  });

  it.each<[string, Handler]>([
    ["5xx", () => json(500, { error: "internal" })],
    [
      "network error",
      () => {
        throw new TypeError("Failed to fetch");
      },
    ],
  ])("%s: Something went wrong, Try again resends the same code once", async (_case, failure) => {
    let n = 0;
    const { fetch } = await scanScreen(() => (n++ === 0 ? failure() : json(200, CHECKED_IN)));
    typeCode(CODE);
    expect(
      await main().findByRole("heading", { level: 2, name: "Something went wrong. Try again." }),
    ).toBeTruthy();
    fireEvent.click(main().getByRole("button", { name: "Try again" }));
    expect(await main().findByRole("heading", { name: "Checked in" })).toBeTruthy();
    expect(callsTo(fetch, CHECKIN)).toBe(2);
    expect(fetch.mock.calls.filter(([input]) => input === "/checkin").map(([, init]) => init?.body)).toEqual([
      JSON.stringify({ ticket_code: CODE }),
      JSON.stringify({ ticket_code: CODE }),
    ]);
  });

  it("401 re-checks me, no text of its own; the guard sends to the organizer login", async () => {
    let first = true;
    const fetch = mockFetch({
      [ME]: () => {
        if (first) {
          first = false;
          return json(200, OLGA);
        }
        return json(401, { error: "not_logged_in" });
      },
      [EVENTS]: () => json(200, EVENT_LIST),
      [CHECKIN]: () => json(401, { error: "not_logged_in" }),
    });
    renderApp(SCAN_PATH);
    await main().findByLabelText("Event");
    typeCode(CODE);
    await waitFor(() => expect(location()).toMatch(/^\/organizer\/login\?next=/));
    expect(screen.queryByText("Something went wrong. Try again.")).toBeNull();
    expect(callsTo(fetch, ME)).toBe(2);
  });
});

describe("W-R35: the camera is released (tests first)", () => {
  it("on unmount: every track and the scanner are stopped", async () => {
    const { tracks, unmount } = await withCamera();
    unmount();
    for (const track of tracks) expect(track.stop).toHaveBeenCalled();
    expect(scannerStop).toHaveBeenCalled();
  });

  it("on a route change", async () => {
    const { tracks } = await withCamera();
    fireEvent.click(screen.getByRole("link", { name: "Registrations" }));
    await waitFor(() => expect(location()).toBe("/registrations"));
    for (const track of tracks) expect(track.stop).toHaveBeenCalled();
    expect(scannerStop).toHaveBeenCalled();
  });

  it("when the event changes: stopped, back to Start camera", async () => {
    const { tracks } = await withCamera();
    fireEvent.change(main().getByLabelText("Event"), { target: { value: SECOND_EVENT_ID } });
    for (const track of tracks) expect(track.stop).toHaveBeenCalled();
    expect(scannerStop).toHaveBeenCalled();
    expect(main().getByRole("button", { name: "Start camera" })).toBeTruthy();
    expect(location()).toBe(`/registrations/scan?event=${SECOND_EVENT_ID}`);
  });

  it("unmount while permission is asked: the late stream is stopped at once, no scanner", async () => {
    const pending = deferred<MediaStream>();
    setMediaDevices({ getUserMedia: () => pending.promise });
    const { unmount } = await scanScreen();
    fireEvent.click(main().getByRole("button", { name: "Start camera" }));
    await main().findByText("Waiting for camera permission...");
    unmount();
    const { stream, tracks } = fakeStream();
    await act(async () => pending.resolve(stream));
    for (const track of tracks) expect(track.stop).toHaveBeenCalled();
    expect(startScanner).not.toHaveBeenCalled();
  });
});

describe("W-R29: event selector", () => {
  it("defaults to the event parameter, else the first event", async () => {
    await scanScreen(undefined, `/registrations/scan?event=${SECOND_EVENT_ID}`);
    expect((main().getByLabelText("Event") as HTMLSelectElement).value).toBe(SECOND_EVENT_ID);
  });

  it("no events: You have no events yet., Create event, no camera", async () => {
    mockFetch({ [ME]: () => json(200, OLGA), [EVENTS]: () => json(200, { events: [] }) });
    renderApp("/registrations/scan");
    expect(await main().findByText("You have no events yet.")).toBeTruthy();
    expect(main().getByRole("link", { name: "Create event" }).getAttribute("href")).toBe(
      "/organizer/events/new",
    );
    expect(main().queryByRole("button", { name: "Start camera" })).toBeNull();
  });

  it("events error: Could not load events and Retry", async () => {
    let n = 0;
    const fetch = mockFetch({
      [ME]: () => json(200, OLGA),
      [EVENTS]: () => (n++ === 0 ? json(500, { error: "internal" }) : json(200, EVENT_LIST)),
    });
    renderApp("/registrations/scan");
    expect(await main().findByText("Could not load events")).toBeTruthy();
    fireEvent.click(main().getByRole("button", { name: "Retry" }));
    expect(await main().findByLabelText("Event")).toBeTruthy();
    expect(callsTo(fetch, EVENTS)).toBe(2);
  });

  it('shows "Loading..." while the events load', async () => {
    const events = deferred<Response>();
    mockFetch({ [ME]: () => json(200, OLGA), [EVENTS]: () => events.promise });
    renderApp("/registrations/scan");
    expect((await main().findByRole("status")).textContent).toBe("Loading...");
  });
});

describe("W-R36: accessibility", () => {
  it("one h1, the video is labelled, inline and muted, buttons are real buttons", async () => {
    await withCamera();
    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual([
      "Check in",
    ]);
    const video = main().getByLabelText("Camera preview") as HTMLVideoElement;
    expect(video.hasAttribute("playsinline")).toBe(true);
    expect(video.muted).toBe(true);
    for (const button of main().getAllByRole("button")) {
      expect(button.tagName).toBe("BUTTON");
      expect(button.getAttribute("type")).not.toBeNull();
    }
  });
});
