import type pg from "pg";
import type { EmailTransport } from "./transport.js";

// docs/specs/email-reminders.md ER4-ER17. Stub for the tests-first commit.

export const MAX_SEND_ATTEMPTS = 3;

export type SendOptions = {
  transport: EmailTransport;
  batchSize?: number;
  log?: (line: string) => void;
  onError?: (message: string) => void;
};

export const formatSentLine: (row: { id: string; kind: string }) => string = () => {
  throw new Error("not implemented");
};

export const sendPending: (pool: pg.Pool, options: SendOptions) => Promise<number> = async () => {
  throw new Error("not implemented");
};
