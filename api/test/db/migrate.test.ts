import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrate } from "../../src/db/migrate.js";
import { createTestDb, type TestDb } from "./helpers.js";

describe("migrate", () => {
  let db: TestDb | undefined;
  let tempDir: string | undefined;

  afterEach(async () => {
    await db?.drop();
    db = undefined;
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  it("applies 001_init.sql and 002_event_duration.sql once, records them, and creates the five tables", async () => {
    db = await createTestDb({ migrate: false });

    expect(await migrate(db.pool)).toEqual(["001_init.sql", "002_event_duration.sql"]);
    expect(await migrate(db.pool)).toEqual([]);

    const applied = await db.pool.query<{ filename: string }>(
      "SELECT filename FROM schema_migrations ORDER BY filename",
    );
    expect(applied.rows.map((r) => r.filename)).toEqual(["001_init.sql", "002_event_duration.sql"]);

    const tables = await db.pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name`,
      [db.schema],
    );
    expect(tables.rows.map((r) => r.table_name)).toEqual([
      "events",
      "organizers",
      "outbox",
      "registrations",
      "schema_migrations",
      "users",
    ]);
  });

  it("applies files in name order, each in its own transaction", async () => {
    db = await createTestDb({ migrate: false });
    tempDir = await mkdtemp(join(tmpdir(), "migrations-"));
    await writeFile(join(tempDir, "002_b.sql"), "CREATE TABLE b (a_id integer REFERENCES a(id));");
    await writeFile(join(tempDir, "001_a.sql"), "CREATE TABLE a (id integer PRIMARY KEY);");
    await writeFile(join(tempDir, "003_bad.sql"), "CREATE TABLE c (id integer); SELECT 1 / 0;");
    await writeFile(join(tempDir, "notes.txt"), "not a migration");

    await expect(migrate(db.pool, tempDir)).rejects.toMatchObject({ code: "22012" });

    const applied = await db.pool.query<{ filename: string }>(
      "SELECT filename FROM schema_migrations ORDER BY filename",
    );
    expect(applied.rows.map((r) => r.filename)).toEqual(["001_a.sql", "002_b.sql"]);
    const tableC = await db.pool.query("SELECT to_regclass('c') AS c");
    expect(tableC.rows[0].c).toBeNull();
  });
});
