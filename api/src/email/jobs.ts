import type pg from "pg";
import { enqueueReminders } from "./reminders.js";
import { createRunner } from "./runner.js";
import { sendPending } from "./sender.js";
import type { EmailTransport } from "./transport.js";

// docs/specs/email-reminders.md ER32, ER37. Composes the reminder worker, the
// sender and the runner. Started from index.ts only, after listen (ER38).

// D63: an hour is enough for daily reminders; .env.example sets 10 s for
// development and demos.
export const DEFAULT_INTERVAL_MS = 3_600_000;
const MIN_INTERVAL_MS = 1000;

// ER37: unset or empty gives the default; a whole number of at least 1000 is
// accepted; anything else throws, so the API stops at start. The message names
// the variable, not the value.
export function readIntervalMs(env: Readonly<Record<string, string | undefined>>): number {
  const raw = env.EMAIL_JOB_INTERVAL_MS?.trim() ?? "";
  if (raw === "") return DEFAULT_INTERVAL_MS;
  const value = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(value) || value < MIN_INTERVAL_MS) {
    throw new Error(`EMAIL_JOB_INTERVAL_MS must be a whole number of milliseconds, at least ${MIN_INTERVAL_MS}`);
  }
  return value;
}

export type EmailJobsOptions = {
  pool: pg.Pool;
  transport: EmailTransport;
  intervalMs?: number;
  // The reminder window's clock (ER26); the sender uses the database clock.
  clock?: () => Date;
  batchSize?: number;
  log?: (line: string) => void;
  onError?: (message: string) => void;
};

export type EmailJobs = {
  // One round: the reminders first, then the sender, so a reminder that falls
  // into the window is sent in the same round (ER32).
  tick: () => Promise<void>;
  stop: () => Promise<void>;
};

export function startEmailJobs(options: EmailJobsOptions): EmailJobs {
  const { pool, transport, batchSize, log, onError } = options;
  const clock = options.clock ?? (() => new Date());

  const tick = async () => {
    await enqueueReminders(pool, clock());
    await sendPending(pool, { transport, batchSize, log, onError });
  };

  const runner = createRunner(tick, { intervalMs: options.intervalMs ?? DEFAULT_INTERVAL_MS, onError });
  return { tick, stop: runner.stop };
}
