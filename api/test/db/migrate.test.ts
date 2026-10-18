import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrate, MIGRATIONS_DIR } from "../../src/db/migrate.js";
import { createTestDb, insertEvent, insertOrganizer, type TestDb } from "./helpers.js";

describe("migrate", () => {
  let db: TestDb | undefined;
  let tempDir: string | undefined;

  afterEach(async () => {
    await db?.drop();
    db = undefined;
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  const ALL = ["001_init.sql", "002_event_duration.sql", "003_event_description.sql", "004_outbox_status.sql", "005_seed_test_data.sql"];

  it("applies 001 to 005 once, records them, and creates the five tables", async () => {
    db = await createTestDb({ migrate: false });

    expect(await migrate(db.pool)).toEqual(ALL);
    expect(await migrate(db.pool)).toEqual([]);

    const applied = await db.pool.query<{ filename: string }>(
      "SELECT filename FROM schema_migrations ORDER BY filename",
    );
    expect(applied.rows.map((r) => r.filename)).toEqual(ALL);

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

  it("DS2: 003 gives rows made before it description '' and changes nothing else in them", async () => {
    db = await createTestDb({ migrate: false });
    tempDir = await mkdtemp(join(tmpdir(), "migrations-"));
    for (const file of ["001_init.sql", "002_event_duration.sql"]) {
      await copyFile(join(MIGRATIONS_DIR, file), join(tempDir, file));
    }
    expect(await migrate(db.pool, tempDir)).toEqual(["001_init.sql", "002_event_duration.sql"]);

    const organizerId = await insertOrganizer(db.pool);
    const ids = [
      await insertEvent(db.pool, organizerId, { title: "Old one", capacity: 3, durationMinutes: 45 }),
      await insertEvent(db.pool, organizerId, { title: "Old two", status: "cancelled" }),
    ];
    const readRows = (columns: string) =>
      db!.pool.query(`SELECT ${columns} FROM events WHERE id = ANY($1::uuid[]) ORDER BY id`, [ids]);
    const before = (await readRows("*")).rows;

    expect(await migrate(db.pool)).toEqual(["003_event_description.sql", "004_outbox_status.sql", "005_seed_test_data.sql"]);

    const after = (await readRows("*")).rows as Array<Record<string, unknown>>;
    expect(after.map((row) => row.description)).toEqual(["", ""]);
    const withoutDescription = after.map((row) => {
      const copy = { ...row };
      delete copy.description;
      return copy;
    });
    expect(withoutDescription).toEqual(before);
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
