import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

describe("health", () => {
  it("answers ok", async () => {
    const server = createApp().listen(0);
    const { port } = server.address() as { port: number };
    const res = await fetch(`http://localhost:${port}/health`);
    server.close();
    expect(await res.json()).toEqual({ ok: true });
  });
});
