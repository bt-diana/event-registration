// Tests first (events-web.md): W-E4, W-E6, W-E7.
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { OLGA, bodyOf, callsTo, deferred, json, mockFetch, renderApp } from "../auth/test-helpers";
import { EVENT_ID, organizerEvent } from "./test-helpers";

afterEach(() => {
  vi.unstubAllGlobals();
});

const PATH = "/organizer/events/new";
const CREATE = "POST /events";
const OWN = `GET /events/${EVENT_ID}`;

function location(): string | null {
  return screen.getByTestId("location").textContent;
}

type Values = {
  title?: string;
  description?: string;
  start?: string;
  duration?: string;
  capacity?: string;
};

async function fill(values: Values = {}) {
  const v = {
    title: "Spring meetup",
    description: "",
    start: "2030-01-01T10:00",
    duration: "90",
    capacity: "25",
    ...values,
  };
  fireEvent.change(await screen.findByLabelText("Title"), { target: { value: v.title } });
  fireEvent.change(screen.getByLabelText("Description (optional)"), {
    target: { value: v.description },
  });
  fireEvent.change(screen.getByLabelText("Starts"), { target: { value: v.start } });
  fireEvent.change(screen.getByLabelText("Duration (minutes)"), {
    target: { value: v.duration },
  });
  fireEvent.change(screen.getByLabelText("Capacity (seats)"), { target: { value: v.capacity } });
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: "Create event" }));
}

describe("W-E4: create sends exactly the five fields", () => {
  it("trims title and description and sends starts_at as UTC from the local time", async () => {
    const fetch = mockFetch({
      "GET /auth/me": () => json(200, OLGA),
      [CREATE]: () => json(201, organizerEvent()),
      [OWN]: () => json(200, organizerEvent()),
    });
    renderApp(PATH);
    await fill({
      title: "  Spring meetup  ",
      description: "  Bring a laptop.\n\nDoors at 9.  ",
      start: "2030-01-01T10:00",
      duration: "90",
      capacity: "25",
    });
    submit();

    await waitFor(() => expect(callsTo(fetch, CREATE)).toBe(1));
    expect(bodyOf(fetch, CREATE)).toEqual({
      title: "Spring meetup",
      description: "Bring a laptop.\n\nDoors at 9.",
      starts_at: new Date("2030-01-01T10:00").toISOString(),
      duration_minutes: 90,
      capacity: 25,
    });
    expect((bodyOf(fetch, CREATE) as { starts_at: string }).starts_at).toMatch(/Z$/);
  });

  it("sends an empty description as an empty string", async () => {
    const fetch = mockFetch({
      "GET /auth/me": () => json(200, OLGA),
      [CREATE]: () => json(201, organizerEvent()),
      [OWN]: () => json(200, organizerEvent()),
    });
    renderApp(PATH);
    await fill({ description: "   " });
    submit();

    await waitFor(() => expect(callsTo(fetch, CREATE)).toBe(1));
    expect((bodyOf(fetch, CREATE) as { description: string }).description).toBe("");
  });

  it("has the five labelled fields in order", async () => {
    mockFetch({ "GET /auth/me": () => json(200, OLGA) });
    renderApp(PATH);
    expect(await screen.findByRole("heading", { level: 1, name: "Create event" })).toBeTruthy();
    const labels = Array.from(document.querySelectorAll("form label")).map((l) => l.textContent);
    expect(labels).toEqual([
      "Title",
      "Description (optional)",
      "Starts",
      "Duration (minutes)",
      "Capacity (seats)",
    ]);
    expect(screen.getByLabelText("Description (optional)").tagName).toBe("TEXTAREA");
    expect(screen.getByLabelText("Starts").getAttribute("type")).toBe("datetime-local");
    expect(screen.getByLabelText("Duration (minutes)").getAttribute("inputmode")).toBe("numeric");
    expect(screen.getByLabelText("Capacity (seats)").getAttribute("inputmode")).toBe("numeric");
  });
});

