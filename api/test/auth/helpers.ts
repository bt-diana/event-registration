import type { Server } from "node:http";
import type { Express } from "express";

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

// The full Set-Cookie header for the session cookie.
export function sessionSetCookie(res: Response): string | undefined {
  return res.headers.getSetCookie().find((c) => c.startsWith("session="));
}
