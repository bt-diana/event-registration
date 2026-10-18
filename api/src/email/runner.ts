// docs/specs/email-reminders.md ER33-ER36. A generic timer, no database: the
// task runs once at start and then every intervalMs. A firing while a run is
// still going is skipped (no overlap). A failed run is reported and the timer
// keeps going; a rejected run never becomes an unhandled rejection.

export type RunnerOptions = {
  intervalMs: number;
  // Gets the error message only (no stack). Defaults to console.error.
  onError?: (message: string) => void;
};

export type Runner = { stop: () => Promise<void> };

export function createRunner(task: () => Promise<void>, options: RunnerOptions): Runner {
  const onError = options.onError ?? console.error;
  let running: Promise<void> | null = null;
  let stopped = false;

  const fire = () => {
    if (stopped || running) return;
    // Never rejects: every error is caught and reported here.
    const run = (async () => {
      try {
        await task();
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        try {
          onError(`[email] round failed: ${message}`);
        } catch {
          // A broken reporter must not stop the timer.
        }
      }
    })();
    // Cleared after the assignment, also when the task threw synchronously.
    running = run;
    void run.then(() => {
      if (running === run) running = null;
    });
  };

  const timer = setInterval(fire, options.intervalMs);
  fire();

  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      await running;
    },
  };
}
