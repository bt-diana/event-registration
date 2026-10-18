import { fireEvent, screen, waitFor } from "@testing-library/react";
import { App } from "../App";
import { useMe } from "./session";
import {
  ANN,
  OLGA,
  bodyOf,
  callsTo,
  json,
  mockFetch,
  renderApp,
  renderWith,
} from "./test-helpers";

afterEach(() => {
  vi.unstubAllGlobals();
});

function MeEmail() {
  const me = useMe();
  return <p>{me.data ? me.data.email : "nobody"}</p>;
}

describe("W-A1: one GET /auth/me at start", () => {
  it("makes one call even when many components read the session", async () => {
    const fetch = mockFetch({ "GET /auth/me": () => json(401, { error: "not_logged_in" }) });
    renderWith(
      <>
        <App />
        <MeEmail />
        <MeEmail />
        <MeEmail />
      </>,
      "/organizer/login",
    );
    expect(await screen.findByLabelText("Email")).toBeTruthy();
    expect(screen.getAllByText("nobody")).toHaveLength(3);
    expect(callsTo(fetch, "GET /auth/me")).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1]?.credentials).toBe("same-origin");
  });

  it("gives the session on 200", async () => {
    const fetch = mockFetch({ "GET /auth/me": () => json(200, ANN) });
    const { queryClient } = renderApp("/");
    expect(await screen.findByText("Ann")).toBeTruthy();
    expect(queryClient.getQueryData(["me"])).toEqual(ANN);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("treats 401 as logged out, not as an error", async () => {
    mockFetch({ "GET /auth/me": () => json(401, { error: "not_logged_in" }) });
    const { queryClient } = renderApp("/login");
    expect(await screen.findByLabelText("Email")).toBeTruthy();
    expect(queryClient.getQueryData(["me"])).toBeNull();
    expect(screen.queryByText("Could not check your login")).toBeNull();
    expect(screen.getByRole("link", { name: "Log in" })).toBeTruthy();
  });
});

describe("W-A8: login and sign-up fill the me cache", () => {
  it("attendee login puts the answer in the cache, no second GET /auth/me", async () => {
    const fetch = mockFetch({
      "GET /auth/me": () => json(401, { error: "not_logged_in" }),
      "POST /auth/users/login": () => json(200, ANN),
    });
    const { queryClient } = renderApp("/login");
    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "ann@mail.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret-pass" } });
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Events" })).toBeTruthy();
    expect(queryClient.getQueryData(["me"])).toEqual(ANN);
    expect(screen.getByText("Ann")).toBeTruthy();
    expect(bodyOf(fetch, "POST /auth/users/login")).toEqual({
      email: "ann@mail.com",
      password: "secret-pass",
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(callsTo(fetch, "POST /auth/users/login")).toBe(1);
    expect(callsTo(fetch, "GET /auth/me")).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("organizer sign-up puts the answer in the cache, no second GET /auth/me", async () => {
    const fetch = mockFetch({
      "GET /auth/me": () => json(401, { error: "not_logged_in" }),
      "POST /auth/organizers/signup": () => json(201, OLGA),
    });
    const { queryClient } = renderApp("/organizer/signup");
    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "olga@mail.com" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Olga" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "long-enough" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Organizer home" })).toBeTruthy();
    expect(queryClient.getQueryData(["me"])).toEqual(OLGA);
    await waitFor(() => expect(screen.getByText("Olga")).toBeTruthy());
    expect(bodyOf(fetch, "POST /auth/organizers/signup")).toEqual({
      email: "olga@mail.com",
      name: "Olga",
      password: "long-enough",
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(callsTo(fetch, "GET /auth/me")).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
