import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import { formatSentLine, MAX_SEND_ATTEMPTS, sendPending } from "../../src/email/sender.js";
import type { EmailTransport } from "../../src/email/transport.js";
import {
  createTestDb,
  insertEvent,
  insertOrganizer,
  insertOutbox,
  insertRegistration,
  insertUser,
  uniqueEmail,
  type OutboxKind,
  type OutboxStatus,
  type TestDb,
} from "../db/helpers.js";

// The outbox sender (email-reminders.md ER4-ER17, roadmap step 30). Written
// before the sender: ER4-ER6 and ER11-ER16 are the tests first. The transport
// is always a fake function: no network, no provider, no key.

type Message = Parameters<EmailTransport>[0];

type Row = {
  id: string;
  registration_id: string;
  kind: string;
  schedule_version: number;
  event_starts_at: Date;
  to_email: string;
  subject: string;
  body: string;
  created_at: Date;
  sent_at: Date | null;
  status: OutboxStatus;
  send_attempts: number;
  send_error: string | null;
};

let db: TestDb;
let registrationId: string;
let version = 0;

beforeAll(async () => {
  db = await createTestDb();
  const organizerId = await insertOrganizer(db.pool);
  const eventId = await insertEvent(db.pool, organizerId);
  registrationId = (await insertRegistration(db.pool, eventId, await insertUser(db.pool))).id;
});

afterAll(async () => {
  await db?.drop();
});

// Every test starts with an empty outbox: the sender picks every pending row.
beforeEach(async () => {
  await db.pool.query("DELETE FROM outbox");
});

// A pending row with its own recipient, subject and body. A fresh schedule
// version keeps the unique key free, so many rows can share one registration.
async function pending(
  options: { kind?: OutboxKind; createdAt?: Date; status?: OutboxStatus; sentAt?: Date; sendAttempts?: number } = {},
): Promise<Row> {
  version += 1;
  const id = await insertOutbox(db.pool, registrationId, {
    kind: options.kind ?? "ticket",
    scheduleVersion: version,
    toEmail: uniqueEmail("to"),
    subject: `Subject ${version} ${crypto.randomUUID()}`,
    body: `Body ${version}\nTicket code: SECRET${version}`,
    createdAt: options.createdAt,
    status: options.status,
    sentAt: options.sentAt,
    sendAttempts: options.sendAttempts,
  });
  return row(id);
}

async function row(id: string, pool: pg.Pool | pg.PoolClient = db.pool): Promise<Row> {
  const { rows } = await pool.query<Row>("SELECT * FROM outbox WHERE id = $1", [id]);
  return rows[0];
}

// A transport that accepts every email and records it.
function collecting() {
  return vi.fn<EmailTransport>(async () => {});
}

// A transport that fails for the given recipients and accepts the others.
function failingFor(...recipients: string[]) {
  return vi.fn<EmailTransport>(async (message) => {
    if (recipients.includes(message.to)) throw new Error("boom");
  });
}

function recipients(transport: { mock: { calls: [Message][] } }): string[] {
  return transport.mock.calls.map(([message]) => message.to);
}

function quiet() {
  return { log: vi.fn(), onError: vi.fn() };
}

