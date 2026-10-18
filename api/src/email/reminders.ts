import type pg from "pg";

// docs/specs/email-reminders.md ER18-ER31. Stub for the tests-first commit.

export const enqueueReminders: (pool: pg.Pool, now: Date) => Promise<number> = async () => {
  throw new Error("not implemented");
};
