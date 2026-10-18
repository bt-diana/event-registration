import { randomBytes, randomInt, randomUUID } from "node:crypto";
import type pg from "pg";
import { createPool } from "../../src/db/pool.js";
import { migrate } from "../../src/db/migrate.js";

export type TestDb = {
  schema: string;
  pool: pg.Pool;
  drop: () => Promise<void>;
};

// Creates a throw-away schema, points a pool at it (search_path) and runs the
// migrations into it. The dev data in the other schemas is never touched.
export async function createTestDb(options: { migrate?: boolean } = {}): Promise<TestDb> {
  const schema = `test_${randomBytes(6).toString("hex")}`;
  const admin = createPool({ max: 1 });
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
  } finally {
    await admin.end();
  }

  const pool = createPool({ max: 30, options: `-c search_path=${schema}` });
  const { rows } = await pool.query<{ search_path: string }>("SHOW search_path");
  if (rows[0]?.search_path !== schema) {
    await pool.end();
    throw new Error(`test pool is not isolated: search_path is ${rows[0]?.search_path}`);
  }

  if (options.migrate !== false) {
    await migrate(pool);
  }

  return {
    schema,
    pool,
    async drop() {
      await pool.end();
      const cleanup = createPool({ max: 1 });
      try {
        await cleanup.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      } finally {
        await cleanup.end();
      }
    },
  };
}

const TICKET_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function makeTicketCode(): string {
  let code = "";
  for (let i = 0; i < 10; i++) {
    code += TICKET_ALPHABET[randomInt(TICKET_ALPHABET.length)];
  }
  return code;
}

export function uniqueEmail(prefix = "person"): string {
  return `${prefix}-${randomUUID()}@example.com`;
}

export async function insertOrganizer(pool: pg.Pool): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO organizers (email, name, password_hash) VALUES ($1, 'Organizer', 'hash') RETURNING id`,
    [uniqueEmail("organizer")],
  );
  return rows[0].id;
}

export async function insertUser(pool: pg.Pool, email = uniqueEmail("user")): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (email, name, password_hash) VALUES ($1, 'Attendee', 'hash') RETURNING id`,
    [email],
  );
  return rows[0].id;
}

export async function insertEvent(
  pool: pg.Pool,
  organizerId: string,
  options: {
    capacity?: number;
    startsAt?: Date;
    status?: string;
    title?: string;
    // Left out of the insert when undefined, so the column DEFAULT applies.
    durationMinutes?: number;
  } = {},
): Promise<string> {
  const values = [
    organizerId,
    options.title ?? "Test event",
    options.startsAt ?? new Date(Date.now() + 12 * 60 * 60 * 1000),
    options.capacity ?? 10,
    options.status ?? "active",
  ];
  const withDuration = options.durationMinutes !== undefined;
  const { rows } = await pool.query<{ id: string }>(
    withDuration
      ? `INSERT INTO events (organizer_id, title, starts_at, capacity, status, duration_minutes)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`
      : `INSERT INTO events (organizer_id, title, starts_at, capacity, status)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    withDuration ? [...values, options.durationMinutes] : values,
  );
  return rows[0].id;
}

export async function insertRegistration(
  pool: pg.Pool,
  eventId: string,
  userId: string,
  status: "registered" | "waitlisted" | "cancelled" = "registered",
  ticketCode = makeTicketCode(),
): Promise<{ id: string; ticketCode: string }> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO registrations (event_id, user_id, status, ticket_code, cancelled_at)
     VALUES ($1, $2, $3::text, $4, CASE WHEN $3::text = 'cancelled' THEN now() END) RETURNING id`,
    [eventId, userId, status, ticketCode],
  );
  return { id: rows[0].id, ticketCode };
}

// Waits until the backend with this pid is blocked on a lock, so a test can
// prove that two transactions really overlap.
export async function waitUntilBlocked(pool: pg.Pool, pid: number): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const { rows } = await pool.query<{ wait_event_type: string | null }>(
      "SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1",
      [pid],
    );
    if (rows[0]?.wait_event_type === "Lock") return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`backend ${pid} never waited on a lock`);
}

export async function backendPid(client: pg.PoolClient): Promise<number> {
  const { rows } = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
  return rows[0].pid;
}