describe("W-E6: a 400 shows one form-level message and keeps the values", () => {
  it("shows the message, keeps the typed values and does not navigate", async () => {
    const fetch = mockFetch({
      "GET /auth/me": () => json(200, OLGA),
      [CREATE]: () => json(400, { error: "invalid_input" }),
    });
    renderApp(PATH);
    await fill({ title: "  Spring meetup  ", description: "Hello", capacity: "25" });
    submit();

    const alert = await screen.findByText("Some fields are not valid. Check them and try again.");
    expect(alert.getAttribute("role")).toBe("alert");
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("  Spring meetup  ");
    expect((screen.getByLabelText("Description (optional)") as HTMLTextAreaElement).value).toBe(
      "Hello",
    );
    expect((screen.getByLabelText("Capacity (seats)") as HTMLInputElement).value).toBe("25");
    expect(location()).toBe(PATH);
    expect(callsTo(fetch, CREATE)).toBe(1);
    // No per-field server errors: the API sends no field names.
    expect(document.querySelectorAll('[aria-invalid="true"]').length).toBe(0);
  });
});

describe("W-E7: pending create", () => {
  it("disables the button, reads Creating... and a second click sends nothing", async () => {
    const answer = deferred<Response>();
    const fetch = mockFetch({
      "GET /auth/me": () => json(200, OLGA),
      [CREATE]: () => answer.promise,
      [OWN]: () => json(200, organizerEvent()),
    });
    renderApp(PATH);
    await fill();
    submit();

    const button = (await screen.findByRole("button", { name: "Creating..." })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    fireEvent.submit(button.closest("form")!);
    expect(callsTo(fetch, CREATE)).toBe(1);

    answer.resolve(json(201, organizerEvent()));
    await waitFor(() => expect(location()).toBe(`/event/${EVENT_ID}`));
    expect(callsTo(fetch, CREATE)).toBe(1);
  });
});

describe("W-E5 and W-E20: client checks", () => {
  it("shows an error on each bad field, sends nothing and focuses the first one", async () => {
    const fetch = mockFetch({ "GET /auth/me": () => json(200, OLGA) });
    renderApp(PATH);
    await fill({
      title: "   ",
      description: "a".repeat(2001),
      start: "2020-01-01T10:00",
      duration: "0",
      capacity: "1.5",
    });
    submit();

    const expected: Array<[string, string]> = [
      ["Title", "Enter a title (1 to 200 characters)."],
      ["Description (optional)", "Description is too long (2000 characters at most)."],
      ["Starts", "Choose a start in the future."],
      ["Duration (minutes)", "Enter whole minutes from 1 to 1440."],
      ["Capacity (seats)", "Enter a whole number from 1 to 100000."],
    ];
    for (const [label, text] of expected) {
      const input = screen.getByLabelText(label);
      const error = screen.getByText(text);
      expect(input.getAttribute("aria-invalid")).toBe("true");
      expect(error.getAttribute("role")).toBe("alert");
      expect(input.getAttribute("aria-describedby")?.split(" ")).toContain(error.id);
    }
    expect(document.activeElement).toBe(screen.getByLabelText("Title"));
    expect(callsTo(fetch, CREATE)).toBe(0);
  });

  it("focuses the first invalid field in form order", async () => {
    mockFetch({ "GET /auth/me": () => json(200, OLGA) });
    renderApp(PATH);
    await fill({ duration: "", capacity: "100001" });
    submit();
    expect(await screen.findByText("Enter whole minutes from 1 to 1440.")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText("Duration (minutes)"));
    expect(screen.getByLabelText("Title").getAttribute("aria-invalid")).toBeNull();
  });

  it("clears the errors once the values are fixed and then sends", async () => {
    const fetch = mockFetch({
      "GET /auth/me": () => json(200, OLGA),
      [CREATE]: () => json(201, organizerEvent()),
      [OWN]: () => json(200, organizerEvent()),
    });
    renderApp(PATH);
    await fill({ capacity: "" });
    submit();
    expect(await screen.findByText("Enter a whole number from 1 to 100000.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Capacity (seats)"), { target: { value: "25" } });
    submit();
    await waitFor(() => expect(callsTo(fetch, CREATE)).toBe(1));
    expect(screen.queryByText("Enter a whole number from 1 to 100000.")).toBeNull();
  });

  it("shows the hints, with the browser zone on the start", async () => {
    mockFetch({ "GET /auth/me": () => json(200, OLGA) });
    renderApp(PATH);
    expect(await screen.findByText("1 to 200 characters")).toBeTruthy();
    expect(
      screen.getByText(
        "Shown on the public event page, so everyone can read it. Up to 2000 characters.",
      ),
    ).toBeTruthy();
    expect(screen.getByText(/^Your local time \(.+\)$/)).toBeTruthy();
    expect(screen.getByText("1 to 1440")).toBeTruthy();
    expect(screen.getByText("1 to 100000")).toBeTruthy();
    expect(screen.getByLabelText("Starts").getAttribute("min")).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/,
    );
  });
});

