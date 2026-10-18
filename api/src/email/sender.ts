import type pg from "pg";
import type { EmailTransport } from "./transport.js";

// docs/specs/email-reminders.md ER4-ER17 (D56, D58). Sends pending outbox rows
// through the transport, one row per short transaction: claim the row with
// FOR UPDATE SKIP LOCKED, call the transport while the lock is held, then mark
// it sent or count the failed try, and COMMIT in both cases. At least once: a
// crash between the provider's answer and the COMMIT leaves the row pending,
// and the outbox row id as idempotency key makes a repeat unlikely to send.
// No timer, no HTTP, no import of the provider SDK.

// A row is tried at most this many times, then it is `error_sending` (D56).
export const MAX_SEND_ATTEMPTS = 3;

// One sender stays far below Resend's 10 requests per second (open question 1, D62).
const DEFAULT_BATCH_SIZE = 5;

const MAX_REASON = 200;

export type SendOptions = {
  transport: EmailTransport;
  // Tries per call, sent and failed both count (ER8).
  batchSize?: number;
  // Gets one `[email] sent <kind> <id>` line per sent row (ER7).
  log?: (line: string) => void;
  // Gets one message per failed try (ER17).
  onError?: (message: string) => void;
};

type ClaimedRow = { id: string; kind: string; to_email: string; subject: string; body: string };

type Outcome = { sent: true; row: ClaimedRow } | { sent: false; row: ClaimedRow; attempts: number; reason: string };

// $1 = the ids that already failed in this call, so a failed row is not tried
// twice in one round (ER11). SKIP LOCKED: a parallel sender takes another row
// or none, never the same one (ER6, ER15).
const CLAIM_SQL = `SELECT id, kind, to_email, subject, body
  FROM outbox
 WHERE status = 'pending' AND id <> ALL($1::uuid[])
 ORDER BY created_at, id
 LIMIT 1
 FOR UPDATE SKIP LOCKED`;

// sent_at is the database clock (ER4).
const MARK_SENT_SQL = `UPDATE outbox SET status = 'sent', sent_at = now(), send_error = NULL WHERE id = $1`;

// Committed with the lock still held, so the count survives and is never
// counted twice (ER14, ER15).
const MARK_FAILED_SQL = `UPDATE outbox
   SET send_attempts = send_attempts + 1,
       send_error = $2,
       status = CASE WHEN send_attempts + 1 >= $3 THEN 'error_sending' ELSE 'pending' END
 WHERE id = $1
RETURNING send_attempts`;

// ER7: kind and id only; never the address, the subject or the body.
export function formatSentLine(row: { id: string; kind: string }): string {
  return `[email] sent ${row.kind} ${row.id}`;
}

// Anything that looks like an email address. The provider's own message (for
// example the testing-only 403) can name the account owner's address (ER17).
// The domain part does not end in a dot, so a full stop after it stays.
const ADDRESS = /[^\s<>()[\]{}"'`,;:]+@[^\s<>()[\]{}"'`,;:]*[^\s<>()[\]{}"'`,;:.]/g;

// ER17: the error's message with every address replaced, cut to 200 characters.
function failureReason(error: unknown): string {
  const message = error instanceof Error && error.message !== "" ? error.message : "unknown error";
  return message.replace(ADDRESS, "[address]").slice(0, MAX_REASON);
}

// A callback that throws must not change the count or the row, which is
// already committed (ER7).
function safely(callback: (text: string) => void, text: string): void {
  try {
    callback(text);
  } catch {
    // ignored on purpose
  }
}

export async function sendPending(pool: pg.Pool, options: SendOptions): Promise<number> {
  const transport = options?.transport;
  if (typeof transport !== "function") throw new Error("sendPending needs a transport");
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const log = options.log ?? console.log;
  const onError = options.onError ?? console.error;

  const failedIds: string[] = [];
  let sent = 0;
  for (let tries = 0; tries < batchSize; tries++) {
    const outcome = await sendOne(pool, transport, failedIds);
    if (outcome === null) break;
    if (outcome.sent) {
      sent += 1;
      safely(log, formatSentLine(outcome.row));
    } else {
      failedIds.push(outcome.row.id);
      safely(
        onError,
        `email ${outcome.row.id} (${outcome.row.kind}) not sent (try ${outcome.attempts} of ${MAX_SEND_ATTEMPTS}): ${outcome.reason}`,
      );
    }
  }
  return sent;
}

// Claims, sends and marks one row in its own transaction. null = no row left.
// A database error rolls the transaction back (the try is not counted, ER17)
// and is thrown to the caller.
async function sendOne(pool: pg.Pool, transport: EmailTransport, failedIds: string[]): Promise<Outcome | null> {
  const client = await pool.connect();
  let broken: Error | undefined;
  try {
    await client.query("BEGIN");
    const claimed = await client.query<ClaimedRow>(CLAIM_SQL, [failedIds]);
    if (claimed.rows.length === 0) {
      await client.query("COMMIT");
      return null;
    }
    const row = claimed.rows[0];

    let reason: string | null = null;
    try {
      await transport({ to: row.to_email, subject: row.subject, text: row.body, idempotencyKey: row.id });
    } catch (error) {
      reason = failureReason(error);
    }

    if (reason === null) {
      await client.query(MARK_SENT_SQL, [row.id]);
      await client.query("COMMIT");
      return { sent: true, row };
    }
    const updated = await client.query<{ send_attempts: number }>(MARK_FAILED_SQL, [
      row.id,
      reason,
      MAX_SEND_ATTEMPTS,
    ]);
    await client.query("COMMIT");
    return { sent: false, row, attempts: updated.rows[0].send_attempts, reason };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      // The connection is unusable: drop it instead of returning it to the pool.
      broken = rollbackError instanceof Error ? rollbackError : new Error("rollback failed");
    }
    throw error;
  } finally {
    client.release(broken);
  }
}
