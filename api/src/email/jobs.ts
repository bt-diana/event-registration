import type pg from "pg";
import type { EmailTransport } from "./transport.js";

// docs/specs/email-reminders.md ER32, ER37. Stub for the tests-first commit.

export type EmailJobsOptions = {
  pool: pg.Pool;
  transport: EmailTransport;
  intervalMs?: number;
  clock?: () => Date;
  log?: (line: string) => void;
  onError?: (message: string) => void;
};

export const readIntervalMs: (env: Readonly<Record<string, string | undefined>>) => number = () => {
  throw new Error("not implemented");
};

export const startEmailJobs: (options: EmailJobsOptions) => { tick: () => Promise<void>; stop: () => Promise<void> } =
  () => {
    throw new Error("not implemented");
  };