describe("W-E8: after a 201", () => {
  it("caches the event, marks the list stale and goes to the event page", async () => {
    const created = organizerEvent({ title: "New one" });
    mockFetch({
      "GET /auth/me": () => json(200, OLGA),
      [CREATE]: () => json(201, created),
      [OWN]: () => json(200, created),
    });
    const { queryClient } = renderApp(PATH);
    queryClient.setQueryData(["events"], []);
    await fill({ title: "New one" });
    submit();

    await waitFor(() => expect(location()).toBe(`/event/${EVENT_ID}`));
    expect(queryClient.getQueryData(["events", EVENT_ID])).toMatchObject(created);
    expect(queryClient.getQueryState(["events"])?.isInvalidated).toBe(true);
  });
});

describe("W-E9 and W-E20: network error or 5xx on create", () => {
  it.each([
    ["a 5xx", () => json(500, { error: "internal" })],
    [
      "a network error",
      () => {
        throw new TypeError("Failed to fetch");
      },
    ],
  ])("shows Something went wrong on %s, keeps values, focuses the message", async (_l, failure) => {
    mockFetch({
      "GET /auth/me": () => json(200, OLGA),
      [CREATE]: failure,
    });
    renderApp(PATH);
    await fill({ title: "Spring meetup", duration: "45" });
    submit();

    const alert = await screen.findByText("Something went wrong. Try again.");
    expect(alert.getAttribute("role")).toBe("alert");
    await waitFor(() => expect(document.activeElement).toBe(alert));
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Spring meetup");
    expect((screen.getByLabelText("Duration (minutes)") as HTMLInputElement).value).toBe("45");
    expect(location()).toBe(PATH);
    expect(screen.getByRole("button", { name: "Create event" })).toBeTruthy();
  });

  it("focuses the form error after a 400 too", async () => {
    mockFetch({
      "GET /auth/me": () => json(200, OLGA),
      [CREATE]: () => json(400, { error: "invalid_input" }),
    });
    renderApp(PATH);
    await fill();
    submit();
    const alert = await screen.findByText("Some fields are not valid. Check them and try again.");
    await waitFor(() => expect(document.activeElement).toBe(alert));
  });
});

describe("W-E20 and W-E21: page structure", () => {
  it("has one h1 and a Back to events link", async () => {
    mockFetch({ "GET /auth/me": () => json(200, OLGA) });
    renderApp(PATH);
    expect(await screen.findByRole("heading", { level: 1, name: "Create event" })).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 1 }).length).toBe(1);
    expect(screen.getByRole("link", { name: "Back to events" }).getAttribute("href")).toBe(
      "/organizer",
    );
  });
});
