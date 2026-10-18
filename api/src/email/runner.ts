// docs/specs/email-reminders.md ER33-ER36. Stub for the tests-first commit.

export type RunnerOptions = { intervalMs: number; onError?: (message: string) => void };

export const createRunner: (task: () => Promise<void>, options: RunnerOptions) => { stop: () => Promise<void> } =
  () => {
    throw new Error("not implemented");
  };
