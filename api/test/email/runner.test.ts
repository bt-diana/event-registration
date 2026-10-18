import { afterEach, describe, expect, it, vi } from "vitest";
import { readIntervalMs } from "../../src/email/jobs.js";
import { createRunner } from "../../src/email/runner.js";

// The timer (email-reminders.md ER33-ER37, roadmap step 32). Fake timers and a
// task the test controls; no database. ER34 and ER35 are the tests first.

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ER33: the runner calls its task at start and then every intervalMs", () => {
  it("runs once at start and once per interval", async () => {
    vi.useFakeTimers();
    const task = vi.fn(async () => {});
    const runner = createRunner(task, { intervalMs: 1000, onError: vi.fn() });
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(task).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3000);
    expect(task).toHaveBeenCalledTimes(5);
    await runner.stop();
  });
});

describe("ER34: no overlap (tests first)", () => {
  it("skips a firing while the previous run is still going, and runs again after it finished", async () => {
    vi.useFakeTimers();
    const runs: ReturnType<typeof deferred>[] = [];
    let active = 0;
    let maxActive = 0;
    const task = vi.fn(async () => {
      const run = deferred();
      runs.push(run);
      active += 1;
      maxActive = Math.max(maxActive, active);
      try {
        await run.promise;
      } finally {
        active -= 1;
      }
    });
    const runner = createRunner(task, { intervalMs: 1000, onError: vi.fn() });
    expect(task).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3000);
    expect(task).toHaveBeenCalledTimes(1);

    runs[0].resolve();
    await vi.advanceTimersByTimeAsync(1000);
    expect(task).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(1);

    runs[1].resolve();
    await runner.stop();
  });
});

describe("ER35: an error in the task is reported and the timer keeps going (tests first)", () => {
  it("reports the message to onError and runs the next firing, with no unhandled rejection", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const task = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error("database is down");
    });
    const onError = vi.fn();
    const runner = createRunner(task, { intervalMs: 1000, onError });
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toContain("database is down");
    expect(onError.mock.calls[0][0]).not.toContain("\n    at ");

    await vi.advanceTimersByTimeAsync(1000);
    expect(task).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
    await runner.stop();
  });

  it("reports to console.error by default", async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const runner = createRunner(() => Promise.reject(new Error("boom")), { intervalMs: 1000 });
      await vi.advanceTimersByTimeAsync(0);
      expect(error).toHaveBeenCalledTimes(1);
      expect(String(error.mock.calls[0][0])).toContain("boom");
      await runner.stop();
    } finally {
      error.mockRestore();
    }
  });

  it("also survives a task that throws synchronously or rejects with a non-Error", async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    let calls = 0;
    const task = vi.fn((): Promise<void> => {
      calls += 1;
      if (calls === 1) throw new Error("sync boom");
      return Promise.reject("not an error");
    });
    const runner = createRunner(task, { intervalMs: 1000, onError });
    await vi.advanceTimersByTimeAsync(1000);
    expect(task).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError.mock.calls[0][0]).toContain("sync boom");
    await runner.stop();
  });
});

describe("ER36: stop()", () => {
  it("clears the timer, starts no new run and waits for the run in progress", async () => {
    vi.useFakeTimers();
    const run = deferred();
    const task = vi.fn(() => run.promise);
    const runner = createRunner(task, { intervalMs: 1000, onError: vi.fn() });

    let stopped = false;
    const stopping = runner.stop().then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(stopped).toBe(false);
    expect(task).toHaveBeenCalledTimes(1);

    run.resolve();
    await stopping;
    expect(stopped).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(task).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("can be called twice", async () => {
    vi.useFakeTimers();
    const runner = createRunner(async () => {}, { intervalMs: 1000, onError: vi.fn() });
    await runner.stop();
    await expect(runner.stop()).resolves.toBeUndefined();
  });
});

describe("ER37: readIntervalMs (D63: default 1 h)", () => {
  it("gives 3600000 when EMAIL_JOB_INTERVAL_MS is unset or empty", () => {
    expect(readIntervalMs({})).toBe(3_600_000);
    expect(readIntervalMs({ EMAIL_JOB_INTERVAL_MS: undefined })).toBe(3_600_000);
    expect(readIntervalMs({ EMAIL_JOB_INTERVAL_MS: "" })).toBe(3_600_000);
  });

  it("accepts a whole number of at least 1000", () => {
    expect(readIntervalMs({ EMAIL_JOB_INTERVAL_MS: "1000" })).toBe(1000);
    expect(readIntervalMs({ EMAIL_JOB_INTERVAL_MS: "10000" })).toBe(10_000);
    expect(readIntervalMs({ EMAIL_JOB_INTERVAL_MS: "3600000" })).toBe(3_600_000);
  });

  it("throws an error that names the variable for anything else", () => {
    for (const value of ["abc", "0", "-5", "1.5", "999", "10s", "1e4", "0x400", "Infinity"]) {
      expect(() => readIntervalMs({ EMAIL_JOB_INTERVAL_MS: value }), value).toThrow(/EMAIL_JOB_INTERVAL_MS/);
    }
  });
});
