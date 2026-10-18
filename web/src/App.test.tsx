import { render, screen } from "@testing-library/react";
import { App } from "./App";

describe("App", () => {
  it("shows the title", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "Event Registration" })).toBeTruthy();
  });
});