// A promise the test resolves or rejects by hand.
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("ER4: sendPending sends each pending row once (tests first)", () => {
  it("calls the transport once per pending row with the row's text and id as key, and marks it sent", async () => {
    const rows = [await pending(), await pending({ kind: "reminder" }), await pending({ kind: "promotion" })];
    const transport = collecting();
    const before = new Date();

    expect(await sendPending(db.pool, { transport, ...quiet() })).toBe(3);

    expect(transport).toHaveBeenCalledTimes(3);
    for (const r of rows) {
      expect(transport).toHaveBeenCalledWith({ to: r.to_email, subject: r.subject, text: r.body, idempotencyKey: r.id });
      const after = await row(r.id);
      expect(after.status).toBe("sent");
      expect(after.sent_at).toBeInstanceOf(Date);
      expect(after.sent_at!.getTime()).toBeGreaterThan(before.getTime() - 60_000);
      expect(after.send_error).toBeNull();
      expect(after.send_attempts).toBe(0);
    }
  });

  it("never selects sent or error_sending rows", async () => {
    await pending({ status: "sent", sentAt: new Date() });
    await pending({ status: "error_sending", sendAttempts: 3 });
    const transport = collecting();

    expect(await sendPending(db.pool, { transport, ...quiet() })).toBe(0);
    expect(transport).not.toHaveBeenCalled();
  });

  it("clears send_error when a retried row is sent", async () => {
    const r = await pending();
    await db.pool.query("UPDATE outbox SET send_attempts = 1, send_error = 'old reason' WHERE id = $1", [r.id]);

    expect(await sendPending(db.pool, { transport: collecting(), ...quiet() })).toBe(1);
    expect(await row(r.id)).toMatchObject({ status: "sent", send_attempts: 1, send_error: null });
  });

  it("needs a transport and has no default one", async () => {
    await pending();
    // @ts-expect-error -- the transport is required (ER4)
    await expect(sendPending(db.pool, {})).rejects.toThrow(/transport/);
    const { rows } = await db.pool.query<{ status: string }>("SELECT status FROM outbox");
    expect(rows.map((r) => r.status)).toEqual(["pending"]);
  });

  it("logs to console.log and reports to console.error by default", async () => {
    const ok = await pending();
    const bad = await pending();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await sendPending(db.pool, { transport: failingFor(bad.to_email) })).toBe(1);
      expect(log).toHaveBeenCalledWith(`[email] sent ticket ${ok.id}`);
      expect(error).toHaveBeenCalledTimes(1);
      expect(error.mock.calls[0][0]).toContain(bad.id);
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  });
});

describe("ER5: a repeat run sends nothing (tests first)", () => {
  it("calls the transport 0 times in 10 more runs and keeps sent_at", async () => {
    const rows = [await pending(), await pending()];
    const transport = collecting();
    expect(await sendPending(db.pool, { transport, ...quiet() })).toBe(2);
    const sentAt = await Promise.all(rows.map(async (r) => (await row(r.id)).sent_at));

    for (let run = 0; run < 10; run++) {
      expect(await sendPending(db.pool, { transport, ...quiet() })).toBe(0);
    }
    expect(transport).toHaveBeenCalledTimes(2);
    expect(await Promise.all(rows.map(async (r) => (await row(r.id)).sent_at))).toEqual(sentAt);
  });
});

describe("ER6: parallel senders send each row once (tests first)", () => {
  it("5 parallel calls send N rows N times in total, each recipient once", async () => {
    for (let round = 0; round < 3; round++) {
      await db.pool.query("DELETE FROM outbox");
      const rows: Row[] = [];
      for (let i = 0; i < 12; i++) rows.push(await pending());
      // A short wait inside the call, so the senders really overlap.
      const transport = vi.fn<EmailTransport>(() => new Promise((resolve) => setTimeout(resolve, 5)));

      const counts = await Promise.all(
        Array.from({ length: 5 }, () => sendPending(db.pool, { transport, batchSize: 12, ...quiet() })),
      );

      expect(counts.reduce((a, b) => a + b, 0)).toBe(12);
      expect(transport).toHaveBeenCalledTimes(12);
      expect(recipients(transport).sort()).toEqual(rows.map((r) => r.to_email).sort());
      const { rows: statuses } = await db.pool.query<{ status: string }>("SELECT status FROM outbox");
      expect(statuses.every((s) => s.status === "sent")).toBe(true);
    }
  });

  it("a second sender skips the row whose call is still pending and sends the others", async () => {
    const held = await pending({ createdAt: new Date("2030-01-01T00:00:00Z") });
    const others = [
      await pending({ createdAt: new Date("2030-01-01T00:00:01Z") }),
      await pending({ createdAt: new Date("2030-01-01T00:00:02Z") }),
    ];
    const started = deferred();
    const finish = deferred();
    const first = vi.fn<EmailTransport>(async () => {
      started.resolve();
      await finish.promise;
    });
    const firstRun = sendPending(db.pool, { transport: first, batchSize: 1, ...quiet() });
    await started.promise;

    const second = collecting();
    expect(await sendPending(db.pool, { transport: second, ...quiet() })).toBe(2);
    expect(recipients(second)).toEqual(others.map((r) => r.to_email));
    // The held row is still pending while its call runs.
    expect(await row(held.id)).toMatchObject({ status: "pending", sent_at: null });

    finish.resolve();
    expect(await firstRun).toBe(1);
    expect(recipients(first)).toEqual([held.to_email]);
    expect((await row(held.id)).status).toBe("sent");
  });
});

