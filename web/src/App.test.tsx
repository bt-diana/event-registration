import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { App } from "./App";

function renderApp(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("App", () => {
  it("shows the logged-out header with its links", () => {
    renderApp("/");
    expect(screen.getByRole("link", { name: "Event Registration" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Log in" }).getAttribute("href")).toBe("/login");
    expect(screen.getByRole("link", { name: "Sign up" }).getAttribute("href")).toBe("/signup");
    expect(screen.getByRole("link", { name: "For organizers" }).getAttribute("href")).toBe(
      "/organizer/login",
    );
  });

  it("shows the attendee home placeholder at /", () => {
    renderApp("/");
    expect(screen.getByRole("heading", { level: 1, name: "Events" })).toBeTruthy();
  });

  it("shows the organizer home placeholder at /organizer", () => {
    renderApp("/organizer");
    expect(screen.getByRole("heading", { level: 1, name: "Organizer home" })).toBeTruthy();
  });

  it("shows the attendee login page at /login", () => {
    renderApp("/login");
    expect(screen.getByRole("heading", { level: 1, name: "Log in" })).toBeTruthy();
    expect(screen.getByText("Attendee")).toBeTruthy();
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.queryByLabelText("Name")).toBeNull();
    expect(screen.getByLabelText("Password").getAttribute("autocomplete")).toBe(
      "current-password",
    );
    expect(screen.getByRole("link", { name: "I organize events" }).getAttribute("href")).toBe(
      "/organizer/login",
    );
  });

  it("shows the attendee sign-up page at /signup", () => {
    renderApp("/signup");
    expect(screen.getByRole("heading", { level: 1, name: "Create an account" })).toBeTruthy();
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getByLabelText("Name")).toBeTruthy();
    expect(screen.getByLabelText("Password").getAttribute("autocomplete")).toBe("new-password");
    expect(screen.getByText("8 to 128 characters")).toBeTruthy();
    expect(screen.getByRole("link", { name: "I organize events" }).getAttribute("href")).toBe(
      "/organizer/signup",
    );
  });

  it("shows the organizer login page at /organizer/login", () => {
    renderApp("/organizer/login");
    expect(screen.getByRole("heading", { level: 1, name: "Log in" })).toBeTruthy();
    expect(screen.getByText("Organizer")).toBeTruthy();
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(screen.getByRole("link", { name: "I am an attendee" }).getAttribute("href")).toBe(
      "/login",
    );
  });

  it("shows the organizer sign-up page at /organizer/signup", () => {
    renderApp("/organizer/signup");
    expect(
      screen.getByRole("heading", { level: 1, name: "Create an organizer account" }),
    ).toBeTruthy();
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getByLabelText("Name")).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(screen.getByRole("link", { name: "I am an attendee" }).getAttribute("href")).toBe(
      "/signup",
    );
  });
});
