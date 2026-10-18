import { fireEvent, screen, waitFor } from "@testing-library/react";
import {
  ANN,
  OLGA,
  bodyOf,
  callsTo,
  deferred,
  json,
  mockFetch,
  renderApp,
} from "./test-helpers";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

type Handler = Parameters<typeof mockFetch>[0][string];

const loggedOut: Handler = () => json(401, { error: "not_logged_in" });

async function open(path: string, routes: Record<string, Handler> = {}) {
  const fetch = mockFetch({ "GET /auth/me": loggedOut, ...routes });
  const view = renderApp(path);
  await screen.findByLabelText("Email");
  return { fetch, ...view };
}

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function submit(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}

function errorFor(label: string): string | null {
  const input = screen.getByLabelText(label);
  const ids = (input.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean);
  const alert = ids
    .map((id) => document.getElementById(id))
    .find((element) => element?.getAttribute("role") === "alert");
  return alert?.textContent ?? null;
}

describe("W-A10: client checks before sending", () => {
  it("login: empty form shows email and password errors and sends nothing", async () => {
    const { fetch } = await open("/login");
    submit("Log in");
    expect(errorFor("Email")).toBe("Enter a valid email address.");
    expect(errorFor("Password")).toBe("Enter your password.");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("login: a short password is fine, only a non-empty one is needed", async () => {
    const { fetch } = await open("/login", { "POST /auth/users/login": () => json(200, ANN) });
    type("Email", "ann@mail.com");
    type("Password", "x");
    submit("Log in");
    await waitFor(() => expect(callsTo(fetch, "POST /auth/users/login")).toBe(1));
  });

  it("sign-up: each bad field gets its text and nothing is sent", async () => {
    const { fetch } = await open("/signup");
    type("Email", "ann@");
    type("Name", "   ");
    type("Password", "1234567");
    submit("Create account");
    expect(errorFor("Email")).toBe("Enter a valid email address.");
    expect(errorFor("Name")).toBe("Enter your name (1 to 100 characters).");
    expect(errorFor("Password")).toBe("Use 8 to 128 characters.");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("sign-up: trims email and name, not the password", async () => {
    const { fetch } = await open("/organizer/signup", {
      "POST /auth/organizers/signup": () => json(201, OLGA),
    });
    type("Email", "  Olga@Mail.com ");
    type("Name", "  Olga  ");
    type("Password", " spaced pass ");
    submit("Create account");
    await waitFor(() => expect(callsTo(fetch, "POST /auth/organizers/signup")).toBe(1));
    // Case is left to the server (it lowercases).
    expect(bodyOf(fetch, "POST /auth/organizers/signup")).toEqual({
      email: "Olga@Mail.com",
      name: "Olga",
      password: " spaced pass ",
    });
  });

  it("a fixed field loses its error on the next submit", async () => {
    await open("/signup", { "POST /auth/users/signup": () => json(201, ANN) });
    submit("Create account");
    expect(screen.getByLabelText("Email").getAttribute("aria-invalid")).toBe("true");
    type("Email", "ann@mail.com");
    type("Name", "Ann");
    type("Password", "long-enough");
    submit("Create account");
    expect(screen.getByLabelText("Email").getAttribute("aria-invalid")).toBeNull();
  });
});

describe("W-A11, W-A13-W-A15: API errors", () => {
  it.each([
    ["/login", "POST /auth/users/login"],
    ["/organizer/login", "POST /auth/organizers/login"],
  ])("401 on %s shows one text for a wrong email or password", async (path, route) => {
    await open(path, { [route]: () => json(401, { error: "invalid_credentials" }) });
    type("Email", "ann@mail.com");
    type("Password", "wrong-one");
    submit("Log in");
    const alert = await screen.findByText("Wrong email or password.");
    expect(alert.getAttribute("role")).toBe("alert");
    expect(document.activeElement).toBe(alert);
    expect(screen.getByLabelText("Email").getAttribute("aria-invalid")).toBeNull();
  });

  it.each([
    ["/signup", "POST /auth/users/signup"],
    ["/organizer/signup", "POST /auth/organizers/signup"],
  ])("409 on %s shows the text under the email field and focuses it", async (path, route) => {
    await open(path, { [route]: () => json(409, { error: "email_taken" }) });
    type("Email", "ann@mail.com");
    type("Name", "Ann");
    type("Password", "long-enough");
    submit("Create account");
    await waitFor(() => expect(errorFor("Email")).toBe("This email is already used."));
    const email = screen.getByLabelText("Email");
    expect(email.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(email);
  });

  it("400 for input the client accepted shows the form-level text (W-A11)", async () => {
    await open("/signup", {
      "POST /auth/users/signup": () => json(400, { error: "invalid_input" }),
    });
    type("Email", "ann@mail.com");
    type("Name", "Ann");
    type("Password", "long-enough");
    submit("Create account");
    const alert = await screen.findByText("Some fields are not valid. Check them and try again.");
    expect(alert.getAttribute("role")).toBe("alert");
    expect(document.activeElement).toBe(alert);
  });

  it.each([
    ["a 500", () => json(500, { error: "internal" })],
    [
      "a network error",
      () => {
        throw new TypeError("Failed to fetch");
      },
    ],
  ])("%s shows Something went wrong and keeps the typed values", async (_label, failure) => {
    await open("/login", { "POST /auth/users/login": failure });
    type("Email", "ann@mail.com");
    type("Password", "secret-pass");
    submit("Log in");
    const alert = await screen.findByText("Something went wrong. Try again.");
    expect(document.activeElement).toBe(alert);
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("ann@mail.com");
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("secret-pass");
    expect(screen.getByRole("button", { name: "Log in" })).toBeTruthy();
  });
});

describe("W-A12: pending state", () => {
  it.each([
    ["/login", "POST /auth/users/login", "Log in", "Logging in...", false],
    ["/organizer/signup", "POST /auth/organizers/signup", "Create account", "Creating account...", true],
  ])("%s disables the button, relabels it and sends once", async (path, route, label, pendingLabel, signup) => {
    const answer = deferred<Response>();
    const { fetch } = await open(path, { [route]: () => answer.promise });
    type("Email", "ann@mail.com");
    if (signup) type("Name", "Ann");
    type("Password", "long-enough");
    submit(label);

    const button = (await screen.findByRole("button", { name: pendingLabel })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    fireEvent.submit(button.closest("form")!);
    expect(callsTo(fetch, route)).toBe(1);

    answer.resolve(json(500));
    expect(await screen.findByRole("button", { name: label })).toBeTruthy();
    expect(callsTo(fetch, route)).toBe(1);
  });
});

describe("W-A16: focus after a failed client check", () => {
  it("goes to the first invalid field in form order", async () => {
    await open("/signup");
    type("Email", "ann@mail.com");
    type("Password", "short");
    submit("Create account");
    expect(document.activeElement).toBe(screen.getByLabelText("Name"));
  });

  it("goes to the email field when it is the first invalid one", async () => {
    await open("/login");
    submit("Log in");
    expect(document.activeElement).toBe(screen.getByLabelText("Email"));
  });
});

describe("W-A17: accessibility", () => {
  it("labels every input and links each error with aria-describedby", async () => {
    await open("/signup");
    submit("Create account");
    for (const label of ["Email", "Name", "Password"]) {
      const input = screen.getByLabelText(label);
      expect(input.getAttribute("aria-invalid")).toBe("true");
      expect(errorFor(label)).toBeTruthy();
    }
    // The password hint stays linked next to the error.
    expect(screen.getByLabelText("Password").getAttribute("aria-describedby")).toContain("hint");
    expect(screen.getAllByRole("alert")).toHaveLength(3);
  });

  it("valid inputs carry no aria-invalid", async () => {
    await open("/login");
    expect(screen.getByLabelText("Email").getAttribute("aria-invalid")).toBeNull();
    expect(screen.getByLabelText("Password").getAttribute("aria-invalid")).toBeNull();
  });

  it("the Show/Hide button toggles the password type and aria-pressed", async () => {
    await open("/organizer/login");
    const password = screen.getByLabelText("Password");
    const toggle = screen.getByRole("button", { name: "Show" });
    expect(password.getAttribute("type")).toBe("password");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    expect(password.getAttribute("type")).toBe("text");
    expect(screen.getByRole("button", { name: "Hide" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(password.getAttribute("type")).toBe("password");
  });
});

describe("W-A19: links to the neighbour pages", () => {
  it.each([
    ["/login", "Sign up", "/signup", "I organize events", "/organizer/login"],
    ["/signup", "Log in", "/login", "I organize events", "/organizer/signup"],
    ["/organizer/login", "Sign up", "/organizer/signup", "I am an attendee", "/login"],
    ["/organizer/signup", "Log in", "/organizer/login", "I am an attendee", "/signup"],
  ])("%s links to %s and %s", async (path, modeLink, modePath, roleLink, rolePath) => {
    await open(path);
    const card = screen.getByRole("heading", { level: 1 }).closest("section")!;
    const links = Array.from(card.querySelectorAll("a")).map((a) => [
      a.textContent,
      a.getAttribute("href"),
    ]);
    expect(links).toEqual([
      [modeLink, modePath],
      [roleLink, rolePath],
    ]);
  });
});

describe("W-A20: the password stays in the input", () => {
  it("is not in the URL, storage, the caches or the console", async () => {
    const secret = "very-secret-pass";
    const logs = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
      vi.spyOn(console, level),
    );
    let attempt = 0;
    const { queryClient } = await open("/login?next=%2Forganizer", {
      "POST /auth/users/login": () =>
        ++attempt === 1 ? json(401, { error: "invalid_credentials" }) : json(200, ANN),
    });
    type("Email", "ann@mail.com");
    type("Password", secret);
    submit("Log in");
    await screen.findByText("Wrong email or password.");

    const caches = () =>
      JSON.stringify([
        queryClient.getQueryCache().getAll().map((query) => query.state),
        queryClient.getMutationCache().getAll().map((mutation) => mutation.state),
      ]);
    expect(caches()).not.toContain(secret);

    submit("Log in");
    await waitFor(() => expect(screen.getByTestId("location").textContent).not.toMatch(/^\/login/));

    expect(screen.getByTestId("location").textContent).not.toContain(secret);
    expect(window.location.href).not.toContain(secret);
    expect(JSON.stringify({ ...localStorage })).not.toContain(secret);
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(secret);
    expect(caches()).not.toContain(secret);
    for (const spy of logs) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(secret);
    }
  });
});