describe("ER11: a failed try (tests first)", () => {
  it("keeps the row pending with one more try and a reason, sends the others, reports once, does not throw", async () => {
    const bad = await pending({ createdAt: new Date("2030-01-01T00:00:00Z") });
    const good = [
      await pending({ createdAt: new Date("2030-01-01T00:00:01Z") }),
      await pending({ createdAt: new Date("2030-01-01T00:00:02Z") }),
    ];
    const transport = failingFor(bad.to_email);
    const { log, onError } = quiet();

    expect(await sendPending(db.pool, { transport, log, onError })).toBe(2);

    expect(await row(bad.id)).toMatchObject({ status: "pending", sent_at: null, send_attempts: 1, send_error: "boom" });
    for (const r of good) expect((await row(r.id)).status).toBe("sent");
    expect(onError).toHaveBeenCalledTimes(1);
    // Not tried again inside the same call, although the batch had room.
    expect(recipients(transport).filter((to) => to === bad.to_email)).toHaveLength(1);
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it("counts a rejected promise the same as a throw", async () => {
    const bad = await pending();
    const transport = vi.fn<EmailTransport>(() => Promise.reject(new Error("rejected")));
    expect(await sendPending(db.pool, { transport, ...quiet() })).toBe(0);
    expect(await row(bad.id)).toMatchObject({ status: "pending", send_attempts: 1, send_error: "rejected" });
  });
});

describe("ER12: a retry succeeds (tests first)", () => {
  it("fails twice, works on the third call, with the same idempotency key each time", async () => {
    const r = await pending();
    let calls = 0;
    const transport = vi.fn<EmailTransport>(async () => {
      calls += 1;
      if (calls <= 2) throw new Error(`fail ${calls}`);
    });

    expect(await sendPending(db.pool, { transport, ...quiet() })).toBe(0);
    expect(await row(r.id)).toMatchObject({ status: "pending", send_attempts: 1, send_error: "fail 1" });
    expect(await sendPending(db.pool, { transport, ...quiet() })).toBe(0);
    expect(await row(r.id)).toMatchObject({ status: "pending", send_attempts: 2, send_error: "fail 2" });
    expect(await sendPending(db.pool, { transport, ...quiet() })).toBe(1);

    const after = await row(r.id);
    expect(after).toMatchObject({ status: "sent", send_attempts: 2, send_error: null });
    expect(after.sent_at).toBeInstanceOf(Date);
    expect(transport).toHaveBeenCalledTimes(3);
    expect(transport.mock.calls.map(([message]) => message.idempotencyKey)).toEqual([r.id, r.id, r.id]);
  });
});

describe("ER13: give up after 3 failed tries (tests first)", () => {
  it("sets error_sending on the third failure and never tries the row again", async () => {
    expect(MAX_SEND_ATTEMPTS).toBe(3);
    const r = await pending();
    const transport = failingFor(r.to_email);

    for (let call = 1; call <= 3; call++) {
      expect(await sendPending(db.pool, { transport, ...quiet() })).toBe(0);
      expect((await row(r.id)).send_attempts).toBe(call);
    }
    const given = await row(r.id);
    expect(given).toMatchObject({ status: "error_sending", send_attempts: 3, sent_at: null, send_error: "boom" });

    for (let call = 4; call <= 10; call++) {
      expect(await sendPending(db.pool, { transport, ...quiet() })).toBe(0);
    }
    expect(transport).toHaveBeenCalledTimes(3);
    expect(await row(r.id)).toEqual(given);
  });
});

describe("ER14: the failed try is committed (tests first)", () => {
  it("shows the new send_attempts on another connection right after each failed call", async () => {
    const r = await pending();
    const transport = failingFor(r.to_email);
    // Held for the whole test, so the sender has to use another connection.
    const reader = await db.pool.connect();
    try {
      for (let call = 1; call <= 3; call++) {
        await sendPending(db.pool, { transport, batchSize: 1, ...quiet() });
        expect((await row(r.id, reader)).send_attempts).toBe(call);
      }
      expect((await row(r.id, reader)).status).toBe("error_sending");
    } finally {
      reader.release();
    }
  });
});

describe("ER15: parallel senders do not double-count a failed try (tests first)", () => {
  it("5 parallel calls try one failing row once and count 1", async () => {
    for (let round = 0; round < 3; round++) {
      await db.pool.query("DELETE FROM outbox");
      const r = await pending();
      // The failing call waits until the other four senders have returned, so
      // all five overlap with the held row lock.
      let settled = 0;
      const othersDone = deferred();
      const transport = vi.fn<EmailTransport>(async () => {
        await othersDone.promise;
        throw new Error("boom");
      });
      const runs = Array.from({ length: 5 }, () =>
        sendPending(db.pool, { transport, ...quiet() }).finally(() => {
          settled += 1;
          if (settled === 4) othersDone.resolve();
        }),
      );

      expect(await Promise.all(runs)).toEqual([0, 0, 0, 0, 0]);
      expect(transport).toHaveBeenCalledTimes(1);
      expect(await row(r.id)).toMatchObject({ status: "pending", send_attempts: 1 });
    }
  });

  it("a second sender skips the row while the first one's failing call is pending", async () => {
    const r = await pending();
    const started = deferred();
    const fail = deferred();
    const first = vi.fn<EmailTransport>(async () => {
      started.resolve();
      await fail.promise;
    });
    const firstRun = sendPending(db.pool, { transport: first, ...quiet() });
    await started.promise;

    const second = collecting();
    expect(await sendPending(db.pool, { transport: second, ...quiet() })).toBe(0);
    expect(second).not.toHaveBeenCalled();

    fail.reject(new Error("boom"));
    expect(await firstRun).toBe(0);
    expect(await row(r.id)).toMatchObject({ status: "pending", send_attempts: 1 });
  });
});

describe("ER16: a failing row does not block newer rows (tests first)", () => {
  it("one call with the default batch sends the newer rows past the failing oldest one", async () => {
    const bad = await pending({ createdAt: new Date("2030-01-01T00:00:00Z") });
    const newer = [
      await pending({ createdAt: new Date("2030-01-01T00:00:01Z") }),
      await pending({ createdAt: new Date("2030-01-01T00:00:02Z") }),
      await pending({ createdAt: new Date("2030-01-01T00:00:03Z") }),
    ];
    const transport = failingFor(bad.to_email);
    expect(await sendPending(db.pool, { transport, ...quiet() })).toBe(3);
    for (const r of newer) expect((await row(r.id)).status).toBe("sent");
  });

  it("with batchSize 1 the failing row holds the head for 3 calls, call 4 sends the oldest newer row", async () => {
    const bad = await pending({ createdAt: new Date("2030-01-01T00:00:00Z") });
    const newer = [
      await pending({ createdAt: new Date("2030-01-01T00:00:01Z") }),
      await pending({ createdAt: new Date("2030-01-01T00:00:02Z") }),
    ];
    const transport = failingFor(bad.to_email);
    for (let call = 1; call <= 3; call++) {
      expect(await sendPending(db.pool, { transport, batchSize: 1, ...quiet() })).toBe(0);
    }
    expect((await row(bad.id)).status).toBe("error_sending");
    expect(await sendPending(db.pool, { transport, batchSize: 1, ...quiet() })).toBe(1);
    expect(recipients(transport).at(-1)).toBe(newer[0].to_email);
    expect((await row(newer[1].id)).status).toBe("pending");
  });
});

describe("ER7: the sent line", () => {
  it("formatSentLine gives one line with kind and id only", () => {
    const line = formatSentLine({ id: "0190abcd-0000-7000-8000-000000000001", kind: "reminder" });
    expect(line).toBe("[email] sent reminder 0190abcd-0000-7000-8000-000000000001");
    expect(line).not.toContain("\n");
  });

  it("logs each sent row after its commit, with no address, subject or body, and nothing for a failed row", async () => {
    const ok = await pending({ kind: "reminder" });
    const bad = await pending();
    const log = vi.fn<(line: string) => void>();
    expect(await sendPending(db.pool, { transport: failingFor(bad.to_email), log, onError: vi.fn() })).toBe(1);
    expect(log).toHaveBeenCalledTimes(1);
    const line = log.mock.calls[0][0];
    expect(line).toBe(`[email] sent reminder ${ok.id}`);
    for (const secret of [ok.to_email, ok.subject, ok.body, bad.to_email]) expect(line).not.toContain(secret);
  });

  it("the row is committed before log runs", async () => {
    const ok = await pending();
    const seen: string[] = [];
    const reader = await db.pool.connect();
    try {
      let check: Promise<void> = Promise.resolve();
      const log = vi.fn(() => {
        check = row(ok.id, reader).then((r) => {
          seen.push(r.status);
        });
      });
      await sendPending(db.pool, { transport: collecting(), log, onError: vi.fn() });
      await check;
      expect(seen).toEqual(["sent"]);
    } finally {
      reader.release();
    }
  });

  it("ignores an exception thrown by log", async () => {
    const rows = [await pending(), await pending()];
    const log = vi.fn(() => {
      throw new Error("log broke");
    });
    expect(await sendPending(db.pool, { transport: collecting(), log, onError: vi.fn() })).toBe(2);
    for (const r of rows) expect((await row(r.id)).status).toBe("sent");
  });
});

describe("ER8: batch size and order", () => {
  it("makes at most batchSize tries per call, oldest first (created_at, then id)", async () => {
    const same = new Date("2030-01-01T00:00:01Z");
    const made = [
      await pending({ createdAt: new Date("2030-01-01T00:00:03Z") }),
      await pending({ createdAt: same }),
      await pending({ createdAt: new Date("2030-01-01T00:00:00Z") }),
      await pending({ createdAt: same }),
      await pending({ createdAt: new Date("2030-01-01T00:00:02Z") }),
    ];
    const expected = [...made]
      .sort((a, b) => a.created_at.getTime() - b.created_at.getTime() || (a.id < b.id ? -1 : 1))
      .map((r) => r.to_email);
    const transport = collecting();

    const counts = [];
    for (let call = 0; call < 4; call++) counts.push(await sendPending(db.pool, { transport, batchSize: 2, ...quiet() }));
    expect(counts).toEqual([2, 2, 1, 0]);
    expect(recipients(transport)).toEqual(expected);
  });

  it("counts failed tries toward the batch", async () => {
    const bad = await pending({ createdAt: new Date("2030-01-01T00:00:00Z") });
    await pending({ createdAt: new Date("2030-01-01T00:00:01Z") });
    await pending({ createdAt: new Date("2030-01-01T00:00:02Z") });
    const transport = failingFor(bad.to_email);
    expect(await sendPending(db.pool, { transport, batchSize: 2, ...quiet() })).toBe(1);
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("uses a batch of 5 by default", async () => {
    for (let i = 0; i < 7; i++) await pending();
    const transport = collecting();
    expect(await sendPending(db.pool, { transport, ...quiet() })).toBe(5);
    expect(await sendPending(db.pool, { transport, ...quiet() })).toBe(2);
  });
});

describe("ER9: every kind is sent the same way", () => {
  it("sends ticket, promotion, reminder, reschedule and event_cancelled rows", async () => {
    const kinds: OutboxKind[] = ["ticket", "promotion", "reminder", "reschedule", "event_cancelled"];
    const rows = [];
    for (const kind of kinds) rows.push(await pending({ kind }));
    const transport = collecting();
    const { log, onError } = quiet();
    expect(await sendPending(db.pool, { transport, batchSize: 10, log, onError })).toBe(5);
    expect(transport).toHaveBeenCalledTimes(5);
    for (const r of rows) expect((await row(r.id)).status).toBe("sent");
    expect(log.mock.calls.map(([line]) => line).sort()).toEqual(rows.map((r) => formatSentLine(r)).sort());
  });
});

describe("ER10: the sender changes only the four delivery columns", () => {
  it("leaves every other column and every other table unchanged and writes no row", async () => {
    const ok = await pending();
    const bad = await pending();
    const tables = ["organizers", "users", "events", "registrations"];
    const snapshot = async () => {
      const result: Record<string, unknown[]> = {};
      for (const table of tables) result[table] = (await db.pool.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
      return result;
    };
    const content = async () =>
      (
        await db.pool.query(
          `SELECT id, registration_id, kind, schedule_version, event_starts_at, to_email, subject, body, created_at
             FROM outbox ORDER BY id`,
        )
      ).rows;
    const tablesBefore = await snapshot();
    const outboxBefore = await content();

    await sendPending(db.pool, { transport: failingFor(bad.to_email), ...quiet() });

    expect(await snapshot()).toEqual(tablesBefore);
    expect(await content()).toEqual(outboxBefore);
    expect((await row(ok.id)).status).toBe("sent");
    expect((await row(bad.id)).send_attempts).toBe(1);
  });
});

describe("ER17: failure messages and database errors", () => {
  it("reports `email <id> (<kind>) not sent (try <n> of 3): <reason>` with addresses replaced", async () => {
    const r = await pending({ kind: "reminder" });
    const transport = vi.fn<EmailTransport>(async () => {
      throw new Error("boom for someone@example.com");
    });
    const onError = vi.fn();
    for (let call = 1; call <= 3; call++) {
      await sendPending(db.pool, { transport, log: vi.fn(), onError });
    }
    expect(onError.mock.calls.map(([message]) => message)).toEqual([
      `email ${r.id} (reminder) not sent (try 1 of 3): boom for [address]`,
      `email ${r.id} (reminder) not sent (try 2 of 3): boom for [address]`,
      `email ${r.id} (reminder) not sent (try 3 of 3): boom for [address]`,
    ]);
    const after = await row(r.id);
    expect(after.send_error).toBe("boom for [address]");
    for (const message of [...onError.mock.calls.map(([m]) => m as string), after.send_error!]) {
      expect(message).not.toContain("someone@example.com");
      expect(message).not.toContain(r.to_email);
      expect(message).not.toContain(r.subject);
      expect(message).not.toContain(r.body);
    }
  });

  it("replaces every address, also the recipient's, and cuts the reason to 200 characters", async () => {
    const r = await pending();
    const long = `You can only send testing emails to your own email address (owner@gmail.com), not ${r.to_email}. ${"x".repeat(400)}`;
    const onError = vi.fn();
    await sendPending(db.pool, {
      transport: async () => {
        throw new Error(long);
      },
      log: vi.fn(),
      onError,
    });
    const reason = (await row(r.id)).send_error!;
    expect(reason).toHaveLength(200);
    expect(reason.startsWith("You can only send testing emails to your own email address ([address]), not [address].")).toBe(
      true,
    );
    expect(reason).not.toContain("@");
    expect(onError.mock.calls[0][0]).toBe(`email ${r.id} (ticket) not sent (try 1 of 3): ${reason}`);
  });

  it("uses `unknown error` when something that is not an Error is thrown", async () => {
    const r = await pending();
    const onError = vi.fn();
    await sendPending(db.pool, {
      transport: async () => {
        throw "a string with someone@example.com";
      },
      log: vi.fn(),
      onError,
    });
    expect((await row(r.id)).send_error).toBe("unknown error");
    expect(onError).toHaveBeenCalledWith(`email ${r.id} (ticket) not sent (try 1 of 3): unknown error`);
  });

  it("a database error is not a failed try: rolled back, send_attempts unchanged, sendPending rejects", async () => {
    const r = await pending();
    await db.pool.query(`
      CREATE FUNCTION refuse_outbox_update() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'refused by test trigger'; END $$;
      CREATE TRIGGER refuse_outbox_update BEFORE UPDATE ON outbox
        FOR EACH ROW EXECUTE FUNCTION refuse_outbox_update();`);
    try {
      // On the success path (mark sent) ...
      const onError = vi.fn();
      await expect(sendPending(db.pool, { transport: collecting(), log: vi.fn(), onError })).rejects.toThrow(
        /refused by test trigger/,
      );
      expect(await row(r.id)).toMatchObject({ status: "pending", send_attempts: 0, send_error: null, sent_at: null });
      // ... and on the failure path (count the try).
      await expect(sendPending(db.pool, { transport: failingFor(r.to_email), log: vi.fn(), onError })).rejects.toThrow(
        /refused by test trigger/,
      );
      expect(await row(r.id)).toMatchObject({ status: "pending", send_attempts: 0, send_error: null });
      expect(onError).not.toHaveBeenCalled();
    } finally {
      await db.pool.query(
        "DROP TRIGGER refuse_outbox_update ON outbox; DROP FUNCTION refuse_outbox_update();",
      );
    }
    // The connections went back to the pool in a usable state.
    expect(await sendPending(db.pool, { transport: collecting(), ...quiet() })).toBe(1);
  });
});
