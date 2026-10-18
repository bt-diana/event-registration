import type { Server } from "node:http";
import cookieParser from "cookie-parser";
import express, { type Express } from "express";
import { setSession, type Role } from "../../src/auth/cookie.js";

// A fixed secret for the test process (at least 32 characters).
export const TEST_SECRET = "test-cookie-secret-0123456789-abcdefghij";

export type Running = { url: string; close: () => Promise<void> };

// Starts the app on a free port, the same way as the health test.
export function listen(app: Express): Running {
  const server: Server = app.listen(0);
  const { port } = server.address() as { port: number };
  return {
    url: `http://localhost:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

// The `session=...` part of the Set-Cookie header, ready to send back in a
// Cookie header, or undefined when the response set no session cookie.
export function sessionCookie(res: Response): string | undefined {
  const header = res.headers.getSetCookie().find((c) => c.startsWith("session="));
  return header?.split(";")[0];
}

// A session cookie signed with TEST_SECRET by the real setSession, issued at
// `now` (pass a past time for an expired cookie).
export async function mintSessionCookie(role: Role, id: string, now?: number): Promise<string> {
  const app = express();
  app.use(cookieParser(TEST_SECRET));
  app.post("/mint", (_req, res) => {
    setSession(res, role, id, now);
    res.status(204).end();
  });
  const running = listen(app);
  try {
    const res = await fetch(`${running.url}/mint`, { method: "POST" });
    return sessionCookie(res)!;
  } finally {
    await running.close();
  }
}

// The full Set-Cookie header for the session cookie.
export function sessionSetCookie(res: Response): string | undefined {
  return res.headers.getSetCookie().find((c) => c.startsWith("session="));
}
